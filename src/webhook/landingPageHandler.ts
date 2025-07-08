// src/webhook/landingPageHandler.ts - Arquitectura correcta según Microsoft

import express, { Request, Response } from "express";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import { ClientSecretCredential } from "@azure/identity";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// ── Configuración para App 2 (Single-tenant, solo para APIs)
const apiCredential = new ClientSecretCredential(
  process.env.MP_API_TENANT_ID!,     // Tenant de Incuba Consultores
  process.env.MP_API_CLIENT_ID!,     // App 2 Client ID
  process.env.MP_API_CLIENT_SECRET!  // App 2 Secret
);

// ── Configuración de la tabla MarketplaceSubscriptions
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key     = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const subsTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "MarketplaceSubscriptions",
  new AzureNamedKeyCredential(account, key)
);

// ── Helper para obtener Bearer token SOLO para APIs (App 2)
async function getMarketplaceApiToken(): Promise<string> {
  try {
    console.log("🔑 [Landing] Obteniendo token de API (App 2)...");
    
    // Usar el scope correcto con App 2 (single-tenant)
    const { token } = await apiCredential.getToken("20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default");
    
    if (!token) {
      throw new Error("No se pudo obtener el token de API");
    }
    console.log("✅ [Landing] Token de API obtenido exitosamente");
    return token;
  } catch (error) {
    console.error("❌ [Landing] Error obteniendo token de API:", error);
    throw error;
  }
}

// ── Función para validar ID Token del SSO (App 1)
function validateIdToken(idToken: string): any {
  try {
    // Decodificar sin verificar por ahora (en producción necesitarías verificar la firma)
    const decoded = jwt.decode(idToken, { complete: true });
    console.log("🔍 [Landing] ID Token decodificado:", JSON.stringify(decoded, null, 2));
    return decoded?.payload;
  } catch (error) {
    console.error("❌ [Landing] Error validando ID token:", error);
    throw new Error("ID Token inválido");
  }
}

