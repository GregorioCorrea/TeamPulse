// src/webhook/landingPageHandler.ts - Con OAuth server-side proxy

import express, { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ClientSecretCredential } from "@azure/identity";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";
import { URLSearchParams } from "url";

// ✅ CORRECTO: Usar App 1 para todo
const apiCredential = new ClientSecretCredential(
  "13f589d5-7606-4f33-94d5-619af04f5fc8",  // Tenant específico  
  process.env.MP_LANDING_CLIENT_ID!,        // ← App 1 (la del marketplace)
  process.env.MP_LANDING_CLIENT_SECRET!     // ← App 1 secret
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
    const { token } = await apiCredential.getToken([
      "20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default"
    ], {
      tenantId: process.env.MP_API_TENANT_ID
    });
    
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

// ── 🆕 OAuth server-side: Iniciar login
async function startOAuthLogin(req: Request, res: Response): Promise<void> {
  console.log("\n🔐 === [OAuth] INICIANDO LOGIN SERVER-SIDE ===");
  
  try {
    const { marketplaceToken } = req.query;
    
    if (!marketplaceToken) {
      res.status(400).json({ error: "Se requiere marketplace token" });
      return;
    }

    // Guardar marketplace token en session/database temporal
    // Por simplicidad, vamos a usar un store en memoria (en producción usar Redis)
    const stateId = generateStateId();
    temporalStore.set(stateId, {
      marketplaceToken: marketplaceToken as string,
      timestamp: Date.now()
    });

    // Construir URL de autorización de Microsoft
    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", process.env.MP_LANDING_CLIENT_ID!);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", `https://${req.get('host')}/api/marketplace/landing/oauth-callback`);
    authUrl.searchParams.set("scope", "openid profile email");
    authUrl.searchParams.set("state", stateId);
    authUrl.searchParams.set("prompt", "select_account");

    console.log("🔄 [OAuth] Redirigiendo a Microsoft:", authUrl.toString());
    
    // Redirigir al usuario a Microsoft
    res.redirect(authUrl.toString());
    
  } catch (error) {
    console.error("❌ [OAuth] Error iniciando login:", error);
    res.status(500).json({ error: "Error iniciando autenticación" });
  }
}

// ── 🆕 OAuth server-side: Callback de Microsoft
async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  console.log("\n🔄 === [OAuth] PROCESANDO CALLBACK DE MICROSOFT ===");
  console.log("[OAuth] Query params:", req.query);
  
  try {
    const { code, state, error: oauthError } = req.query;
    
    if (oauthError) {
      console.error("❌ [OAuth] Error de Microsoft:", oauthError);
      return redirectToFrontendWithError(res, `Error de autenticación: ${oauthError}`);
    }

    if (!code || !state) {
      console.error("❌ [OAuth] Faltan parámetros requeridos");
      return redirectToFrontendWithError(res, "Parámetros de autenticación inválidos");
    }

    // Recuperar marketplace token usando state
    const stateData = temporalStore.get(state as string);
    if (!stateData) {
      console.error("❌ [OAuth] State inválido o expirado");
      return redirectToFrontendWithError(res, "Sesión de autenticación expirada");
    }

    console.log("🎫 [OAuth] Marketplace token recuperado del state");

    // Intercambiar código por tokens
    const tokens = await exchangeCodeForTokens(
      code as string, 
      `https://${req.get('host')}/api/marketplace/landing/oauth-callback`
    );

    console.log("✅ [OAuth] Tokens obtenidos de Microsoft");

    // Procesar la suscripción completa
    const result = await processCompleteSubscription(stateData.marketplaceToken, tokens.idToken);

    // Limpiar temporal store
    temporalStore.delete(state as string);

    console.log("🎉 [OAuth] ¡Proceso completado exitosamente!");

    // Redirigir al frontend con éxito
    redirectToFrontendWithSuccess(res, result);
    
  } catch (error) {
    console.error("💥 [OAuth] Error procesando callback:", error);
    redirectToFrontendWithError(res, `Error procesando autenticación: ${error.message}`);
  }
}

// ── 🆕 Intercambiar código por tokens
async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<{ idToken: string, accessToken: string }> {
  console.log("🔄 [OAuth] Intercambiando código por tokens...");
  
  const tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  
  const params = new URLSearchParams();
  params.append("client_id", process.env.MP_LANDING_CLIENT_ID!);
  params.append("client_secret", process.env.MP_LANDING_CLIENT_SECRET!);
  params.append("code", code);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirectUri);
  params.append("scope", "openid profile email");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("❌ [OAuth] Error intercambiando código:", response.status, errorText);
    throw new Error(`Error obteniendo tokens: ${response.status}`);
  }

  const tokens = await response.json();
  console.log("✅ [OAuth] Tokens intercambiados exitosamente");
  
  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token
  };
}

