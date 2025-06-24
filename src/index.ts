// src/index.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express from "express";
import adapter from "./adapter";
import app from "./app/app";
import { marketplaceRouter } from "./webhook/marketplacewebhook";

const expressApp = express();

// Para parsear JSON en todo el servidor
expressApp.use(express.json());

// ─── Rutas de Marketplace Webhook ────────────────────────────────
// monta todos los endpoints en /api/marketplace/webhook
expressApp.use("/api/marketplace/webhook", marketplaceRouter);

// ─── Health checks ────────────────────────────────────────────────
expressApp.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
expressApp.get("/api/marketplace/health", (_req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "TeamPulse Marketplace Webhook",
  });
});

// ─── Endpoint Bot Framework ───────────────────────────────────────
expressApp.post("/api/messages", async (req, res) => {
  await adapter.process(req, res as any, async (context) => {
    await app.run(context);
  });
});

// ─── Levantar servidor ─────────────────────────────────────────────
const port = process.env.PORT || 3978;
expressApp.listen(port, () => {
  console.log(`Agent started. Listening on http://localhost:${port}`);
});
