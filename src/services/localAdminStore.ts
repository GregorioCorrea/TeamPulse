import fs from "fs";
import path from "path";

export type LocalSurvey = {
  id: string;
  titulo: string;
  objetivo: string;
  preguntas: Array<{ pregunta: string; opciones: string[] }>;
  tenantId?: string;
  creador?: string;
  estado: string;
  fechaCreacion: string;
  ultimaModificacion?: string;
  totalRespuestas?: number;
  basadoEnTemplate?: string | null;
  tags?: string[];
  storageSource: "local";
};

export type LocalResults = {
  encuestaId: string;
  titulo: string;
  fechaCreacion: string;
  estado: string;
  totalParticipantes: number;
  respuestas: any[];
  resumen: Record<string, any>;
};

interface LocalStoreFile {
  surveys: Record<string, LocalSurvey>;
  results: Record<string, LocalResults>;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "local-admin-store.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

class LocalAdminStore {
  private surveys: Map<string, LocalSurvey> = new Map();
  private results: Map<string, LocalResults> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, "utf8");
        if (raw.trim()) {
          const parsed: LocalStoreFile = JSON.parse(raw);
          Object.values(parsed.surveys || {}).forEach((survey) => {
            this.surveys.set(survey.id, survey);
          });
          Object.values(parsed.results || {}).forEach((result) => {
            this.results.set(result.encuestaId, result);
          });
        }
      }
    } catch (error) {
      console.warn("⚠️ No se pudo cargar local-admin-store, se continuará en memoria:", error);
    }
  }

  private persistToDisk() {
    try {
      ensureDataDir();
      const payload: LocalStoreFile = {
        surveys: Object.fromEntries(this.surveys),
        results: Object.fromEntries(this.results),
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
    } catch (error) {
      console.warn("⚠️ No se pudo persistir local-admin-store:", error);
    }
  }

  addSurvey(survey: Omit<LocalSurvey, "storageSource">): LocalSurvey {
    const stored: LocalSurvey = {
      ...survey,
      storageSource: "local",
      estado: survey.estado || "activa",
      fechaCreacion: survey.fechaCreacion || new Date().toISOString(),
    };
    this.surveys.set(stored.id, stored);
    this.persistToDisk();
    return stored;
  }

  listSurveys(): LocalSurvey[] {
    return Array.from(this.surveys.values()).sort((a, b) => {
      return new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime();
    });
  }

  updateSurvey(id: string, patch: Partial<LocalSurvey>): LocalSurvey | null {
    const current = this.surveys.get(id);
    if (!current) return null;
    const updated: LocalSurvey = {
      ...current,
      ...patch,
      storageSource: "local",
      ultimaModificacion: new Date().toISOString(),
    };
    this.surveys.set(id, updated);
    this.persistToDisk();
    return updated;
  }

  setStatus(id: string, status: string): LocalSurvey | null {
    return this.updateSurvey(id, { estado: status });
  }

  deleteSurvey(id: string): boolean {
    const deleted = this.surveys.delete(id);
    this.results.delete(id);
    if (deleted) {
      this.persistToDisk();
    }
    return deleted;
  }

  saveResults(results: LocalResults): LocalResults {
    const stored: LocalResults = {
      ...results,
      fechaCreacion: results.fechaCreacion || new Date().toISOString(),
    };
    this.results.set(results.encuestaId, stored);
    this.persistToDisk();
    return stored;
  }

  getResults(id: string): LocalResults | null {
    return this.results.get(id) || null;
  }

  duplicateSurvey(originalId: string, duplicate: Omit<LocalSurvey, "storageSource">): LocalSurvey | null {
    const original = this.surveys.get(originalId);
    if (!original) return null;
    return this.addSurvey(duplicate);
  }
}

export const localAdminStore = new LocalAdminStore();
