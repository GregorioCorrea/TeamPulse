import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Import required packages
import express from "express";

// This bot's adapter
import adapter from "./adapter";

// This bot's main dialog.
import app from "./app/app";

// En src/index.ts o donde tengas tu servidor Express
import { MarketplaceWebhookHandler } from './webhook/marketplacewebhook';

const webhookHandler = new MarketplaceWebhookHandler();

// Create express application.
const expressApp = express();
expressApp.use(express.json());

const server = expressApp.listen(process.env.port || process.env.PORT || 3978, () => {
  console.log(`\nAgent started, ${expressApp.name} listening to`, server.address());
});

// Agregar estas rutas ANTES de server.post("/api/messages"...
expressApp.post('/api/marketplace/webhook', (req, res) => {
  webhookHandler.handleWebhook(req, res);
});

// Health check para verificar que funciona
expressApp.get('/api/marketplace/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'TeamPulse Marketplace Webhook'
  });
});

// Listen for incoming requests.
expressApp.post("/api/messages", async (req, res) => {
  // Route received a request to adapter for processing
  await adapter.process(req, res as any, async (context) => {
    // Dispatch to application for routing
    await app.run(context);
  });
});
