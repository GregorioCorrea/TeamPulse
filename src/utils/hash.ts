// src/utils/hash.ts
import { createHash } from "crypto";

/**
 * Genera un hash SHA-256 en minúsculas.
 * @param texto Texto a anonimizar (ej. email, userId)
 * @param salt  Sal para evitar ataques rainbow (usar el surveyId)
 */
export function sha256(texto: string, salt: string): string {
  return createHash("sha256").update(`${texto}|${salt}`).digest("hex");
}
