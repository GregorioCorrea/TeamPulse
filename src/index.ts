// src/index.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express from "express";
import cors from "cors";
import path from "path";
import adapter from "./adapter";
import appBot from "./app/app";
import { marketplaceRouter } from "./webhook/marketplacewebhook";
import { landingPageRouter } from "./webhook/landingPageHandler"; // 🆕 Router actualizado con SSO
import { adminRouter } from "./routes/adminRoutes"; // 🆕 Admin panel routes

const app = express();
app.use(express.json());

// CORS – actualizado para SSO y Admin Panel
app.use(
  cors({
    origin: [
      "https://teampulse.incumate.io", 
      "https://login.microsoftonline.com", // 🆕 Microsoft login
      "https://teams.microsoft.com",       // 🆕 Teams app
      "https://*.teams.microsoft.com"      // 🆕 Teams subdomains
    ], 
    methods: ["POST", "OPTIONS", "GET", "PUT", "PATCH", "DELETE"], // 🆕 Admin methods
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false        
  })
);

// ── Application Insights (silencioso si falla) ────────────────────
let telemetryClient: any = { trackEvent: () => {}, trackException: () => {} };
try {
  // desactivar los conflictos de opentelemetry
  process.env.APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL = "true";

  const ai = require("applicationinsights");
  if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    ai
      .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoDependencyCorrelation(true)
      .start();
    telemetryClient = ai.defaultClient;
  }
} catch (e) {
  console.warn("⚠️ AppInsights init failed (se ignora):", e.message || e);
}

// ── 🆕 ADMIN PANEL ROUTES ────────────────────────────────────────
app.use("/api/admin", adminRouter);

// ── 🆕 SERVE ADMIN PANEL HTML ────────────────────────────────────
app.get("/admin", (req, res) => {
  // Múltiples rutas posibles
  const possiblePaths = [
    path.join(process.cwd(), "admin", "adminPanel.html"),
    path.join(__dirname, "..", "admin", "adminPanel.html"),
    path.join(__dirname, "..", "..", "admin", "adminPanel.html"),
    path.join(__dirname, "..", "..", "src/admin", "adminPanel.html"),
    path.join(__dirname, "admin", "adminPanel.html")
  ];

  for (const filePath of possiblePaths) {
    try {
      if (require('fs').existsSync(filePath)) {
        console.log(`✅ Found admin panel at: ${filePath}`);
        return res.sendFile(filePath);
      }
    } catch (error) {
      console.log(`❌ Path not found: ${filePath}`);
    }
  }

  // Si ninguna ruta funciona
  res.status(404).send("Admin panel not found");
});

// ── 🆕 ADMIN PANEL ASSETS (if needed) ────────────────────────────
app.use("/admin/assets", express.static(path.join(__dirname, "..", "admin", "assets")));

// ── Webhook de Marketplace (JWT + JSON) - SIN CAMBIOS ────────────
app.use("/api/marketplace/webhook", marketplaceRouter);

// ── 🆕 Landing Page Handler con SSO (nuevo endpoint) ──────────────
app.use("/api/marketplace/landing", landingPageRouter);

// ── Health checks ────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  telemetryClient.trackEvent({ name: "HealthCheck" });
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/marketplace/health", (_req, res) => {
  telemetryClient.trackEvent({ name: "MarketplaceHealthCheck" });
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "TeamPulse Marketplace Webhook",
  });
});

// 🆕 Health check para arquitectura completa (actualizado)
app.get("/api/marketplace/status", (_req, res) => {
  telemetryClient.trackEvent({ name: "MarketplaceArchitectureStatus" });
  res.json({
    status: "operational",
    timestamp: new Date().toISOString(),
    architecture: "Complete TeamPulse with Admin Panel",
    services: {
      webhook: "active",
      landingPageSSO: "active",
      adminPanel: "active",        // 🆕
      botFramework: "active"
    },
    endpoints: {
      webhook: "/api/marketplace/webhook",
      landingPageActivate: "/api/marketplace/landing/activate",
      landingPageSsoConfig: "/api/marketplace/landing/sso-config",
      adminPanel: "/admin",         // 🆕
      adminAPI: "/api/admin/*",     // 🆕
      botMessages: "/api/messages",
      health: "/api/marketplace/health"
    },
    apps: {
      landingApp: {
        clientId: process.env.MP_LANDING_CLIENT_ID ? "configured" : "missing",
        type: "multi-tenant"
      },
      apiApp: {
        clientId: process.env.MP_API_CLIENT_ID ? "configured" : "missing",
        type: "single-tenant"
      },
      adminPanel: {                 // 🆕
        authentication: "Teams SSO",
        permissions: "Admin only",
        features: "CRUD surveys, analytics, export"
      }
    }
  });
});

