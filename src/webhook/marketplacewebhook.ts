// Crear nuevo archivo: src/webhook/marketplaceWebhook.ts

import { Request, Response } from 'express';
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";
import { BaseWebhookHandler } from './base/baseWebhookHandler';


interface MarketplaceNotification {
  id: string;
  eventType: string;
  publisherId: string;
  offerId: string;
  planId: string;
  subscriptionId: string;
  timeStamp: string;
  action: string;
  status: {
    subscriptionStatus: string;
    quantity: number;
  };
  purchaser: {
    email: string;
    objectId: string;
    tenantId: string;
  };
}

export class MarketplaceWebhookHandler {
  private subscriptionsTable: TableClient;
  
  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
     
    const credential = new AzureNamedKeyCredential(accountName, accountKey);
    this.subscriptionsTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'MarketPlaceSubscriptions',
      credential
    );
    this.initializeTables();
  }

  private async initializeTables() {
    try {
      await this.subscriptionsTable.createTable();
    } catch (error) {
      // Table already exists
    }
  }

  async handleWebhook(req: Request, res: Response) {
    try {
      console.log('🔔 Marketplace webhook recibido:', req.body);
      
      // Validar que viene de Microsoft
      const token = req.headers['x-ms-marketplace-token'];
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const notification: MarketplaceNotification = req.body;
      
      // Guardar en Azure Table Storage
      const entity = {
        partitionKey: notification.subscriptionId,
        rowKey: `${Date.now()}_${notification.eventType}`,
        ...notification,
        processedAt: new Date().toISOString()
      };
      
      await this.subscriptionsTable.createEntity(entity);
      
      // Procesar según el tipo de evento
      switch (notification.action) {
        case 'Subscribe':
          await this.handleNewSubscription(notification);
          break;
        case 'Unsubscribe':
          await this.handleCancellation(notification);
          break;
        case 'ChangePlan':
          await this.handlePlanChange(notification);
          break;
        case 'ChangeQuantity':
          await this.handleQuantityChange(notification);
          break;
      }
      
      // Microsoft espera un 200 OK
      res.status(200).json({ 
        received: true, 
        timestamp: new Date().toISOString() 
      });
      
    } catch (error) {
      console.error('❌ Error en webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async handleNewSubscription(notification: MarketplaceNotification) {
    console.log(`✅ Nueva suscripción: ${notification.purchaser.email}`);
    // Aquí puedes:
    // - Crear cuenta en tu sistema
    // - Enviar email de bienvenida
    // - Activar features premium
  }

  private async handleCancellation(notification: MarketplaceNotification) {
    console.log(`❌ Cancelación: ${notification.subscriptionId}`);
    // Aquí puedes:
    // - Desactivar features premium
    // - Enviar email de retención
  }

  private async handlePlanChange(notification: MarketplaceNotification) {
    console.log(`🔄 Cambio de plan: ${notification.planId}`);
    // Actualizar límites según el nuevo plan
  }

  private async handleQuantityChange(notification: MarketplaceNotification) {
    console.log(`📊 Cambio de cantidad: ${notification.status.quantity}`);
    // Actualizar número de licencias
  }
}