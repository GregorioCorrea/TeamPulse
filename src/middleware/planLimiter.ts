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

// Tipos estándar de plan para toda la app
export type PlanSlug = 'free' | 'pro' | 'enterprise';

// Normalizador robusto para cualquier variante
export function normalizePlan(p?: string | null): PlanSlug {
  const v = (p || '').toLowerCase().trim();
  if (v === 'enterprise' || v === 'ent' || v === 'enterp' || v === 'teampulse3') return 'enterprise';
  if (v === 'pro' || v === 'professional' || v === 'teampulse2') return 'pro';
  return 'free';
}


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
// Mapeo planId (Marketplace) → slug estándar
const PLAN_MAPPING: Record<string, PlanSlug> = {
  'teampulse1': 'free',
  'teampulse2': 'pro',
  'teampulse3': 'enterprise'
};

// Límites por plan (puede ajustarse después)
const PLAN_LIMITS: Record<PlanSlug, number> = {
  free: 1,           // 1 encuesta/semana
  pro: 10,           // 10 encuestas/semana
  enterprise: 999999 // “ilimitado”
};


/* ── obtener plan del tenant - VERSIÓN ROBUSTA ───────────────────── */
export async function getPlan(tenantId: string): Promise<PlanSlug> {
  if (!tenantId) {
    console.log("⚠️ TenantId no proporcionado, devolviendo plan free por defecto");
    return 'free';
  }

  try {
    console.log(`🔍 Buscando plan para tenant: ${tenantId}`);

    // (Logs de depuración existentes, podés dejarlos si te sirven)
    const entities = subsTable.listEntities({
      queryOptions: { filter: `userTenant eq '${tenantId}'` }
    });

    let latestSubscription: any = null;
    let latestDate = new Date(0);

    for await (const entity of entities) {
      if (entity.status === 'Activated' && entity.planId && entity.lastModified) {
        const d = new Date(entity.lastModified as string);
        if (d > latestDate) {
          latestSubscription = entity;
          latestDate = d;
        }
      }
    }

    if (latestSubscription?.planId) {
      const raw = String(latestSubscription.planId);
      const mapped = PLAN_MAPPING[raw] || normalizePlan(raw);
      console.log(`🎯 Plan determinado: ${mapped} (desde planId=${raw})`);
      return mapped;
    }

    console.log(`ℹ️ No se encontró plan activo para tenant: ${tenantId}, usando free por defecto`);
    return 'free';
  } catch (error) {
    console.error(`❌ Error al obtener plan para tenant ${tenantId}:`, error);
    return 'free';
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

export async function checkResponsesLimit(surveyId: string, tenantId?: string) {
  let total = 0;
  for await (const _ of respTable.listEntities({
    queryOptions: { filter: `surveyId eq '${surveyId}'` }
  })) total++;

  // Para free límite 50 respuestas/encuesta; pro/enterprise sin tope acá.
  if (tenantId) {
    const plan = await getPlan(tenantId);
    if (plan === 'free') return total < 50;
    return true;
  }
  // Compat: si no pasás tenantId, mantenemos la regla original
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

  const quedan = Math.max(0, max - usados);
  const porcentaje = Math.round((usados / max) * 100);

  // Map inverso al id de marketplace por consistencia visual
  const planOriginal =
    plan === 'free' ? 'teampulse1' :
    plan === 'pro' ? 'teampulse2' : 'teampulse3';

  return { plan, usados, max, quedan, porcentaje, planOriginal };
}
