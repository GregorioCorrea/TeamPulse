// src/index.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express from "express";
import cors from "cors";
import adapter from "./adapter";
import appBot from "./app/app";
import { marketplaceRouter } from "./webhook/marketplacewebhook";
import { landingPageRouter } from "./webhook/landingPageHandler"; // 🆕 Nuevo import

const app = express();
app.use(express.json());

// CORS – solo tu sitio estático
app.use(
  cors({
    origin: "https://teampulse.incumate.io",
    methods: ["POST", "OPTIONS", "GET"], // 🆕 Agregamos GET para health checks
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false        // dejá en false: no usás cookies
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

// ── Webhook de Marketplace (JWT + JSON) - SIN CAMBIOS ────────────
app.use("/api/marketplace/webhook", marketplaceRouter);

// ── 🆕 Landing Page Handler (nuevo endpoint) ──────────────────────
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

// 🆕 Health check general para todos los endpoints de marketplace
app.get("/api/marketplace/status", (_req, res) => {
  telemetryClient.trackEvent({ name: "MarketplaceStatusCheck" });
  res.json({
    status: "operational",
    timestamp: new Date().toISOString(),
    services: {
      webhook: "active",
      landingPage: "active"
    },
    endpoints: {
      webhook: "/api/marketplace/webhook",
      landingPage: "/api/marketplace/landing/activate",
      health: "/api/marketplace/health"
    }
  });
});

// ── Bot Framework endpoint ───────────────────────────────────────
app.post("/api/messages", async (req, res) => {
  telemetryClient.trackEvent({ name: "BotMessageReceived" });
  await adapter.process(req, res as any, async (context) => {
    await appBot.run(context);
  });
});

// ── Arrancar servidor ─────────────────────────────────────────────
const port = process.env.PORT || 3978;
app.listen(port, () => {
  telemetryClient.trackEvent({ name: "ServerStarted", properties: { port: port.toString() } });
  console.log(`Agent started. Listening on http://localhost:${port}`);
  console.log(`🔗 Endpoints disponibles:`);
  console.log(`   - Bot: http://localhost:${port}/api/messages`);
  console.log(`   - Webhook: http://localhost:${port}/api/marketplace/webhook`);
  console.log(`   - Landing: http://localhost:${port}/api/marketplace/landing/activate`); // 🆕
  console.log(`   - Health: http://localhost:${port}/api/health`);
});