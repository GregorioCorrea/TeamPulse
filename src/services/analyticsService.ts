// src/services/analyticsService.ts
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key     = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const cred    = new AzureNamedKeyCredential(account, key);

const resultsTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "Resultados",
  cred
);

;(async () => {
  try { await resultsTable.createTable(); }
  catch { /* ya existía */ }
})();

/**
 * Registra en 'Resultados' un resumen incremental de la respuesta.
 * @param encuestaId PartitionKey (ID de encuesta)
 * @param respuestas Mapa preguntaIndex → opción elegida
 */
export async function recordResponse(
  encuestaId: string,
  respuestas: Record<number, string>
) {
  const partitionKey = encuestaId;
  const rowKey       = "summary";

  // 1) Levanto o inicializo entidad
  let entity: any;
  try {
    entity = await resultsTable.getEntity(partitionKey, rowKey);
  } catch {
    entity = {
      partitionKey,
      rowKey,
      totalParticipantes: 0,
      resumen: JSON.stringify([])
    };
  }

  // 2) Actualizo resumen
  const resumenArr: Record<string, number>[] = JSON.parse(entity.resumen);
  // Aseguro tamaño de array
  const maxIdx = Math.max(...Object.keys(respuestas).map(i => +i));
  while (resumenArr.length <= maxIdx) resumenArr.push({});
  for (const [idxStr, opcion] of Object.entries(respuestas)) {
    const idx = +idxStr;
    resumenArr[idx][opcion] = (resumenArr[idx][opcion] || 0) + 1;
  }

  // 3) Incremento totalParticipantes
  entity.resumen = JSON.stringify(resumenArr);
  entity.totalParticipantes = (entity.totalParticipantes || 0) + 1;

  // 4) Upsert merge
  await resultsTable.upsertEntity(entity, "Merge");
}