// ── 🆕 Procesar suscripción completa con ambos tokens
async function processCompleteSubscription(marketplaceToken: string, idToken: string) {
  console.log("🚀 [OAuth] Procesando suscripción completa...");
  
  // Validar ID Token
  const userInfo = validateIdToken(idToken);
  console.log("👤 [OAuth] Usuario autenticado:", {
    oid: userInfo.oid,
    name: userInfo.name,
    email: userInfo.email || userInfo.preferred_username
  });

  // Resolver marketplace token
  const subscriptionInfo = await resolveLandingPageToken(marketplaceToken);
  const { id: subscriptionId, planId, offerId, quantity = 1 } = subscriptionInfo;

  // Guardar en tabla
  const entity = {
    partitionKey: "landing",
    rowKey: subscriptionId,
    planId,
    offerId,
    quantity,
    status: "PendingActivation",
    source: "ServerSideSSO",
    userOid: userInfo.oid,
    userName: userInfo.name,
    userEmail: userInfo.email || userInfo.preferred_username,
    userTenant: userInfo.tid,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };
  
  await subsTable.upsertEntity(entity);

  // Activar suscripción
  await activateSubscription(subscriptionId, planId);

  // Actualizar estado
  entity.status = "Activated";
  entity.lastModified = new Date().toISOString();
  await subsTable.upsertEntity(entity);

  return {
    subscriptionId,
    planId,
    user: {
      name: userInfo.name,
      email: userInfo.email || userInfo.preferred_username
    }
  };
}

// ── Funciones existentes (sin cambios)
function validateIdToken(idToken: string): any {
  try {
    const decoded = jwt.decode(idToken, { complete: true });
    return decoded?.payload;
  } catch (error) {
    throw new Error("ID Token inválido");
  }
}

async function resolveLandingPageToken(marketplaceToken: string) {
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
    throw new Error(`Error ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function activateSubscription(subscriptionId: string, planId: string) {
  const activateUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/activate?api-version=2018-08-31`;
  const bearerToken = await getMarketplaceApiToken();
  
  const response = await fetch(activateUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ planId, quantity: 1 })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error ${response.status}: ${errorText}`);
  }
}

// ── 🆕 Helpers para redirección y almacenamiento temporal
const temporalStore = new Map<string, any>();

function generateStateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function redirectToFrontendWithSuccess(res: Response, result: any) {
  const successUrl = `https://teampulse.incumate.io?success=true&data=${encodeURIComponent(JSON.stringify(result))}`;
  res.redirect(successUrl);
}

function redirectToFrontendWithError(res: Response, error: string) {
  const errorUrl = `https://teampulse.incumate.io?error=${encodeURIComponent(error)}`;
  res.redirect(errorUrl);
}


function handleAdminConsentCallback(req: Request, res: Response): void {
  const { admin_consent, tenant, error, error_description } = req.query;

  console.log("[Landing] Admin consent callback", {
    admin_consent,
    tenant,
    error,
    error_description
  });

  if (error) {
    console.error("[Landing] Admin consent error", error, error_description);
    res.status(400).send(renderConsentPage({
      title: "No se pudo completar el consentimiento",
      message: String(error_description || error),
      status: "error"
    }));
    return;
  }

  const granted = typeof admin_consent === "string" && admin_consent.toLowerCase() === "true";

  res.send(renderConsentPage({
    title: granted ? "Consentimiento otorgado" : "Consentimiento recibido",
    message: granted
      ? "La aplicación TeamPulse API ya tiene acceso en tu tenant. Podés cerrar esta ventana."
      : "Recibimos la respuesta del portal, pero no pudimos confirmar el consentimiento. Verifica en Azure si quedó registrado.",
    status: granted ? "success" : "warning"
  }));
}

function renderConsentPage({ title, message, status }: { title: string; message: string; status: "success" | "warning" | "error"; }): string {
  const statusColor = status === "success" ? "#107c10" : status === "warning" ? "#ffaa44" : "#d13438";

  return `<!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f2f1; margin: 0; padding: 40px; }
        .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 12px 24px rgba(0,0,0,0.08); }
        h1 { font-size: 1.8rem; color: ${statusColor}; margin-bottom: 16px; }
        p { font-size: 1rem; color: #201f1e; margin-bottom: 24px; }
        .footer { font-size: 0.85rem; color: #605e5c; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
        <p class="footer">Si necesitas ayuda, escribinos a support@incumate.io.</p>
      </div>
    </body>
  </html>`;
}

// ── Middleware y health checks (sin cambios)
function landingDebugMiddleware(req: Request, res: Response, next: express.NextFunction): void {
  const timestamp = new Date().toISOString();
  console.log(`\n🔍 [Landing] ${timestamp} - ${req.method} ${req.path}`);
  next();
}

function landingHealthCheck(req: Request, res: Response): void {
  res.status(200).json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    service: "TeamPulse Landing Page Handler - Server-side OAuth",
    architecture: "OAuth Proxy"
  });
}

// ── 🆕 Router actualizado con endpoints OAuth
export const landingPageRouter = express.Router()
  .use(express.json({ limit: "1mb" }))
  .use(landingDebugMiddleware)
  
  // Health check
  .get("/health", landingHealthCheck)
  
  // 🆕 OAuth endpoints
  .get("/start-login", startOAuthLogin)           // Iniciar OAuth
  .get("/oauth-callback", handleOAuthCallback)    // Callback de Microsoft
  .get("/callback", handleAdminConsentCallback)   // Callback de admin consent
  
  // Mantener endpoints existentes por compatibilidad
  .get("/sso-config", landingHealthCheck)        // Dummy endpoint
  .post("/activate", landingHealthCheck);        // Dummy endpoint