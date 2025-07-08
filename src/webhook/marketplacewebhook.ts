import express, { Request, Response, NextFunction } from "express";
import jwt, { JwtHeader, SigningKeyCallback } from "jsonwebtoken";
import JwksClient from "jwks-rsa";
import fetch from "node-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// ── SP Credentials para llamar al SaaS Fulfillment API
const credential = new ClientSecretCredential(
  process.env.MP_TENANT_ID!,     
  process.env.MP_CLIENT_ID!,     
  process.env.MP_CLIENT_SECRET!  
);

// ── Configuración de la tabla MarketplaceSubscriptions
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key     = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const subsTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "MarketplaceSubscriptions",
  new AzureNamedKeyCredential(account, key)
);

// ── Helper para obtener Bearer token del API
async function getMarketplaceToken(): Promise<string> {
  const { token } = await credential.getToken("https://marketplaceapi.microsoft.com/.default");
  return token!;
}

// ── JWKS setup para verificar el JWT que envía Microsoft
const tenantId  = process.env.MP_TENANT_ID!;
const audience  = process.env.MP_AUDIENCE!;
const issuer    = process.env.MP_ISSUER!;
const jwksUri   = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
const jwks      = JwksClient({ jwksUri, cache: true, rateLimit: true });

function getSigningKey(header: JwtHeader, cb: SigningKeyCallback): void {
  if (!header.kid) return cb(new Error("JWT sin kid"), undefined as any);
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return cb(err, undefined as any);
    cb(null, key.getPublicKey());
  });
}

async function verifyJwt(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.sendStatus(401);
    return;
  }
  const token = auth.slice(7);
  jwt.verify(
    token,
    getSigningKey,
    { algorithms: ["RS256"], audience, issuer },
    (err) => {
      if (err) {
        console.error("JWT inválido:", err.message);
        res.sendStatus(401);
      } else {
        next();
      }
    }
  );
}

async function marketplaceHandler(req: Request, res: Response): Promise<void> {
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);
  try {
    const { id, subscriptionId, action, planId, quantity } = req.body as any;
    const opUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/operations/${id}?api-version=2022-03-01`;
    const bearer = await getMarketplaceToken();
    
    // Confirmo que la operación está InProgress
    const opRes  = await fetch(opUrl, { headers: { Authorization: `Bearer ${bearer}` } });
    const opJson = await opRes.json();
  console.log("Operación JSON:", opJson);
    if (opJson.status !== "InProgress") {
      res.sendStatus(200);
      return;
    }

  // Upsert en tabla MarketplaceSubscriptions
  const entity = {
    partitionKey: "sub",
    rowKey:      subscriptionId,
    planId,
    quantity,
    status:      action,
    lastModified: new Date().toISOString(),
  };
  console.log("Upserting entity:", entity);
  await subsTable.upsertEntity(entity);

  // Marco la operación como Succeeded
  console.log("Marcando operación como Succeeded en:", opUrl);
  await fetch(opUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: "Succeeded" }),
  });

    res.sendStatus(200);
  } catch (e) {
    console.error("Error en webhook:", e);
    res.sendStatus(500);
  }
}

// ── Exporto el router listo para usar en index.ts
export const marketplaceRouter = express.Router()
  .use(express.json({ limit: "1mb" }))
  .use(verifyJwt)
  .post("/", marketplaceHandler);
