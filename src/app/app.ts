import { MemoryStorage, MessageFactory, TurnContext } from "botbuilder";
import * as path from "path";
import config from "../config";
import * as fs from 'fs';

// See https://aka.ms/teams-ai-library to learn more about the Teams AI library.
import { Application, ActionPlanner, OpenAIModel, PromptManager } from "@microsoft/teams-ai";

// Create AI components
const model = new OpenAIModel({
  azureApiKey: config.azureOpenAIKey,
  azureDefaultDeployment: config.azureOpenAIDeploymentName,
  azureEndpoint: config.azureOpenAIEndpoint,
  useSystemMessages: true,
  logRequests: true,
});

const prompts = new PromptManager({
  promptsFolder: path.join(__dirname, "../prompts"),
});

const planner = new ActionPlanner({
  model,
  prompts,
  defaultPrompt: "create-survey",
});

// Define storage and application
const storage = new MemoryStorage();
const app = new Application({
  storage,
  ai: {
    planner,
    enable_feedback_loop: true,
  },
});

// Interfaces para mejor tipado
interface Pregunta {
  pregunta: string;
  opciones: string[];
}

interface Encuesta {
  titulo: string;
  objetivo: string;
  preguntas: Pregunta[];
  creador?: string;
  fechaCreacion?: Date;
  id?: string;
}

interface EncuestaTempState {
  titulo?: string;
  objetivo?: string;
  preguntas?: Pregunta[];
}

// Función mejorada para guardar encuestas
function guardarEncuestaComoJSON(encuesta: Encuesta): string {
  try {
    // Crear directorio data si no existe
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Generar ID único y timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${encuesta.titulo.replace(/\s+/g, '_').toLowerCase()}_${timestamp}.json`;
    const filePath = path.join(dataDir, fileName);

    // Agregar metadata
    const encuestaCompleta = {
      ...encuesta,
      id: fileName.replace('.json', ''),
      fechaCreacion: new Date(),
    };

    fs.writeFileSync(filePath, JSON.stringify(encuestaCompleta, null, 2), 'utf-8');
    console.log(`✅ Encuesta guardada en: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('❌ Error al guardar encuesta:', error);
    throw error;
  }
}

// Acción mejorada para crear encuesta
app.ai.action('crear_encuesta', async (context, state, data) => {
  try {
    console.log('🔄 Acción crear_encuesta invocada con datos:', JSON.stringify(data, null, 2));

    // Validar que los datos estén presentes
    if (!data || typeof data !== 'object') {
      await context.sendActivity("❌ No se recibieron datos para crear la encuesta.");
      return 'create-survey';
    }

    const { titulo, objetivo, preguntas } = data as Encuesta;

    // Validaciones
    if (!titulo || !objetivo || !preguntas || !Array.isArray(preguntas) || preguntas.length === 0) {
      await context.sendActivity("❌ Faltan datos requeridos. Necesito título, objetivo y al menos una pregunta.");
      console.error("Datos incompletos recibidos:", { titulo, objetivo, preguntas });
      return 'create-survey';
    }

    // Validar estructura de preguntas
    for (const pregunta of preguntas) {
      if (!pregunta.pregunta || !Array.isArray(pregunta.opciones) || pregunta.opciones.length < 2) {
        await context.sendActivity("❌ Cada pregunta debe tener texto y al menos 2 opciones.");
        return 'create-survey';
      }
    }

    const encuesta: Encuesta = {
      titulo,
      objetivo,
      preguntas,
      creador: context.activity.from.name || 'Usuario desconocido',
    };

    const rutaArchivo = guardarEncuestaComoJSON(encuesta);
    
    // Respuesta exitosa con resumen
    const resumen = `✅ **Encuesta "${titulo}" creada exitosamente!**

📋 **Objetivo:** ${objetivo}
👤 **Creador:** ${encuesta.creador}
❓ **Preguntas:** ${preguntas.length}

**Preguntas creadas:**
${preguntas.map((p, i) => `${i + 1}. ${p.pregunta}\n   Opciones: ${p.opciones.join(', ')}`).join('\n')}

📁 Guardada en: ${path.basename(rutaArchivo)}`;

    await context.sendActivity(resumen);
    return 'create-survey';

  } catch (error) {
    console.error("❌ Error en acción crear_encuesta:", error);
    await context.sendActivity("❌ Ocurrió un error interno al crear la encuesta. Intenta nuevamente.");
    return 'create-survey';
  }
});

// Comando para pruebas (mantener para debugging)
app.message(/forzar_guardado/i, async (context, state) => {
  const encuesta: Encuesta = {
    titulo: "Encuesta de Prueba Manual",
    objetivo: "Verificar que el guardado funcione correctamente",
    preguntas: [
      {
        pregunta: "¿Te gusta usar este bot?",
        opciones: ["Sí", "No", "Regular"]
      },
      {
        pregunta: "¿Lo recomendarías a otros?",
        opciones: ["Definitivamente sí", "Probablemente sí", "No estoy seguro", "Probablemente no", "Definitivamente no"]
      }
    ],
    creador: context.activity.from.name || 'Prueba Manual',
  };

  try {
    const rutaArchivo = guardarEncuestaComoJSON(encuesta);
    await context.sendActivity(`✅ Encuesta de prueba guardada en: ${path.basename(rutaArchivo)}`);
  } catch (error) {
    await context.sendActivity("❌ Error al guardar encuesta de prueba.");
  }
});

// Comando para listar encuestas guardadas
app.message(/listar_encuestas/i, async (context, state) => {
  try {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      await context.sendActivity("📁 No hay encuestas guardadas aún.");
      return;
    }

    const archivos = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
    
    if (archivos.length === 0) {
      await context.sendActivity("📁 No hay encuestas guardadas aún.");
      return;
    }

    let lista = "📋 **Encuestas guardadas:**\n\n";
    archivos.forEach((archivo, index) => {
      lista += `${index + 1}. ${archivo.replace('.json', '').replace(/_/g, ' ')}\n`;
    });

    await context.sendActivity(lista);
  } catch (error) {
    await context.sendActivity("❌ Error al listar encuestas.");
  }
});

// Feedback loop
app.feedbackLoop(async (context, state, feedbackLoopData) => {
  console.log("Feedback recibido:", JSON.stringify(context.activity.value));
});

export default app;