// 🆕 Admin health check específico
app.get("/api/admin/health", (_req, res) => {
  telemetryClient.trackEvent({ name: "AdminPanelHealthCheck" });
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "TeamPulse Admin Panel",
    features: {
      authentication: "Teams SSO",
      crud: "enabled",
      analytics: "enabled",
      export: "enabled"
    },
    version: "1.0.0"
  });
});

// ── Bot Framework endpoint ───────────────────────────────────────
app.post("/api/messages", async (req, res) => {
  telemetryClient.trackEvent({ name: "BotMessageReceived" });
  await adapter.process(req, res as any, async (context) => {
    await appBot.run(context);
  });
});

// ── 🆕 ROOT REDIRECT ─────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.send(`
    <html>
      <head>
        <title>TeamPulse - Smart Survey Bot</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; 
            margin: 0; 
            padding: 40px; 
            text-align: center;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          }
          .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 8px 32px rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
            max-width: 600px;
          }
          h1 { font-size: 3rem; margin-bottom: 20px; }
          .subtitle { font-size: 1.2rem; margin-bottom: 30px; opacity: 0.9; }
          .links { display: flex; flex-direction: column; gap: 15px; }
          .link { 
            background: rgba(255, 255, 255, 0.2);
            color: white;
            padding: 15px 25px;
            text-decoration: none;
            border-radius: 12px;
            transition: all 0.3s ease;
            border: 1px solid rgba(255, 255, 255, 0.3);
          }
          .link:hover { 
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
          }
          .admin-link {
            background: linear-gradient(135deg, #ff6b6b, #ee5a24);
            font-weight: bold;
          }
          .status { 
            margin-top: 30px; 
            font-size: 0.9rem; 
            opacity: 0.7;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎯 TeamPulse</h1>
          <p class="subtitle">Smart Survey & Feedback Bot para Microsoft Teams</p>
          
          <div class="links">
            <a href="/admin" class="link admin-link">
              🛠️ Panel de Administración
            </a>
            <a href="/api/marketplace/status" class="link">
              📊 Estado del Sistema
            </a>
            <a href="https://teampulse.incumate.io" class="link" target="_blank">
              🌐 Sitio Web Oficial
            </a>
            <a href="https://teampulse.incumate.io/support" class="link" target="_blank">
              💬 Soporte y Documentación
            </a>
          </div>
          
          <div class="status">
            ✅ Servidor activo • Bot Framework operativo • Admin Panel habilitado
          </div>
        </div>
      </body>
    </html>
  `);
});

// ── 🆕 ERROR HANDLING MIDDLEWARE ─────────────────────────────────
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);
  
  telemetryClient.trackException({ exception: err });
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: err.stack })
  });
});

// ── 🆕 404 HANDLER ───────────────────────────────────────────────
app.use((req: express.Request, res: express.Response) => {
  console.log(`⚠️ 404 - Route not found: ${req.method} ${req.path}`);
  
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString(),
    availableRoutes: {
      admin: '/admin',
      adminAPI: '/api/admin/*',
      bot: '/api/messages',
      marketplace: '/api/marketplace/*',
      health: '/api/health'
    }
  });
});

// ── Arrancar servidor ─────────────────────────────────────────────
const port = process.env.PORT || 3978;
app.listen(port, () => {
  telemetryClient.trackEvent({ 
    name: "ServerStarted", 
    properties: { 
      port: port.toString(),
      hasAdminPanel: "true" // 🆕
    } 
  });
  
  console.log(`🚀 TeamPulse Agent started successfully!`);
  console.log(`📡 Listening on: http://localhost:${port}`);
  console.log(`\n🔗 Available endpoints:`);
  console.log(`   🤖 Bot Framework:     http://localhost:${port}/api/messages`);
  console.log(`   🛠️  Admin Panel:       http://localhost:${port}/admin`);
  console.log(`   📊 Admin API:         http://localhost:${port}/api/admin/*`);
  console.log(`   📦 Marketplace:       http://localhost:${port}/api/marketplace/*`);
  console.log(`   🌐 Landing SSO:       http://localhost:${port}/api/marketplace/landing/*`);
  console.log(`   ❤️  Health Check:      http://localhost:${port}/api/health`);
  console.log(`   📋 System Status:     http://localhost:${port}/api/marketplace/status`);
  console.log(`\n🎯 Features enabled:`);
  console.log(`   ✅ Bot with OpenAI integration`);
  console.log(`   ✅ Azure Table Storage`);
  console.log(`   ✅ Marketplace webhooks`);
  console.log(`   ✅ SSO authentication`);
  console.log(`   ✅ Admin Panel with CRUD`);
  console.log(`   ✅ Templates system`);
  console.log(`   ✅ Analytics & Export`);
  console.log(`\n🏗️ Architecture: Complete TeamPulse with Admin Panel`);
});