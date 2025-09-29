import enCatalog from "./catalogs/en.json";
import esCatalog from "./catalogs/es.json";

type JsonRecord = Record<string, unknown>;

type CatalogMap = Record<string, JsonRecord>;

type TemplateParams = Record<string, string | number | boolean>;

export type Locale = string;

const DEFAULT_LOCALE: Locale = "es";
const FALLBACK_LOCALE: Locale = "en";

const catalogMap: CatalogMap = {
  en: enCatalog as JsonRecord,
  es: esCatalog as JsonRecord,
};

function hasCatalog(locale: string): boolean {
  return Object.prototype.hasOwnProperty.call(catalogMap, locale);
}

function normalizeLocale(locale?: string | null): Locale {
  if (!locale) return DEFAULT_LOCALE;
  const normalized = locale.toLowerCase();
  if (hasCatalog(normalized)) return normalized;

  const languageCode = normalized.split("-")[0];
  if (hasCatalog(languageCode)) return languageCode;

  return DEFAULT_LOCALE;
}

function getLocaleFallbacks(locale?: string | null): Locale[] {
  const normalized = normalizeLocale(locale);
  const fallbacks: Locale[] = [normalized];
  if (normalized !== DEFAULT_LOCALE) fallbacks.push(DEFAULT_LOCALE);
  if (!fallbacks.includes(FALLBACK_LOCALE)) fallbacks.push(FALLBACK_LOCALE);
  return fallbacks;
}

function getValueFromCatalog(catalog: JsonRecord, pathSegments: string[]): unknown {
  return pathSegments.reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in (acc as JsonRecord)) {
      return (acc as JsonRecord)[segment];
    }
    return undefined;
  }, catalog);
}

function interpolate(template: unknown, params?: TemplateParams): string | undefined {
  if (typeof template !== "string") {
    return typeof template === "number" ? String(template) : undefined;
  }

  if (!params) return template;

  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, key: string) => {
    const value = params[key.trim()];
    return value === undefined || value === null ? "" : String(value);
  });
}

export interface TranslateOptions {
  locale?: string | null;
  params?: TemplateParams;
  defaultValue?: string;
  reportMissing?: (details: { key: string; locale: string }) => void;
}

export function translate(key: string, options: TranslateOptions = {}): string {
  const { locale, params, defaultValue, reportMissing } = options;
  const pathSegments = key.split(".").filter(Boolean);

  for (const localeCandidate of getLocaleFallbacks(locale)) {
    const catalog = catalogMap[localeCandidate];
    if (!catalog) continue;

    const value = getValueFromCatalog(catalog, pathSegments);
    const rendered = interpolate(value, params);
    if (rendered !== undefined) {
      return rendered;
    }
  }

  reportMissing?.({ key, locale: normalizeLocale(locale) });

  return defaultValue ?? key;
}

export function getCatalog(locale?: string | null): JsonRecord {
  const normalized = normalizeLocale(locale);
  return catalogMap[normalized];
}

export function getDefaultLocale(): Locale {
  return DEFAULT_LOCALE;
}

export function ensureLocale(locale?: string | null): Locale {
  return normalizeLocale(locale);
}

export function getSupportedLocales(): Locale[] {
  return Object.keys(catalogMap);
}

export type TranslationCatalog = JsonRecord;

export function registerCatalog(locale: string, catalog: JsonRecord): void {
  const normalized = locale.toLowerCase();
  catalogMap[normalized] = catalog;
}
