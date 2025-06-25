// src/index.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express from "express";
import adapter from "./adapter";
import appBot from "./app/app";
import { marketplaceRouter } from "./webhook/marketplacewebhook";

const app = express();
app.use(express.json());

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

// ── Webhook de Marketplace (JWT + JSON) ───────────────────────────
app.use("/api/marketplace/webhook", marketplaceRouter);

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
});
