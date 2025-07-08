// src/webhook/landingPageHandler.ts

import express, { Request, Response } from "express";
import fetch from "node-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// ── Configuración de la tabla MarketplaceSubscriptions
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key     = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const subsTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "MarketplaceSubscriptions",
  new AzureNamedKeyCredential(account, key)
);

// ── Función para decodificar el token y extraer información del tenant
function decodeMarketplaceToken(token: string): { tenantId?: string; subscriptionId?: string } {
  try {
    // El token viene en base64, vamos a decodificarlo para ver si podemos extraer info
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    console.log("🔍 [Landing] Token decodificado (primeros 200 chars):", decoded.substring(0, 200));
    
    // Buscar patrones de tenant ID (formato GUID)
    const tenantMatch = decoded.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    if (tenantMatch && tenantMatch.length > 0) {
      console.log("🎯 [Landing] Posibles tenant IDs encontrados:", tenantMatch);
      return { tenantId: tenantMatch[0] };
    }
    
    return {};
  } catch (error) {
    console.warn("⚠️ [Landing] No se pudo decodificar el token:", error.message);
    return {};
  }
}

// ── Helper para obtener Bearer token del API con tenant específico
async function getMarketplaceToken(tenantId?: string): Promise<string> {
  try {
    // Usar el tenant específico si lo tenemos, sino usar el tenant de Incuba
    const effectiveTenantId = tenantId || process.env.MP_TENANT_ID || "13f589d5-7606-4f33-94d5-619af04f5fc8";
    
    console.log(`🔑 [Landing] Obteniendo token de marketplace para tenant: ${effectiveTenantId}`);
    
    const credential = new ClientSecretCredential(
      effectiveTenantId,
      process.env.MP_CLIENT_ID!,     
      process.env.MP_CLIENT_SECRET!  
    );
    
    const { token } = await credential.getToken("https://marketplaceapi.microsoft.com/.default");
    if (!token) {
      throw new Error("No se pudo obtener el token de autenticación");
    }
    console.log("✅ [Landing] Token obtenido exitosamente");
    return token;
  } catch (error) {
    console.error("❌ [Landing] Error obteniendo token:", error);
    throw error;
  }
}

// ── Función para resolver el token de landing page SIN autenticación previa
async function resolveLandingPageTokenDirect(token: string) {
  console.log("🔍 [Landing] Resolviendo token de landing page directamente...");
  
  const resolveUrl = "https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31";
  
  // Intentar resolver directamente con el token de marketplace
  const response = await fetch(resolveUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ms-marketplace-token": token
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [Landing] Error resolviendo token directamente: ${response.status} ${response.statusText}`);
    console.error("[Landing] Error details:", errorText);
    throw new Error(`Error ${response.status}: ${errorText}`);
  }

  const subscriptionInfo = await response.json();
  console.log("✅ [Landing] Token resuelto directamente:", JSON.stringify(subscriptionInfo, null, 2));
  return subscriptionInfo;
}

// ── Función para resolver el token de landing page CON autenticación
async function resolveLandingPageTokenWithAuth(token: string, tenantId?: string) {
  console.log("🔍 [Landing] Resolviendo token de landing page con autenticación...");
  
  const resolveUrl = "https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31";
  const bearerToken = await getMarketplaceToken(tenantId);
  
  const response = await fetch(resolveUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      "x-ms-marketplace-token": token
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [Landing] Error resolviendo token con auth: ${response.status} ${response.statusText}`);
    console.error("[Landing] Error details:", errorText);
    throw new Error(`Error ${response.status}: ${errorText}`);
  }

  const subscriptionInfo = await response.json();
  console.log("✅ [Landing] Token resuelto con auth:", JSON.stringify(subscriptionInfo, null, 2));
  return subscriptionInfo;
}

// ── Función para activar la suscripción
async function activateSubscription(subscriptionId: string, planId: string, tenantId?: string) {
  console.log(`🚀 [Landing] Activando suscripción ${subscriptionId} con plan ${planId}...`);
  
  const activateUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/activate?api-version=2018-08-31`;
  const bearerToken = await getMarketplaceToken(tenantId);
  
  const response = await fetch(activateUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json"
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

    // Paso 0: Intentar extraer información del token
    const tokenInfo = decodeMarketplaceToken(token);
    console.log("🔍 [Landing] Información extraída del token:", tokenInfo);

    let subscriptionInfo;
    
    try {
      // Paso 1a: Intentar resolver directamente (sin Bearer token)
      console.log("🔄 [Landing] Intentando resolución directa...");
      subscriptionInfo = await resolveLandingPageTokenDirect(token);
    } catch (directError) {
      console.warn("⚠️ [Landing] Resolución directa falló, intentando con autenticación...");
      
      try {
        // Paso 1b: Intentar con autenticación usando tenant extraído
        subscriptionInfo = await resolveLandingPageTokenWithAuth(token, tokenInfo.tenantId);
      } catch (authError) {
        console.warn("⚠️ [Landing] Resolución con tenant extraído falló, intentando con tenant por defecto...");
        
        // Paso 1c: Intentar con tenant por defecto
        subscriptionInfo = await resolveLandingPageTokenWithAuth(token);
      }
    }
    
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
      tenantId: tokenInfo.tenantId || "unknown",
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    
    console.log("💾 [Landing] Guardando en tabla:", JSON.stringify(entity, null, 2));
    await subsTable.upsertEntity(entity);

    // Paso 3: Activar la suscripción
    await activateSubscription(subscriptionId, planId, tokenInfo.tenantId);

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
      tenantId: tokenInfo.tenantId,
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
    environment: {
      hasCredentials: !!(process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET),
      hasStorage: !!(process.env.AZURE_STORAGE_ACCOUNT_NAME && process.env.AZURE_STORAGE_ACCOUNT_KEY),
      tenantMode: "dynamic"
    }
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