// ── Función para resolver el marketplace token
async function resolveLandingPageToken(marketplaceToken: string) {
  console.log("🔍 [Landing] Resolviendo marketplace token...");
  
  const resolveUrl = "https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31";
  const bearerToken = await getMarketplaceApiToken();
  
  const response = await fetch(resolveUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      "x-ms-marketplace-token": marketplaceToken
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [Landing] Error resolviendo marketplace token: ${response.status} ${response.statusText}`);
    console.error("[Landing] Error details:", errorText);
    throw new Error(`Error ${response.status}: ${errorText}`);
  }

  const subscriptionInfo = await response.json();
  console.log("✅ [Landing] Marketplace token resuelto:", JSON.stringify(subscriptionInfo, null, 2));
  return subscriptionInfo;
}

// ── Función para activar la suscripción
async function activateSubscription(subscriptionId: string, planId: string) {
  console.log(`🚀 [Landing] Activando suscripción ${subscriptionId} con plan ${planId}...`);
  
  const activateUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/activate?api-version=2018-08-31`;
  const bearerToken = await getMarketplaceApiToken();
  
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

// ── Handler principal para procesar AMBOS tokens
async function landingPageHandler(req: Request, res: Response): Promise<void> {
  console.log("\n🎯 === [LANDING PAGE] PROCESANDO TOKENS (SSO + Marketplace) ===");
  console.log("[Landing] Headers:", JSON.stringify(req.headers, null, 2));
  console.log("[Landing] Body:", JSON.stringify(req.body, null, 2));

  try {
    const { marketplaceToken, idToken } = req.body;
    
    if (!marketplaceToken || !idToken) {
      console.error("❌ [Landing] Faltan tokens requeridos");
      res.status(400).json({ 
        success: false, 
        error: "Se requieren tanto marketplaceToken como idToken" 
      });
      return;
    }

    console.log(`📨 [Landing] Marketplace token (primeros 50 chars): ${marketplaceToken.substring(0, 50)}...`);
    console.log(`🔐 [Landing] ID token (primeros 50 chars): ${idToken.substring(0, 50)}...`);

    // Paso 1: Validar ID Token del SSO (información del usuario)
    const userInfo = validateIdToken(idToken);
    console.log("👤 [Landing] Información del usuario:", {
      oid: userInfo.oid,
      name: userInfo.name,
      email: userInfo.email || userInfo.preferred_username,
      tid: userInfo.tid
    });

    // Paso 2: Resolver el marketplace token para obtener información de la suscripción
    const subscriptionInfo = await resolveLandingPageToken(marketplaceToken);
    
    const { 
      id: subscriptionId, 
      planId, 
      offerId,
      quantity = 1 
    } = subscriptionInfo;

    console.log(`📋 [Landing] Información completa:
      USUARIO:
      - OID: ${userInfo.oid}
      - Nombre: ${userInfo.name}
      - Email: ${userInfo.email || userInfo.preferred_username}
      - Tenant: ${userInfo.tid}
      
      SUSCRIPCIÓN:
      - ID: ${subscriptionId}
      - Plan: ${planId}
      - Offer: ${offerId}
      - Cantidad: ${quantity}`);

    // Paso 3: Guardar en la tabla con información completa
    const entity = {
      partitionKey: "landing",
      rowKey: subscriptionId,
      // Información de suscripción
      planId,
      offerId,
      quantity,
      status: "PendingActivation",
      source: "LandingPageSSO",
      // Información del usuario
      userOid: userInfo.oid,
      userName: userInfo.name,
      userEmail: userInfo.email || userInfo.preferred_username,
      userTenant: userInfo.tid,
      // Timestamps
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    
    console.log("💾 [Landing] Guardando en tabla:", JSON.stringify(entity, null, 2));
    await subsTable.upsertEntity(entity);

    // Paso 4: Activar la suscripción
    await activateSubscription(subscriptionId, planId);

    // Paso 5: Actualizar estado en la tabla
    entity.status = "Activated";
    entity.lastModified = new Date().toISOString();
    await subsTable.upsertEntity(entity);

    console.log("🎉 [Landing] ¡Proceso completado exitosamente con SSO!");
    
    res.status(200).json({ 
      success: true, 
      message: "Suscripción activada correctamente",
      subscriptionId,
      planId,
      user: {
        name: userInfo.name,
        email: userInfo.email || userInfo.preferred_username
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("💥 [Landing] Error procesando tokens:", error);
    
    res.status(500).json({ 
      success: false, 
      error: "Error interno del servidor",
      details: error instanceof Error ? error.message : "Error desconocido"
    });
  }
}

// ── Handler para obtener información de SSO (solo para debug/testing)
async function ssoInfoHandler(req: Request, res: Response): Promise<void> {
  console.log("\n🔍 === [SSO INFO] DEBUG ===");
  
  res.status(200).json({
    landingClientId: process.env.MP_API_CLIENT_ID,
    redirectUri: `${req.protocol}://${req.get('host')}/api/marketplace/landing/callback`,
    tenantId: "common", // Para multi-tenant
    authority: "https://login.microsoftonline.com/common",
    scopes: ["openid", "profile", "email"]
  });
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
    service: "TeamPulse Landing Page Handler - Arquitectura correcta",
    architecture: "Two-app separation",
    apps: {
      landing: {
        clientId: process.env.MP_API_CLIENT_ID ? "configured" : "missing",
        type: "single-tenant"
      },
      api: {
        clientId: process.env.MP_LANDING_CLIENT_ID ? "configured" : "missing", 
        type: "multi-tenant"
      }
    }
  });
}

// ── Exporto el router para landing page
export const landingPageRouter = express.Router()
  .use(express.json({ limit: "1mb" }))
  .use(landingDebugMiddleware)
  
  // Health check específico
  .get("/health", landingHealthCheck)
  
  // Información de configuración SSO para el frontend
  .get("/sso-config", ssoInfoHandler)
  
  // Endpoint principal para procesar AMBOS tokens (marketplace + id token)
  .post("/activate", landingPageHandler);