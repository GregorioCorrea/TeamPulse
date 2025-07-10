// src/middleware/planLimiter.ts - VERSIÓN ACTUALIZADA
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

/* ── credenciales Storage (mismo patrón que marketplacewebhook) ── */
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key     = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const cred    = new AzureNamedKeyCredential(account, key);

const subsTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "MarketplaceSubscriptions",
  cred
);

const usageTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "PlanUsage",
  cred
);

const respTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "Respuestas",
  cred
);

(async () => { try { await usageTable.createTable(); } catch {} })();

/* ── helpers de tiempo ─────────────────────────────────────────── */
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const diffMs = d.getTime() - yearStart.getTime();
  const week   = Math.ceil((diffMs / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

/* ── definición de planes y sus mapeos ──────────────────────────── */
// Mapeo de planId en la tabla a tipo de plan en el código
const PLAN_MAPPING = {
  "teampulse1": "free",
  "teampulse2": "pro",
  "teampulse3": "ent"
} as const;

// Límites por tipo de plan
const PLAN_LIMITS = { 
  free: 1,      // 1 encuesta por semana en free
  pro: 10,      // 10 encuestas por semana en pro
  ent: 999_999  // ilimitado en enterprise
} as const;

/* ── obtener plan del tenant - VERSIÓN ROBUSTA ───────────────────── */
export async function getPlan(tenantId: string): Promise<keyof typeof PLAN_LIMITS> {
  if (!tenantId) {
    console.log("⚠️ TenantId no proporcionado, devolviendo plan free por defecto");
    return "free";
  }
  
  try {
    console.log(`🔍 Buscando plan para tenant: ${tenantId}`);
    
    // Depuración avanzada - imprimir todas las entidades en la tabla
    console.log("📋 Entidades en MarketplaceSubscriptions:");
    const allEntities = subsTable.listEntities();
    let entityCount = 0;
    for await (const entity of allEntities) {
      entityCount++;
      console.log(`Entidad ${entityCount}: PartitionKey=${entity.partitionKey}, RowKey=${entity.rowKey}, userTenant=${entity.userTenant}, planId=${entity.planId}`);
    }
    
    if (entityCount === 0) {
      console.log("⚠️ No se encontraron entidades en la tabla MarketplaceSubscriptions");
    }
    
    // Buscar todas las entradas que tengan este tenantId en userTenant
    const entities = subsTable.listEntities({
      queryOptions: {
        filter: `userTenant eq '${tenantId}'`
      }
    });
    
    // Buscar la suscripción activa más reciente
    let latestSubscription: any = null;
    let latestDate = new Date(0); // fecha antigua para comparación
    let foundEntities = 0;
    
    for await (const entity of entities) {
      foundEntities++;
      console.log(`Encontrada entidad para tenant ${tenantId}: planId=${entity.planId}, status=${entity.status}, lastModified=${entity.lastModified}`);
      
      // Verificar si la entidad tiene los campos requeridos
      if (entity.status === "Activated" && entity.planId && entity.lastModified) {
        const entityDate = new Date(entity.lastModified as string);
        
        // Si esta entidad es más reciente que la anterior encontrada
        if (entityDate > latestDate) {
          latestSubscription = entity;
          latestDate = entityDate;
          console.log(`✅ Nueva suscripción más reciente encontrada: planId=${entity.planId}, fecha=${entityDate}`);
        }
      }
    }
    
    if (foundEntities === 0) {
      console.log(`⚠️ No se encontraron entidades para el tenant ${tenantId}`);
    }
    
    // Si encontramos una suscripción activa
    if (latestSubscription) {
      const planId = latestSubscription.planId as string;
      console.log(`✅ Plan encontrado: ${planId}`);
      
      // Mapear el planId al tipo de plan - con manejo robusto
      let planType: keyof typeof PLAN_LIMITS = "free";
      
      if (planId === "teampulse1") {
        planType = "free";
      } else if (planId === "teampulse2") {
        planType = "pro";
      } else if (planId === "teampulse3") {
        planType = "ent";
      } else {
        console.log(`⚠️ PlanId no reconocido: ${planId}, usando free por defecto`);
      }
      
      console.log(`🎯 Plan determinado: ${planType} (desde planId=${planId})`);
      return planType;
    }
    
    console.log(`ℹ️ No se encontró plan activo para tenant: ${tenantId}, usando free por defecto`);
    return "free";
  } catch (error) {
    console.error(`❌ Error al obtener plan para tenant ${tenantId}:`, error);
    return "free"; // Por defecto, devolvemos "free" si hay algún error
  }
}

/* ── API pública para app.ts ───────────────────────────────────── */
export async function canCreateSurvey(tenantId: string) {
  const plan = await getPlan(tenantId);
  const max = PLAN_LIMITS[plan];
  const thisWeek = isoWeek();
  let count = 0;
  
  for await (const _ of usageTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${tenantId}' and weekKey eq '${thisWeek}'` }
  })) count++;
  
  console.log(`📊 Plan: ${plan}, Encuestas esta semana: ${count}/${max}`);
  return count < max;
}

export async function registerSurveyCreation(tenantId: string) {
  await usageTable.createEntity({
    partitionKey: tenantId,
    rowKey: Date.now().toString(),
    weekKey: isoWeek()
  });
}

export async function checkResponsesLimit(surveyId: string) {
  let total = 0;
  for await (const _ of respTable.listEntities({
    queryOptions: { filter: `surveyId eq '${surveyId}'` }
  })) total++;
  
  // Plan free tiene máximo 50 respuestas por encuesta
  return total < 50;
}

export async function getUsageSummary(tenantId: string) {
  const plan = await getPlan(tenantId);
  const max = PLAN_LIMITS[plan];
  const week = isoWeek();
  let usados = 0;
  
  for await (const _ of usageTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${tenantId}' and weekKey eq '${week}'` }
  })) usados++;
  
  const quedan = max - usados;
  const porcentaje = Math.round((usados / max) * 100);
  
  return { 
    plan, 
    usados, 
    max, 
    quedan, 
    porcentaje,
    planOriginal: plan === "free" ? "teampulse1" : plan === "pro" ? "teampulse2" : "teampulse3"
  };
}