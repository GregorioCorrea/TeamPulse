// src/middleware/planLimiter.ts
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// ---------- conexión a Storage ----------
const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key      = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const cred     = new AzureNamedKeyCredential(account, key);

// Tabla que ya crea el webhook – la usamos para saber el plan
const subsTable  = new TableClient(
  `https://${account}.table.core.windows.net`,
  "Subscriptions",
  cred
);

// Nueva tabla ultra-simple para contar encuestas por tenant
const usageTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "PlanUsage",
  cred
);

// Se crea una sola vez; si existe no pasa nada
(async () => { try { await usageTable.createTable(); } catch { /* ya existe */ }})();

// ---------- límites por plan ----------
const PLAN_LIMITS: Record<string, number> = {
  free: 3,
  pro : 50,
  ent : 999_999     // “ilimitado”
};

// ----- helpers que ahora vas a usar desde app.ts -----
async function getTenantPlan(tenantId: string): Promise<keyof typeof PLAN_LIMITS> {
  try {
    const sub: any = await subsTable.getEntity("sub", tenantId);
    return (sub.planId as string)?.toLowerCase() as any ?? "free";
  } catch {
    return "free";
  }
}

/** ¿Todavía puede crear otra encuesta? */
export async function canCreateSurvey(tenantId: string): Promise<boolean> {
  const plan    = await getTenantPlan(tenantId);
  const max     = PLAN_LIMITS[plan];

  let actuales = 0;
  for await (const _ of usageTable.listEntities({
    queryOptions: { filter: `PartitionKey eq '${tenantId}'` }
  })) actuales++;

  return actuales < max;
}

/** Registrar que creó una encuesta nueva (↑1) */
export async function registerSurveyCreation(tenantId: string): Promise<void> {
  await usageTable.createEntity({
    partitionKey: tenantId,
    rowKey      : Date.now().toString()
  });
}
