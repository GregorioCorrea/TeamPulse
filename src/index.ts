import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Import required packages
import express from "express";

// This bot's adapter
import adapter from "./adapter";

// This bot's main dialog
import app from "./app/app";

// This Marketplace webhook handler
import { MarketplaceWebhookHandler } from './webhook/marketplacewebhook';

import { NextFunction } from "express"; 

// Create express application.
const expressApp = express();
expressApp.use(express.json());

const server = expressApp.listen(process.env.port || process.env.PORT || 3978, () => {
  console.log(`\nAgent started, ${expressApp.name} listening to`, server.address());
});

// Wrapper que ignora el valor devuelto y maneja errores
expressApp.post(
  "/api/marketplace/webhook",
  express.json({ limit: "1mb" }),
  (req: express.Request, res: express.Response, next: NextFunction) => {
    // Ejecuta la función y, si falla, pasa el error a Express
    MarketplaceWebhookHandler(req, res).catch(next);
  }
);

// Health genérico
expressApp.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

  // Fallback si falla el webhook handler
  expressApp.get('/api/marketplace/health', (req, res) => {
    res.json({ 
      status: 'degraded', 
      timestamp: new Date().toISOString(),
      error: 'Webhook handler initialization failed'
    });
  });

/*

// Health check para verificar que funciona
expressApp.get('/api/marketplace/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'TeamPulse Marketplace Webhook'
  });
});
*/

// Listen for incoming requests.
expressApp.post("/api/messages", async (req, res) => {
  // Route received a request to adapter for processing
  await adapter.process(req, res as any, async (context) => {
    // Dispatch to application for routing
    await app.run(context);
  });
});
