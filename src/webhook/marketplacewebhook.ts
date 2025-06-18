/**
 * TeamPulse – Webhook Marketplace (token auto)
 * Variables necesarias (App Service / GitHub Secrets):
 *   MP_TENANT_ID, MP_CLIENT_ID, MP_CLIENT_SECRET
 */
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { TableClient } from "@azure/data-tables";

const credential = new ClientSecretCredential(
  process.env.MP_TENANT_ID!,
  process.env.MP_CLIENT_ID!,
  process.env.MP_CLIENT_SECRET!
);

const STORAGE_CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!;
const subsTable = TableClient.fromConnectionString(STORAGE_CONN, "Subscriptions");

/* ---------- Helper para pedir un token cada vez que lo necesitemos ---------- */
async function getMarketplaceToken(): Promise<string> {
  const scope = "https://marketplaceapi.microsoft.com/.default";
  const { token } = await credential.getToken(scope);
  return token!;
}

/* -------------------------- Express Handler --------------------------------- */
export async function marketplaceWebhook(req: Request, res: Response) {
  try {
    /* 1) Validar JWT de Microsoft */
    const auth = req.headers.authorization ?? "";
    const [, jwtToken] = auth.split(" ");
    const decoded: any = jwt.decode(jwtToken, { complete: true });
    if (!decoded) return res.status(401).end();

    /* 2) Leer payload */
    const p = req.body as any;
    const { id, subscriptionId, action } = p;

    /* 3) Confirmar operación en Marketplace */
    const api = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/operations/${id}?api-version=2022-03-01`;
    const bearer = await getMarketplaceToken();
    const opRes = await fetch(api, { headers: { Authorization: `Bearer ${bearer}` } });
    const opJson: any = await opRes.json();
    if (opJson.status !== "InProgress") return res.status(200).end();

    /* 4) Actualizar Storage */
    await subsTable.upsertEntity({
      partitionKey: "sub",
      rowKey: subscriptionId,
      planId: p.planId,
      quantity: p.quantity,
      status: action,
      lastModified: new Date().toISOString(),
    });

    /* 5) Informar éxito a Microsoft */
    await fetch(api, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "Succeeded" }),
    });

    return res.status(200).end();
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(500).end();
  }
}
