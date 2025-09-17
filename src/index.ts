// src/index.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });


import compression from "compression";
import helmet from "helmet";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import adapter from "./adapter";
import appBot from "./app/app";
import { marketplaceRouter } from "./webhook/marketplacewebhook";
import { landingPageRouter } from "./webhook/landingPageHandler"; // 🆕 Router actualizado con SSO
import { adminRouter } from "./routes/adminRoutes"; // 🆕 Admin panel routes

const app = express();
app.set("trust proxy", 1); // detrás de Azure App Service / Front Door
app.use(express.json({ limit: "1mb" }));
app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: false, // CSP la seteamos manual en /admin
    frameguard: false,            // usamos frame-ancestors en CSP
  })
);

// CORS – compatible con Teams/SSO y Admin Panel
const allowedOrigins = [
  /^https:\/\/teampulse\.incumate\.io$/i,
  /^https:\/\/.*\.teams\.microsoft\.com$/i,
  /^https:\/\/teams\.microsoft\.com$/i,
  /^https:\/\/login\.microsoftonline\.com$/i,
  /^https:\/\/.*\.office\.net$/i,
  /^https:\/\/.*\.microsoft\.com$/i,
  /^https:\/\/.*\.cloud\.microsoft$/i,   // 👈 NUEVO
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow same-origin / server-to-server
      if (allowedOrigins.some((re) => re.test(origin))) return cb(null, true);
      return cb(new Error(`CORS: origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "x-tenant-id", // dev headers usados por adminRoutes
      "x-user-id",
      "x-roles",
      "x-plan",
    ],
    // no usamos cookies/sesiones, el token va por Authorization
    credentials: false,
    optionsSuccessStatus: 204,
    maxAge: 600,
  })
);

// Preflight universal (Express 5 / path-to-regexp v6 compatible)
app.options(/^\/.*$/, cors());



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

// ── 🆕 SERVE ADMIN PANEL HTML con CSP Headers ─────────────────────
app.get("/admin", (req, res) => {

    // 🔧 CSP Headers requeridos por Teams
    // 🔧 Headers de seguridad y cache
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");

    // CSP para Teams Tab
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self' https://*.microsoft.com https://*.office.com https://*.office.net https://*.cloud.microsoft;",
        "script-src 'self' 'unsafe-inline' https://res.cdn.office.net https://*.office.net https://*.microsoft.com https://*.cloud.microsoft;",
        "connect-src 'self' https: wss: https://*.microsoft.com https://*.microsoftonline.com https://*.office.net https://*.cloud.microsoft https://*.office.com;",
        "frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://outlook.office.com https://*.outlook.office.com https://outlook.office365.com https://*.microsoft365.com https://*.cloud.microsoft;",
        "img-src 'self' data: https:;",
        "style-src 'self' 'unsafe-inline' https://*.microsoft.com https://*.office.net https://*.cloud.microsoft;",
        "font-src 'self' https: data:;",
      ].join(" ")
    );

  // Intentar varias rutas posibles para encontrar adminPanel.html  
  const possiblePaths = [
    path.join(process.cwd(), "admin", "adminPanel.html"),
    path.join(__dirname, "..", "admin", "adminPanel.html"),
    path.join(__dirname, "..", "..", "admin", "adminPanel.html"),
    path.join(__dirname, "..", "..", "src/admin", "adminPanel.html"),
    path.join(__dirname, "..", "src/admin", "adminPanel.html"),
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
    }
  );

// ── 🆕 ADMIN PANEL ASSETS (if needed) ────────────────────────────
app.use("/admin/assets", express.static(path.join(__dirname, "..", "admin", "assets")));

// ── 🆕 SERVE ADMIN PANEL STATIC FILES ────────────────────────────
app.use("/admin", express.static(path.join(process.cwd(), "admin")));

// ── 🆕 PUBLIC MARKETING & SUPPORT PAGES ────────────────────────
const publicDir = path.join(process.cwd(), "public");
const staticAssetsDir = path.join(publicDir, "assets");

if (fs.existsSync(staticAssetsDir)) {
  app.use("/public/assets", express.static(staticAssetsDir));
}

function serveStaticPage(route: string, fileName: string) {
  app.get(route, (_req, res) => {
    const target = path.join(publicDir, fileName);
    if (!fs.existsSync(target)) {
      res.status(404).send("Resource not found");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=600");
    res.sendFile(target);
  });
}

serveStaticPage("/support", "support.html");
serveStaticPage("/legal/terms", "terms.html");
serveStaticPage("/channel-info", "channel-info.html");

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
