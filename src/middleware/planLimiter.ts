// src/middleware/planLimiter.ts
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

/* ── credenciales Storage (mismo patrón que marketplacewebhook) ── */
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key     = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const cred    = new AzureNamedKeyCredential(account, key);

const subsTable   = new TableClient(
  `https://${account}.table.core.windows.net`,
  "MarketplaceSubscriptions",
  cred
);
const usageTable  = new TableClient(
  `https://${account}.table.core.windows.net`,
  "PlanUsage",
  cred
);
const respTable   = new TableClient(
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

/* ── límites por plan ──────────────────────────────────────────── */
const PLAN_LIMITS = { free: 1, pro: 50, ent: 999_999 } as const;

/* ── obtener plan del tenant ───────────────────────────────────── */
export async function getPlan(tenantId: string): Promise<keyof typeof PLAN_LIMITS> {
  try {
    const row: any = await subsTable.getEntity("sub", tenantId);
    return (row.planId as string).toLowerCase() as any;
  } catch {
    return "free";
  }
}

/* ── API pública para app.ts ───────────────────────────────────── */
export async function canCreateSurvey(tenantId: string) {
  const plan      = await getPlan(tenantId);
  const max       = PLAN_LIMITS[plan];
  const thisWeek  = isoWeek();
  let count = 0;
  for await (const _ of usageTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${tenantId}' and weekKey eq '${thisWeek}'` }
  })) count++;
  return count < max;
}

export async function registerSurveyCreation(tenantId: string) {
  await usageTable.createEntity({
    partitionKey: tenantId,
    rowKey      : Date.now().toString(),
    weekKey     : isoWeek()
  });
}

export async function checkResponsesLimit(surveyId: string) {
  let total = 0;
  for await (const _ of respTable.listEntities({
    queryOptions: { filter: `surveyId eq '${surveyId}'` }
  })) total++;
  return total < 50;
}

export async function getUsageSummary(tenantId: string) {
  const plan = await getPlan(tenantId);
  const max  = PLAN_LIMITS[plan];
  const week = isoWeek();
  let usados = 0;
  for await (const _ of usageTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${tenantId}' and weekKey eq '${week}'` }
  })) usados++;
  const quedan = max - usados;
  const porcentaje = Math.round((usados / max) * 100);
  return { plan, usados, max, quedan, porcentaje };
}