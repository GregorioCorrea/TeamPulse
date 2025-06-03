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


interface EncuestaTempState {
    titulo: string;
    objetivo: string;
    preguntas: any[]; // Cambia 'any[]' por el tipo adecuado si lo sabes
}


function guardarEncuestaComoJSON(encuesta: any) {
    const fileName = encuesta.titulo.replace(/\s+/g, '_').toLowerCase() + '.json';
    const filePath = path.join(__dirname, '../../data', fileName);
    fs.writeFileSync(filePath, JSON.stringify(encuesta, null, 2), 'utf-8');
    console.log(`Encuesta guardada en: ${filePath}`);
}

app.ai.action('crear_encuesta', async (context, state) => {
    try {
        const temp = state.temp as unknown as EncuestaTempState;

        if (!temp?.titulo || !temp?.objetivo || !temp?.preguntas) {
            await context.sendActivity("❌ No se pudo crear la encuesta. Faltan datos.");
            console.error("Datos incompletos:", temp);
            return 'crear_encuesta';
        }

        const encuesta = {
            titulo: temp.titulo,
            objetivo: temp.objetivo,
            preguntas: temp.preguntas
        };

        guardarEncuestaComoJSON(encuesta);
        await context.sendActivity(`✅ Encuesta "${encuesta.titulo}" guardada correctamente.`);
        return 'crear_encuesta';
    } catch (error) {
        console.error("❌ Error al guardar la encuesta:", error);
        await context.sendActivity("❌ Ocurrió un error al guardar la encuesta.");
        return 'crear_encuesta';
    }
});

app.feedbackLoop(async (context, state, feedbackLoopData) => {
  //add custom feedback process logic here
  console.log("Your feedback is " + JSON.stringify(context.activity.value));
});
app.message(/forzar_guardado/i, async (context, state) => {
    const encuesta = {
        titulo: "Encuesta de prueba",
        objetivo: "Verificar que el guardado funcione correctamente.",
        preguntas: [
            {
                pregunta: "¿Te gusta usar este bot?",
                opciones: ["Sí", "No"]
            },
            {
                pregunta: "¿Lo recomendarías a otros?",
                opciones: ["Sí", "No", "Tal vez"]
            }
        ]
    };

    guardarEncuestaComoJSON(encuesta);
    await context.sendActivity("✅ Encuesta de prueba guardada correctamente.");
});

export default app;
