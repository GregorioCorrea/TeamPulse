import express, { Request, Response, NextFunction } from "express";
import jwt, { JwtHeader, SigningKeyCallback } from "jsonwebtoken";
import JwksClient from "jwks-rsa";
import { ClientSecretCredential } from "@azure/identity";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// ── SP Credentials para llamar al SaaS Fulfillment API
const credential = new ClientSecretCredential(
//  process.env.MP_TENANT_ID!, //esto es si usás un tenant específico
  "common", // para usar el tenant común de Microsoft   
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

type SubscriptionEntity = Record<string, any> & { partitionKey: string; rowKey: string; };

const RESERVED_ENTITY_KEYS = new Set<string>(['etag', 'timestamp', 'odata.metadata', 'odata.etag', '_response']);

function sanitizeEntity(raw: Record<string, any>): SubscriptionEntity {
  const entity: SubscriptionEntity = {
    partitionKey: raw.partitionKey as string,
    rowKey: raw.rowKey as string
  };

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'partitionKey' || key === 'rowKey') {
      continue;
    }
    if (RESERVED_ENTITY_KEYS.has(key)) {
      continue;
    }
    entity[key] = value;
  }

  return entity;
}

async function loadSubscriptionEntity(subscriptionId: string): Promise<{ entity: SubscriptionEntity | null; partitionKey: string; }> {
  const partitions = ['landing', 'sub'];
  for (const partitionKey of partitions) {
    try {
      const entity = await subsTable.getEntity(partitionKey, subscriptionId);
      return { entity: sanitizeEntity(entity as Record<string, any>), partitionKey };
    } catch (error: any) {
      if (error?.statusCode && error.statusCode !== 404) {
        console.warn(`⚠️ Error obteniendo suscripción ${subscriptionId} en partition ${partitionKey}:`, error.message || error);
      }
    }
  }
  return { entity: null, partitionKey: 'landing' };
}

function normalizeMarketplaceStatus(action?: string, operationStatus?: string): string {
  const normalizedAction = (action || '').toLowerCase();
  switch (normalizedAction) {
    case 'activate':
    case 'changeplan':
    case 'changequantity':
    case 'reinstate':
    case 'renew':
      return 'Activated';
    case 'suspend':
      return 'Suspended';
    case 'unsubscribe':
    case 'delete':
      return 'Unsubscribed';
    default:
      break;
  }

  const normalizedOp = (operationStatus || '').toLowerCase();
  if (normalizedOp === 'succeeded') return 'Activated';
  if (normalizedOp === 'failed') return 'Failed';

  return 'Pending';
}

function coerceQuantity(value: any): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}


// ── Helper para obtener Bearer token del API
async function getMarketplaceToken(): Promise<string> {
  const { token } = await credential.getToken("20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default");
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
    const { id, subscriptionId, action, planId, quantity, offerId } = req.body as any;

    if (!subscriptionId || !id) {
      console.error("❌ Payload inválido en webhook de marketplace:", { id, subscriptionId });
      res.status(400).json({
        error: 'invalid_payload',
        message: 'Missing subscriptionId or operation id'
      });
      return;
    }

    const opUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/operations/${id}?api-version=2022-03-01`;
    const bearer = await getMarketplaceToken();

    const opRes = await fetch(opUrl, { headers: { Authorization: `Bearer ${bearer}` } });
    const opJson = await opRes.json() as any;
    console.log("Operación JSON:", opJson);

    const { entity: existingEntity, partitionKey } = await loadSubscriptionEntity(subscriptionId);

    let entity: SubscriptionEntity;
    if (existingEntity) {
      entity = { ...existingEntity };
    } else {
      entity = {
        partitionKey,
        rowKey: subscriptionId,
        subscriptionId,
        createdAt: new Date().toISOString(),
        source: 'MarketplaceWebhook'
      };
      console.log(`ℹ️ Creando registro de suscripción ${subscriptionId} desde webhook`);
    }

    if (!entity.partitionKey) {
      entity.partitionKey = 'landing';
    }

    if (!entity.subscriptionId) {
      entity.subscriptionId = subscriptionId;
    }

    const resolvedPlanId = planId || opJson?.planId || entity.planId;
    if (resolvedPlanId) {
      entity.planId = resolvedPlanId;
    }

    const resolvedQuantity = coerceQuantity(quantity) ?? coerceQuantity(opJson?.quantity) ?? (entity.quantity as number | undefined);
    if (resolvedQuantity !== undefined) {
      entity.quantity = resolvedQuantity;
    }

    if (offerId && !entity.offerId) {
      entity.offerId = offerId;
    }

    entity.status = normalizeMarketplaceStatus(action, opJson?.status);
    entity.lastModified = new Date().toISOString();
    entity.operationId = id;
    if (action) {
      entity.operationAction = action;
    }
    if (opJson?.status) {
      entity.operationState = opJson.status;
    }
    if (opJson?.planId) {
      entity.operationPlanId = opJson.planId;
    }
    if (opJson?.quantity !== undefined) {
      entity.operationQuantity = opJson.quantity;
    }

    if (!entity.createdAt) {
      entity.createdAt = new Date().toISOString();
    }

    if (!entity.source) {
      entity.source = 'MarketplaceWebhook';
    }

    for (const [key, value] of Object.entries(entity)) {
      if (value === undefined) {
        delete entity[key];
      }
    }

    console.log("Upserting entity:", entity);
    await subsTable.upsertEntity(entity);

    if (String(opJson.status || '').toLowerCase() === 'inprogress') {
      console.log("Marcando operación como Succeeded en:", opUrl);
      await fetch(opUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "Succeeded" }),
      });
    } else {
      console.log(`ℹ️ Operación ${id} reportada con estado ${opJson.status}, no se envía PATCH.`);
    }

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
