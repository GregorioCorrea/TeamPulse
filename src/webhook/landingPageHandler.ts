// src/webhook/landingPageHandler.ts

import express, { Request, Response } from "express";
import fetch from "node-fetch";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// ── Configuración de la tabla MarketplaceSubscriptions
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key     = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const subsTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "MarketplaceSubscriptions",
  new AzureNamedKeyCredential(account, key)
);

// ── Función para resolver el token de landing page SIN autenticación
async function resolveLandingPageToken(token: string) {
  console.log("🔍 [Landing] Resolviendo token de landing page (sin auth)...");
  
  const resolveUrl = "https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31";
  
  const response = await fetch(resolveUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ms-marketplace-token": token
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [Landing] Error resolviendo token: ${response.status} ${response.statusText}`);
    console.error("[Landing] Error details:", errorText);
    throw new Error(`Error ${response.status}: ${errorText}`);
  }

  const subscriptionInfo = await response.json();
  console.log("✅ [Landing] Token resuelto:", JSON.stringify(subscriptionInfo, null, 2));
  return subscriptionInfo;
}

// ── Función para activar la suscripción SIN autenticación
async function activateSubscription(subscriptionId: string, planId: string, token: string) {
  console.log(`🚀 [Landing] Activando suscripción ${subscriptionId} con plan ${planId}...`);
  
  const activateUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/activate?api-version=2018-08-31`;
  
  const response = await fetch(activateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ms-marketplace-token": token
    },
    body: JSON.stringify({
      planId: planId,
      quantity: 1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [Landing] Error activando suscripción: ${response.status} ${response.statusText}`);
    console.error("[Landing] Error details:", errorText);
    throw new Error(`Error ${response.status}: ${errorText}`);
  }

  console.log("✅ [Landing] Suscripción activada exitosamente");
  return response.status === 200;
}

// ── Handler principal para el landing page token
async function landingPageHandler(req: Request, res: Response): Promise<void> {
  console.log("\n🎯 === [LANDING PAGE] PROCESANDO TOKEN ===");
  console.log("[Landing] Headers:", JSON.stringify(req.headers, null, 2));
  console.log("[Landing] Body:", JSON.stringify(req.body, null, 2));

  try {
    const { token } = req.body;
    
    if (!token) {
      console.error("❌ [Landing] No se proporcionó token");
      res.status(400).json({ 
        success: false, 
        error: "Token requerido" 
      });
      return;
    }

    console.log(`📨 [Landing] Token recibido (primeros 50 chars): ${token.substring(0, 50)}...`);

    // Paso 1: Resolver el token para obtener información de la suscripción
    const subscriptionInfo = await resolveLandingPageToken(token);
    
    const { 
      id: subscriptionId, 
      planId, 
      offerId,
      quantity = 1 
    } = subscriptionInfo;

    console.log(`📋 [Landing] Información de suscripción:
      - ID: ${subscriptionId}
      - Plan: ${planId}
      - Offer: ${offerId}
      - Cantidad: ${quantity}`);

    // Paso 2: Guardar en la tabla de Azure
    const entity = {
      partitionKey: "landing",
      rowKey: subscriptionId,
      planId,
      offerId,
      quantity,
      status: "PendingActivation",
      source: "LandingPage",
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    
    console.log("💾 [Landing] Guardando en tabla:", JSON.stringify(entity, null, 2));
    await subsTable.upsertEntity(entity);

    // Paso 3: Activar la suscripción usando el mismo token
    await activateSubscription(subscriptionId, planId, token);

    // Paso 4: Actualizar estado en la tabla
    entity.status = "Activated";
    entity.lastModified = new Date().toISOString();
    await subsTable.upsertEntity(entity);

    console.log("🎉 [Landing] ¡Proceso completado exitosamente!");
    
    res.status(200).json({ 
      success: true, 
      message: "Suscripción activada correctamente",
      subscriptionId,
      planId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("💥 [Landing] Error procesando token:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : "Error desconocido"
    });
  }
}

// ── Middleware para debug específico del landing page
function landingDebugMiddleware(req: Request, res: Response, next: express.NextFunction): void {
  const timestamp = new Date().toISOString();
  console.log(`\n🔍 [Landing] ${timestamp} - ${req.method} ${req.path}`);
  console.log("🌍 [Landing] Origin:", req.headers.origin);
  console.log("📱 [Landing] User-Agent:", req.headers['user-agent']?.substring(0, 100));
  next();
}

// ── Health check específico para landing page
function landingHealthCheck(req: Request, res: Response): void {
  res.status(200).json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    service: "TeamPulse Landing Page Handler",
    mode: "no-auth"
  });
}

// ── Exporto el router para landing page
export const landingPageRouter = express.Router()
  .use(express.json({ limit: "1mb" }))
  .use(landingDebugMiddleware)
  
  // Health check específico
  .get("/health", landingHealthCheck)
  
  // Endpoint principal para procesar landing page tokens
  .post("/activate", landingPageHandler);