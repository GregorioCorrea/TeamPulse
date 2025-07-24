// 🧹 APP.TS LIMPIO - Solo código que funciona
//
// INSTRUCCIONES: REEMPLAZAR todo el contenido de src/app/app.ts con esto

import { MemoryStorage, CardFactory, MessageFactory, TurnContext } from "botbuilder";
import * as path from "path";
import config from "../config";
import { AzureTableService } from "../services/azureTableService";
import { sha256 } from "../utils/hash"; 
import { 
  canCreateSurvey, 
  registerSurveyCreation, 
  getUsageSummary, 
  checkResponsesLimit,
  getPlan 
} from "../middleware/planLimiter";
import { enviarReportePorEmail } from "../services/emailService";  // Envío de correos electrónicos
import { recordResponse } from "../services/analyticsService"; // ── Analítica en tiempo real
import { EncuestaAnalisis } from "../services/aiInsightsService"; // ── Modelo de análisis de encuesta

// Crear instancia global del servicio Azure
const azureService = new AzureTableService();

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

// ============================
// INTERFACES
// ============================

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
  basadoEnTemplate?: string;
  tenantId?: string; // ID del tenant para multitenancy
}

interface Respuesta {
  participanteId: string;
  preguntaIndex: number;
  respuesta: string;
  timestamp: Date;
}

interface ResultadosEncuesta {
  encuestaId: string;
  titulo: string;
  fechaCreacion: Date;
  estado: 'activa' | 'cerrada';
  totalParticipantes: number;
  respuestas: Respuesta[];
  resumen?: {
    [preguntaIndex: number]: {
      [opcion: string]: number;
    };
  };
}

interface TemplateEncuesta {
  partitionKey: string;     
  rowKey: string;          
  nombre: string;          
  categoria: string;       
  descripcion: string;     
  objetivo: string;        
  preguntas: any[];        
  creador: string;         
  esPublico: boolean;      
  organizacion?: string;   
  fechaCreacion: string;   
  vecesUsado: number;      
  tags: string;           
  nivelPlan: string;      
}

/* ============================
// TEMPLATES PREDEFINIDOS


const TEMPLATES_PREDEFINIDOS = [
  {
    nombre: "Clima Laboral Básico",
    categoria: "HR",
    descripcion: "Evalúa el ambiente de trabajo y satisfacción del equipo",
    objetivo: "Medir la satisfacción general y el clima organizacional",
    preguntas: [
      {
        pregunta: "¿Cómo calificarías el ambiente de trabajo en general?",
        opciones: ["Excelente", "Bueno", "Regular", "Malo"]
      },
      {
        pregunta: "¿Te sientes valorado/a en tu rol actual?",
        opciones: ["Siempre", "Frecuentemente", "A veces", "Nunca"]
      },
      {
        pregunta: "¿Cómo es la comunicación con tu equipo?",
        opciones: ["Muy efectiva", "Efectiva", "Puede mejorar", "Deficiente"]
      },
      {
        pregunta: "¿Recomendarías esta empresa como lugar de trabajo?",
        opciones: ["Definitivamente sí", "Probablemente sí", "No estoy seguro/a", "No"]
      }
    ],
    nivelPlan: "free",
    tags: "clima,ambiente,satisfacción,hr,básico"
  },
  {
    nombre: "NPS Cliente",
    categoria: "Customer",
    descripcion: "Mide la lealtad y satisfacción del cliente (Net Promoter Score)",
    objetivo: "Evaluar la probabilidad de recomendación y satisfacción del cliente",
    preguntas: [
      {
        pregunta: "¿Qué tan probable es que recomiendes nuestro servicio? (0-10)",
        opciones: ["9-10 (Promotor)", "7-8 (Neutral)", "0-6 (Detractor)"]
      },
      {
        pregunta: "¿Cómo calificarías tu experiencia general?",
        opciones: ["Excelente", "Buena", "Regular", "Mala"]
      },
      {
        pregunta: "¿Qué aspecto valoras más de nuestro servicio?",
        opciones: ["Calidad", "Precio", "Atención al cliente", "Rapidez"]
      }
    ],
    nivelPlan: "free",
    tags: "nps,cliente,satisfacción,customer,lealtad"
  },
  {
    nombre: "Feedback Capacitación",
    categoria: "Training",
    descripcion: "Evalúa la efectividad de sesiones de entrenamiento",
    objetivo: "Medir el impacto y calidad de las capacitaciones",
    preguntas: [
      {
        pregunta: "¿La capacitación cumplió con tus expectativas?",
        opciones: ["Superó expectativas", "Cumplió expectativas", "Parcialmente", "No cumplió"]
      },
      {
        pregunta: "¿Qué tan aplicable es lo aprendido a tu trabajo?",
        opciones: ["Muy aplicable", "Aplicable", "Poco aplicable", "No aplicable"]
      },
      {
        pregunta: "¿Cómo calificarías al instructor/facilitador?",
        opciones: ["Excelente", "Bueno", "Regular", "Deficiente"]
      },
      {
        pregunta: "¿Recomendarías esta capacitación a otros?",
        opciones: ["Definitivamente", "Probablemente", "Tal vez", "No"]
      }
    ],
    nivelPlan: "free",
    tags: "capacitación,training,feedback,educación,aprendizaje"
  },
  {
    nombre: "Evaluación 360°",
    categoria: "360",
    descripcion: "Evaluación integral de desempeño desde múltiples perspectivas",
    objetivo: "Obtener feedback completo sobre el desempeño de un colaborador",
    preguntas: [
      {
        pregunta: "¿Cómo calificarías las habilidades de comunicación?",
        opciones: ["Excepcional", "Muy buena", "Adecuada", "Necesita mejorar"]
      },
      {
        pregunta: "¿Cómo es su capacidad de trabajo en equipo?",
        opciones: ["Excelente colaborador", "Buen colaborador", "Colaborador promedio", "Prefiere trabajar solo"]
      },
      {
        pregunta: "¿Cómo maneja la presión y los plazos?",
        opciones: ["Excepcionalmente bien", "Bien", "Con dificultad", "Mal"]
      },
      {
        pregunta: "¿Demuestra liderazgo en su rol?",
        opciones: ["Líder natural", "Muestra potencial", "Ocasionalmente", "No aplica"]
      },
      {
        pregunta: "¿Cómo es su actitud hacia el aprendizaje?",
        opciones: ["Proactivo", "Receptivo", "Pasivo", "Resistente"]
      }
    ],
    nivelPlan: "professional",
    tags: "360,evaluación,desempeño,feedback,profesional"
  }
];
// ============================
*/

// ============================
// ADAPTIVE CARDS HANDLERS (MÉTODO CORRECTO)
// ============================

// handler para mostrar comandos disponibles
app.adaptiveCards.actionSubmit('show_commands', async (context, state, data) => {
  const card = createAvailableCommandsCard();
  await context.sendActivity("🔄 Generando...");
  await context.sendActivity(MessageFactory.attachment(card));
});

app.adaptiveCards.actionSubmit('show_help', async (context, state, data) => {
  const welcomeCard = createWelcomeCard();
  await context.sendActivity("🔄 Generando...");
  await context.sendActivity(MessageFactory.attachment(welcomeCard));
});

// Handler para respuestas de encuesta
app.adaptiveCards.actionSubmit('survey_response', async (context, state, data) => {
  console.log('🎴 Survey response recibida:', data);
  
  try {
    const { encuestaId, preguntaIndex, respuesta, preguntaTexto } = data;
    const userId = context.activity.from.id;
    
    // Validaciones básicas
    if (!encuestaId || preguntaIndex === undefined || !respuesta) {
      await context.sendActivity("❌ **Datos incompletos en la respuesta**");
      return;
    }
    
    // Buscar encuesta
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
      return;
    }
    
    // Validar pregunta
    if (preguntaIndex < 0 || preguntaIndex >= encuesta.preguntas.length) {
      await context.sendActivity(`❌ **Pregunta inválida**`);
      return;
    }
    
    const pregunta = encuesta.preguntas[preguntaIndex];
    
    // Validar respuesta
    const opcionValida = pregunta.opciones.find(opcion => 
      opcion.toLowerCase() === respuesta.toLowerCase()
    );
    
    if (!opcionValida) {
      await context.sendActivity(`❌ **Respuesta inválida**: "${respuesta}"`);
      return;
    }
    
    // Guardar respuesta
    await guardarRespuestaIndividualAzure(encuestaId, userId, preguntaIndex, opcionValida, preguntaTexto);
    console.log('✅ Respuesta guardada exitosamente');
    
    // Determinar siguiente acción
    if (preguntaIndex + 1 < encuesta.preguntas.length) {
      // Hay más preguntas
      const nextCard = createSurveyResponseCard(encuesta, preguntaIndex + 1);
      await context.sendActivity("🔄 Generando...");
      await context.sendActivity(MessageFactory.attachment(nextCard));
    } else {
      // Encuesta completada
      await context.sendActivity(`🎉 **¡Encuesta completada!** 

✅ **Respuesta guardada:** "${opcionValida}"
📊 **Encuesta:** ${encuesta.titulo}
☁️ **Almacenado en Azure**

🎯 **Ver resultados:** \`resultados ${encuestaId}\``);
    }
    
  } catch (error) {
    console.error('❌ Error procesando respuesta:', error);
    await context.sendActivity("❌ Error al procesar tu respuesta. Intenta nuevamente.");
  }
});


// Handler para ver resultados desde card
app.adaptiveCards.actionSubmit('view_results', async (context, state, data) => {
  console.log('📊 Ver resultados desde card:', data);
  
  const { encuestaId } = data;
  if (!encuestaId) {
    await context.sendActivity("❌ **Error:** ID de encuesta requerido");
    return;
  }
  
  try {
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
      return;
    }
    
    let resultados = await cargarResultadosAzure(encuestaId);
    if (!resultados) {
      resultados = {
        encuestaId: encuestaId,
        titulo: encuesta.titulo,
        fechaCreacion: new Date(),
        estado: 'activa',
        totalParticipantes: 0,
        respuestas: [],
        resumen: {}
      };
    }
    
    calcularResumen(resultados, encuesta);
    
    let reporte = `📊 **${resultados.titulo}**\n`;
    reporte += `👥 **${resultados.totalParticipantes}** participantes\n\n`;
    
    if (resultados.totalParticipantes === 0) {
      reporte += `🔔 **Sin respuestas aún**\n\n**Para responder:** \`responder ${encuestaId}\``;
    } else {
      reporte += `📈 **Hay resultados disponibles**\n\n**Ver completo:** \`resultados ${encuestaId}\``;
    }
    
    await context.sendActivity(reporte);
    
  } catch (error) {
    console.error('❌ Error mostrando resultados:', error);
    await context.sendActivity("❌ Error al cargar resultados");
  }
});

// Handler para listar encuestas desde card
app.adaptiveCards.actionSubmit('list_surveys', async (context, state, data) => {
  console.log('📋 Ver todas las encuestas desde card');
  
  try {
    const tenantId = context.activity.channelData?.tenant?.id;
    const encuestas = await listarEncuestasAzure(tenantId);
    const userId = context.activity.from.id; // Obtener ID del usuario
    const listCard = await createListSurveysCardAsync(encuestas, userId);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(listCard));

  } catch (error) {
    console.error('❌ Error listando encuestas:', error);
    await context.sendActivity("❌ Error al acceder a las encuestas.");
  }
});

// Actualizar el handler existente para usar la nueva card
app.adaptiveCards.actionSubmit('view_survey_results', async (context, state, data) => {
  console.log('📊 Ver resultados desde card:', data);
  
  const { encuestaId, titulo } = data;
  
  try {
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
      return;
    }

    let resultados = await cargarResultadosAzure(encuestaId);
    if (!resultados) {
      resultados = {
        encuestaId: encuestaId,
        titulo: encuesta.titulo,
        fechaCreacion: new Date(),
        estado: 'activa',
        totalParticipantes: 0,
        respuestas: [],
        resumen: {}
      };
    }

    calcularResumen(resultados, encuesta);

    const resultsCard = createResultsCard(encuesta, resultados);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(resultsCard));

  } catch (error) {
    console.error('❌ Error mostrando resultados:', error);
    await context.sendActivity("❌ Error al cargar resultados");
  }
});

// Handler para cuando intentan acceder a encuesta cerrada
app.adaptiveCards.actionSubmit('survey_closed_info', async (context, state, data) => {
  const { encuestaId } = data;
  
  await context.sendActivity(`🔒 **Encuesta cerrada**

La encuesta \`${encuestaId}\` ya no está disponible para responder.

💡 **Puedes:**
- Ver los resultados finales: \`resultados ${encuestaId}\`
- Ver otras encuestas disponibles: \`listar\`

🎯 **¿Necesitas crear una nueva encuesta?** Solo dime qué tipo quieres.`);
});

// Handler para debug
app.adaptiveCards.actionSubmit('debug_test', async (context, state, data) => {
  console.log('🔧 Debug test ejecutado!', data);
  
  await context.sendActivity(`✅ **¡Handler funcionando!**

🎯 **Datos recibidos:** ${JSON.stringify(data)}
⏰ **Timestamp:** ${new Date().toISOString()}

🎉 **Las Adaptive Cards están funcionando correctamente!**`);
});

// ============================
// HANDLERS NUEVOS PARA LAS ACCIONES
// ============================

// Handler para iniciar encuesta desde card
app.adaptiveCards.actionSubmit('start_survey', async (context, state, data) => {
  console.log('📝 Iniciar encuesta desde card:', data);
  
  const { encuestaId, titulo } = data;
  
  try {
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
      return;
    }

    const responseCard = createSurveyResponseCard(encuesta, 0);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(responseCard));

  } catch (error) {
    console.error('❌ Error al iniciar encuesta:', error);
    await context.sendActivity("❌ Error al cargar la encuesta. Intenta nuevamente.");
  }
});

// Handler para ver resultados desde card
app.adaptiveCards.actionSubmit('view_survey_results', async (context, state, data) => {
  console.log('📊 Ver resultados desde card:', data);
  
  const { encuestaId, titulo } = data;
  
  try {
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
      return;
    }

    let resultados = await cargarResultadosAzure(encuestaId);
    if (!resultados) {
      resultados = {
        encuestaId: encuestaId,
        titulo: encuesta.titulo,
        fechaCreacion: new Date(),
        estado: 'activa',
        totalParticipantes: 0,
        respuestas: [],
        resumen: {}
      };
    }

    calcularResumen(resultados, encuesta);

    const resultsCard = createResultsCard(encuesta, resultados);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(resultsCard));

  } catch (error) {
    console.error('❌ Error mostrando resultados:', error);
    await context.sendActivity("❌ Error al cargar resultados");
  }
});

// Handler para crear nueva encuesta desde card
app.adaptiveCards.actionSubmit('create_new_survey', async (context, state, data) => {
  console.log('➕ Crear nueva encuesta desde card');
  
  await context.sendActivity(`🎯 **¡Perfecto! Vamos a crear una nueva encuesta.**

Dime qué tipo de encuesta quieres crear. Por ejemplo:
• *"Quiero una encuesta de clima laboral"*
• *"Crear encuesta de satisfacción del cliente"*
• *"Encuesta de feedback para capacitación"*

¡Escribe tu solicitud y yo te ayudo a crearla! 🚀`);
});

// Handler para responder encuesta desde card
app.adaptiveCards.actionSubmit('start_survey_by_id', async (context, state, data) => {
  const encuestaId = data.encuestaId?.trim();

  if (!encuestaId) {
    await context.sendActivity("❌ Por favor, ingresa un ID de encuesta válido.");
    return;
  }

  try {
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ Encuesta no encontrada: \`${encuestaId}\``);
      return;
    }

    const responseCard = createSurveyResponseCard(encuesta, 0);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(responseCard));
  } catch (error) {
    console.error("❌ Error al iniciar encuesta desde ID:", error);
    await context.sendActivity("❌ Error al cargar la encuesta. Intenta nuevamente.");
  }
});


// ============================
// FUNCIONES UTILITARIAS
// ============================

function generarIdEncuesta(titulo: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const tituloLimpio = titulo.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toLowerCase();
  return `${tituloLimpio}_${timestamp}_${random}`;
}

function crearParticipanteAnonimo(userId: string, encuestaId: string): string {
  return sha256(userId.trim().toLowerCase(), encuestaId);
  /*  const data = userId + encuestaId + "salt_secreto";
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return `anon_${Math.abs(hash).toString(36)}`;
*/}

function calcularResumen(resultados: ResultadosEncuesta, encuesta: Encuesta): void {
  resultados.resumen = {};
  
  encuesta.preguntas.forEach((pregunta, preguntaIndex) => {
    resultados.resumen![preguntaIndex] = {};
    
    pregunta.opciones.forEach(opcion => {
      resultados.resumen![preguntaIndex][opcion] = 0;
    });
    
    resultados.respuestas
      .filter(r => r.preguntaIndex === preguntaIndex)
      .forEach(respuesta => {
        if (resultados.resumen![preguntaIndex][respuesta.respuesta] !== undefined) {
          resultados.resumen![preguntaIndex][respuesta.respuesta]++;
        }
      });
  });
  
  const participantesUnicos = new Set(resultados.respuestas.map(r => r.participanteId));
  resultados.totalParticipantes = participantesUnicos.size;
}

// ============================
// FUNCIONES AZURE
// ============================

async function guardarEncuestaEnAzure(encuesta: Encuesta): Promise<string> {
  try {
    console.log(`💾 Guardando encuesta en Azure: ${encuesta.titulo}`);
    await azureService.guardarEncuesta(encuesta);
    return encuesta.id!;
  } catch (error) {
    console.error('❌ Error guardando encuesta en Azure:', error);
    throw new Error(`Error al guardar en Azure: ${error.message}`);
  }
}

async function cargarResultadosAzure(encuestaId: string): Promise<ResultadosEncuesta | null> {
  try {
    return await azureService.cargarResultados(encuestaId);
  } catch (error) {
    console.error('❌ Error cargando resultados desde Azure:', error);
    return null;
  }
}

async function guardarResultadosAzure(resultados: ResultadosEncuesta): Promise<void> {
  try {
    await azureService.guardarResultados(resultados);
  } catch (error) {
    console.error('❌ Error guardando resultados en Azure:', error);
    throw error;
  }
}

async function buscarEncuestaEnAzure(encuestaId: string): Promise<Encuesta | null> {
  try {
    return await azureService.cargarEncuesta(encuestaId);
  } catch (error) {
    console.error('❌ Error buscando encuesta en Azure:', error);
    return null;
  }
}

async function listarEncuestasAzure(tenantId?: string): Promise<Encuesta[]> {
  try {
    return await azureService.listarEncuestas(tenantId);
  } catch (error) {
    console.error('❌ Error listando encuestas desde Azure:', error);
    return [];
  }
}

export async function guardarRespuestaIndividualAzure(
  encuestaId: string, 
  userId: string, 
  preguntaIndex: number, 
  respuesta: string, 
  preguntaTexto: string
): Promise<void> {
  try {
    // 1) Anonimizar participante
    const participanteAnonimo = crearParticipanteAnonimo(userId, encuestaId);

    // 2) Guardar la respuesta en Azure Table “Respuestas”
    await azureService.guardarRespuesta(
      encuestaId,
      participanteAnonimo,
      preguntaIndex,
      respuesta
    );

    // 3) Registrar en tiempo real en la tabla “Resultados”
    await recordResponse(
      encuestaId,
      { [preguntaIndex]: respuesta }
    );

    // 4) Legacy: actualizar resultados consolidados si existe esa lógica
    await actualizarResultadosConsolidados(encuestaId);

  } catch (error) {
    console.error("❌ Error al guardar respuesta en Azure:", error);
    throw error;
  }
}

async function actualizarResultadosConsolidados(encuestaId: string): Promise<void> {
  try {
    const encuesta = await azureService.cargarEncuesta(encuestaId);
    if (!encuesta) return;
    
    const respuestas = await azureService.cargarRespuestasEncuesta(encuestaId);
    
    let resultados = await cargarResultadosAzure(encuestaId);
    if (!resultados) {
      resultados = {
        encuestaId: encuestaId,
        titulo: encuesta.titulo,
        fechaCreacion: new Date(encuesta.fechaCreacion),
        estado: 'activa',
        totalParticipantes: 0,
        respuestas: [],
        resumen: {}
      };
    }
    
    resultados.respuestas = respuestas;
    calcularResumen(resultados, encuesta);
    await guardarResultadosAzure(resultados);
  } catch (error) {
    console.error('❌ Error actualizando resultados consolidados:', error);
  }
}

function createSurveyResponseCard(encuesta: Encuesta, preguntaIndex: number): any {
  const pregunta = encuesta.preguntas[preguntaIndex];
  const totalPreguntas = encuesta.preguntas.length;
  const progreso = Math.round(((preguntaIndex + 1) / totalPreguntas) * 100);
  
  const card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
      {
        "type": "Container",
        "style": "emphasis",
        "items": [
          {
            "type": "TextBlock",
            "text": "🎯 TeamPulse",
            "weight": "Bolder",
            "size": "Medium",
            "color": "Accent"
          },
          {
            "type": "TextBlock",
            "text": encuesta.titulo,
            "size": "Small",
            "color": "Good",
            "weight": "Bolder"
          }
        ]
      },
      {
        "type": "TextBlock",
        "text": `Pregunta ${preguntaIndex + 1} de ${totalPreguntas}`,
        "size": "Small",
        "color": "Accent",
        "weight": "Bolder",
        "spacing": "Medium"
      },
      {
        "type": "TextBlock",
        "text": pregunta.pregunta,
        "size": "Large",
        "weight": "Bolder",
        "wrap": true,
        "spacing": "Large"
      },
      {
        "type": "TextBlock",
        "text": `💾 Progreso: ${progreso}% | 🔒 Anónimo`,
        "size": "Small",
        "color": "Accent",
        "spacing": "Medium"
      }
    ],
    "actions": [
      // ✅ RESPUESTAS - ESTRUCTURA CORREGIDA FINAL
      ...pregunta.opciones.map((opcion, index) => ({
        "type": "Action.Submit",
        "title": `${index === 0 ? '🟢' : index === 1 ? '🔵' : index === 2 ? '🟡' : '⚫'} ${opcion}`,
        "data": {
          "verb": "survey_response",
          "encuestaId": encuesta.id,
          "preguntaIndex": preguntaIndex,
          "respuesta": opcion,
          "preguntaTexto": pregunta.pregunta
        }
      })),
      
      // Acciones adicionales
      {
        "type": "Action.Submit",
        "title": "📊 Ver Resultados",
        "data": {
          "verb": "view_results",
          "encuestaId": encuesta.id
        }
      },
      {
        "type": "Action.Submit",
        "title": "📋 Todas las Encuestas",
        "data": {
          "verb": "list_surveys"
        }
      }
    ]
  };
  
  return CardFactory.adaptiveCard(card);
}

function createResultsCard(encuesta: Encuesta, resultados: ResultadosEncuesta): any {
  const card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
      {
        "type": "Container",
        "style": "emphasis",
        "items": [
          {
            "type": "TextBlock",
            "text": "📊 TeamPulse Results",
            "weight": "Bolder",
            "size": "Medium",
            "color": "Accent"
          },
          {
            "type": "TextBlock",
            "text": resultados.titulo,
            "size": "Large",
            "weight": "Bolder"
          }
        ]
      },
      {
        "type": "ColumnSet",
        "columns": [
          {
            "type": "Column",
            "width": "stretch",
            "items": [
              {
                "type": "TextBlock",
                "text": `👥 ${resultados.totalParticipantes} participantes`,
                "size": "Medium",
                "weight": "Bolder"
              }
            ]
          },
          {
            "type": "Column",
            "width": "auto",
            "items": [
              {
                "type": "TextBlock",
                "text": `🎯 ${encuesta.preguntas.length} preguntas`,
                "size": "Medium",
                "weight": "Bolder"
              }
            ]
          }
        ]
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "📝 Responder Encuesta",
        "data": {
          "verb": "start_survey",
          "encuestaId": encuesta.id,
          "titulo": encuesta.titulo
        }
      },
      {
        "type": "Action.Submit",
        "title": "📋 Ver Todas las Encuestas",
        "data": {
          "verb": "list_surveys"
        }
      }
    ]
  };

  if (resultados.totalParticipantes === 0) {
    // Sin respuestas
    card.body.push({
      "type": "Container",
      "style": "emphasis",
      "items": [
        {
          "type": "TextBlock",
          "text": "🔔 Sin Respuestas Aún",
          "size": "Large",
          "weight": "Bolder"
        },
        {
          "type": "TextBlock",
          "text": "Esta encuesta no tiene respuestas todavía. ¡Sé el primero en responder!",
          "size": "Medium",
          "weight": "Bolder"
        }
      ]
    });
  } else {
    // Con respuestas - agregar resultados por pregunta
    encuesta.preguntas.forEach((pregunta, index) => {
      const respuestasPregunta = resultados.resumen![index] || {};
      const totalRespuestas = Object.values(respuestasPregunta).reduce((sum: number, count) => sum + (count as number), 0);
      
      // Container para cada pregunta
      card.body.push({
        "type": "Container",
        "style": "emphasis",
        "items": [
          {
            "type": "TextBlock",
            "text": `Pregunta ${index + 1}`,
            "size": "Medium",
            "weight": "Bolder",
            "color": "Accent"
          },
          {
            "type": "TextBlock",
            "text": pregunta.pregunta,
            "size": "Medium",
            "weight": "Bolder"
          }
        ]
      });

      if (totalRespuestas === 0) {
        card.body.push({
          "type": "Container",
          "style": "emphasis",
          "items": [
            {
              "type": "TextBlock",
              "text": "Sin respuestas para esta pregunta",
              "size": "Small",
              "weight": "Bolder"
            }
          ]
        });
      } else {
        // Agregar barras de resultados
        Object.entries(respuestasPregunta).forEach(([opcion, cantidad]) => {
          const porcentaje = Math.round(((cantidad as number) / totalRespuestas) * 100);
          const barraLength = Math.floor(porcentaje / 5); // Cada 5% = 1 barra
          const barras = '█'.repeat(barraLength) + '░'.repeat(20 - barraLength);
          
          card.body.push({
            "type": "Container",
            "style": "emphasis",
            "items": [
              {
                "type": "TextBlock",
                "text": `${opcion}`,
                "size": "Small",
                "weight": "Bolder"
              },
              {
                "type": "TextBlock",
                "text": `${barras} ${cantidad} votos (${porcentaje}%)`,
                "size": "Small",
                "weight": "Bolder"
              }
            ]
          });
        });
      }
    });
  }

  return CardFactory.adaptiveCard(card);
}

// 🔒 Validar acceso a encuesta
function validateSurveyAccess(encuesta: any, hasResponded: boolean): {
  status: 'can_respond' | 'already_responded' | 'survey_closed';
  buttonText: string;
  buttonIcon: string;
  statusText: string;
  statusIcon: string;
} {
  
  if (encuesta.estado === 'cerrada' || encuesta.estado === 'eliminada') {
    return {
      status: 'survey_closed',
      buttonText: 'Encuesta Cerrada',
      buttonIcon: '🔒',
      statusText: 'Cerrada',
      statusIcon: '🔴'
    };
  }
  
  if (hasResponded) {
    return {
      status: 'already_responded', 
      buttonText: 'Cambiar Respuesta',
      buttonIcon: '✏️',
      statusText: 'Ya respondiste',
      statusIcon: '✅'
    };
  }
  
  return {
    status: 'can_respond',
    buttonText: 'Responder',
    buttonIcon: '📝',
    statusText: 'Pendiente',
    statusIcon: '⏳'
  };
}

// ============================
// AI ACTION - CREAR ENCUESTA
// ============================

app.ai.action('crear_encuesta', async (context, state, data) => {
  console.log('🚀 Creando encuesta:', data?.titulo);
  
  try {
    if (!data || typeof data !== 'object') {
      await context.sendActivity("❌ Error: No se recibieron datos válidos para crear la encuesta.");
      return 'create-survey';
    }

    const { titulo, objetivo, preguntas } = data as Encuesta;

    // Validaciones básicas
    if (!titulo?.trim()) {
      await context.sendActivity("❌ Error: El título de la encuesta es obligatorio.");
      return 'create-survey';
    }

    if (!objetivo?.trim()) {
      await context.sendActivity("❌ Error: El objetivo de la encuesta es obligatorio.");
      return 'create-survey';
    }

    if (!preguntas || !Array.isArray(preguntas) || preguntas.length === 0) {
      await context.sendActivity("❌ Error: Se necesita al menos una pregunta para crear la encuesta.");
      return 'create-survey';
    }

    // Validar preguntas
    for (let i = 0; i < preguntas.length; i++) {
      const pregunta = preguntas[i];
      if (!pregunta.pregunta?.trim()) {
        await context.sendActivity(`❌ Error: La pregunta ${i + 1} no tiene texto.`);
        return 'create-survey';
      }
      
      if (!Array.isArray(pregunta.opciones) || pregunta.opciones.length < 2) {
        await context.sendActivity(`❌ Error: La pregunta ${i + 1} necesita al menos 2 opciones de respuesta.`);
        return 'create-survey';
      }

      const opcionesValidas = pregunta.opciones.filter(op => op && op.trim().length > 0);
      if (opcionesValidas.length < 2) {
        await context.sendActivity(`❌ Error: La pregunta ${i + 1} necesita al menos 2 opciones válidas.`);
        return 'create-survey';
      }
      
      pregunta.opciones = opcionesValidas.map(op => op.trim());
    }

    const encuestaId = generarIdEncuesta(titulo);
        
    const tenantId = context.activity.channelData?.tenant?.id;
    if (!tenantId || !(await canCreateSurvey(tenantId))) {
      await context.sendActivity(
        "🚫 Límite: 1 encuesta por semana en plan **Free**. Probá la semana próxima o actualizá a Pro."
      );
      return 'create-survey';
    }

    const encuesta: Encuesta = {
      titulo: titulo.trim(),
      objetivo: objetivo.trim(),
      preguntas,
      creador: context.activity.from.name || 'Usuario desconocido',
      id: encuestaId,
      fechaCreacion: new Date(),
      tenantId: tenantId,
    };

    await guardarEncuestaEnAzure(encuesta);
    await registerSurveyCreation(tenantId);   // registra 1 encuesta nueva
    
    const resultadosIniciales: ResultadosEncuesta = {
      encuestaId: encuestaId,
      titulo: encuesta.titulo,
      fechaCreacion: new Date(),
      estado: 'activa',
      totalParticipantes: 0,
      respuestas: [],
      resumen: {}
    };
    
    await guardarResultadosAzure(resultadosIniciales);
    
    const resumen = `🎉 **¡Encuesta "${encuesta.titulo}" creada exitosamente!**

**📋 Detalles:**
• **ID:** \`${encuestaId}\`
• **Objetivo:** ${encuesta.objetivo}
• **Preguntas:** ${preguntas.length}
• **Almacenado en:** Azure Table Storage ☁️

**🎯 Para responder:** \`responder ${encuestaId}\`
**📊 Ver resultados:** \`resultados ${encuestaId}\``;

    await context.sendActivity(resumen);
    return 'create-survey';

  } catch (error) {
    console.error("❌ Error creando encuesta:", error);
    await context.sendActivity(`❌ Error interno al crear la encuesta: ${error.message}`);
    return 'create-survey';
  }
});

// ===============================================
// AI ACTION - BUSCAR ENCUESTAS POR PALABRAS CLAVE
// ===============================================

app.ai.action('buscar_encuestas', async (context, state, data) => {
  const rawKeywords = data?.keywords;

  if (!Array.isArray(rawKeywords) || rawKeywords.length === 0) {
    await context.sendActivity("❌ No se detectaron palabras clave para buscar encuestas.");
    return 'buscar_encuestas';
  }

  const keywords = rawKeywords.map(k => k.toLowerCase());

  const tenantId = context.activity.channelData?.tenant?.id;
  const encuestas = await listarEncuestasAzure(tenantId);
  const userId = context.activity.from.id; // Obtener ID del usuario
  const coincidencias = encuestas.filter(e =>
    keywords.some(k =>
      (typeof e.titulo === 'string' && e.titulo.toLowerCase().includes(k)) ||
      (typeof e.objetivo === 'string' && e.objetivo.toLowerCase().includes(k))
    )
  );

  if (coincidencias.length === 0) {
    await context.sendActivity("🔍 No se encontraron encuestas que coincidan con esas palabras.");
  } else {
    const card = await createListSurveysCardAsync(coincidencias, userId);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(card));
  }

  return 'buscar_encuestas';
});

// ===============================================
// AI ACTION - RESPONDER ENCUESTA POR NOMBRE
// ===============================================

app.ai.action('responder_por_nombre', async (context, state, data) => {
  const titulo = data?.titulo?.toLowerCase().trim();

  if (!titulo) {
    await context.sendActivity("❌ No se especificó un título para buscar la encuesta.");
    return 'responder_por_nombre';
  }

  const tenantId = context.activity.channelData?.tenant?.id;
  const encuestas = await listarEncuestasAzure(tenantId);
  
  const coincidencia = encuestas.find(e =>
    typeof e.titulo === 'string' && e.titulo.toLowerCase().includes(titulo)
  );

  if (!coincidencia) {
    await context.sendActivity(`🔍 No se encontró ninguna encuesta con el título que contenga: "${titulo}"`);
  } else {
    const card = createSurveyResponseCard(coincidencia, 0);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(card));
  }

  return 'responder_por_nombre';
});


// ============================
// COMANDOS DE TEXTO
// ============================

// COMANDO ANALIZAR (versión con AI Insights Service /src/services/aiInsightsService.ts)
app.message(/^analizar\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^analizar\s+(.+)$/i);
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:** `analizar [id_encuesta]`");
    return;
  }

  const encuestaId = match[1].trim();
  try {
    // Verificar plan del tenant
    const tenantId = context.activity.channelData?.tenant?.id;
    const plan = tenantId ? await getPlan(tenantId) : "free";
    
    if (plan === "free") {
      await context.sendActivity(
        "⭐ **Característica premium**: El análisis detallado está disponible solo en planes **Professional** y **Enterprise**.\n\nActualiza tu plan para acceder a insights detallados de IA."
      );
      return;
    }

    await context.sendActivity("🧠 **Generando análisis con IA...**");

    // 1) Cargar encuesta y resultados existentes
    const encuesta = await azureService.cargarEncuesta(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
      return;
    }
    
    const resultados = await azureService.cargarResultados(encuestaId);
    if (!resultados || resultados.totalParticipantes === 0) {
      await context.sendActivity("📊 Esta encuesta no tiene respuestas suficientes para analizar.");
      return;
    }

    // 2) Importar el servicio de análisis de IA
    const { obtenerAnalisisDesdeAzure, generarAnalisisIA } = await import("../services/aiInsightsService");

    // 3) Verificar si ya existe un análisis reciente (menos de 24h)
    let analisis = await obtenerAnalisisDesdeAzure(encuestaId, tenantId);
    const ahora = new Date();
    
    // Si existe un análisis, verificar si es reciente
    if (analisis) {
      const ultimaActualizacion = new Date(analisis.ultimaActualizacion);
      const horasDesdeActualizacion = Math.abs(ahora.getTime() - ultimaActualizacion.getTime()) / 36e5;
      
      // Si el análisis tiene más de 24 horas, regenerar
      if (horasDesdeActualizacion > 24) {
        analisis = null; // Forzar regeneración
      }
    }

    // 4) Si no hay análisis reciente, generarlo
    if (!analisis) {
      // Preparar datos para el análisis
      const datosAnalisis = encuesta.preguntas.map((pregunta, idx) => {
        return {
          pregunta: pregunta.pregunta,
          opciones: pregunta.opciones,
          resultados: resultados.resumen?.[idx] || {}
        };
      });

      // Generar análisis con IA
      analisis = await generarAnalisisIA(encuestaId, encuesta.titulo, datosAnalisis, tenantId);
    }

    // 5) Crear tarjeta de análisis detallado
    const analysisCard = createAnalysisCard(analisis, encuesta, resultados);
    await context.sendActivity(MessageFactory.attachment(analysisCard));

  } catch (error) {
    console.error("❌ Error en analizar encuesta:", error);
    await context.sendActivity("❌ Ocurrió un error al analizar la encuesta. Intenta más tarde.");
  }
});

// COMANDO RESPONDER
/* ────────────────────────────
   RESPONDER ENCUESTA
   Límite: 50 respuestas (plan Free)
──────────────────────────────*/
app.message(/^responder\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^responder\s+(.+)$/i);
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`responder [id_encuesta]`");
    return;
  }

  const encuestaId = match[1].trim();

  try {
    // Obtener el plan del tenant actual
    const tenantId = context.activity.channelData?.tenant?.id;
    const plan = tenantId ? await getPlan(tenantId) : "free";

    // ─── Aplicar límite de respuestas solo si plan Free ───
    if (plan === "free" && !(await checkResponsesLimit(encuestaId))) {
      await context.sendActivity(
        "🚫 Esta encuesta alcanzó su límite de **50 respuestas** en plan Free."
      );
      return;
    }
    // ─────────────────────────────────────────────────────────

    const encuestaEncontrada = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaEncontrada) {
      await context.sendActivity(
        `❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`
      );
      return;
    }

    const responseCard = createSurveyResponseCard(encuestaEncontrada, 0);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(responseCard));

  } catch (error: any) {
    console.error("❌ Error al mostrar encuesta:", error);
    await context.sendActivity("❌ Error al cargar la encuesta. Verifica que el ID sea correcto.");
  }
});


// COMANDO LISTAR
app.message(/^listar$/i, async (context, state) => {
  try {
    const tenantId = context.activity.channelData?.tenant?.id;
    if (!tenantId) {
      await context.sendActivity("❌ Error: No se pudo identificar el tenant.");
      return;
    }
    
    const encuestas = await listarEncuestasAzure(tenantId);
    const userId = context.activity.from.id; // ID del usuario que envía el mensaje
    const listCard = await createListSurveysCardAsync(encuestas, userId);
    await context.sendActivity("🔄 Generando...");
    await context.sendActivity(MessageFactory.attachment(listCard));

  } catch (error) {
    console.error('❌ Error listando encuestas:', error);
    await context.sendActivity("❌ Error al acceder a las encuestas.");
  }
});

// COMANDO RESULTADOS
app.message(/^resultados\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text?.match(/^resultados\s+(.+)$/i);
  if (!match) {
    await context.sendActivity("❌ **Formato incorrecto**. Usa: `resultados [ID]`");
    return;
  }

  const encuestaId = match[1].trim();

  try {
    // 1) Cargo la encuesta existente
    const encuesta = await azureService.cargarEncuesta(encuestaId);
    if (!encuesta) {
      await context.sendActivity(
        `❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\n💡 Usa \`listar\` para ver todas las encuestas.`
      );
      return;
    }

    // 2) Cargo los resultados ya consolidados
    let resultados = await azureService.cargarResultados(encuestaId);

    // 3) Si no hay resultados previos, inicializo
    if (!resultados) {
      resultados = {
        encuestaId,
        titulo: encuesta.titulo,
        fechaCreacion: new Date(),   // o parsea la fecha de encuesta.fechaCreacion
        estado: "activa",
        totalParticipantes: 0,
        respuestas: [],              // tu modelo acepta array
        resumen: {}
      };
      // opcional: puedes opcionalmente guardar este registro inicial:
      // await azureService.guardarResultados(resultados);
    }

    // 4) Armo y envío la tarjeta
    const resultsCard = createResultsCard(encuesta, resultados);
    await context.sendActivity("🔄 Generando resultados…");
    await context.sendActivity(MessageFactory.attachment(resultsCard));

  } catch (error) {
    console.error("❌ Error mostrando resultados:", error);
    await context.sendActivity("❌ Error al cargar resultados. Intenta nuevamente.");
  }
});

// COMANDO EXPORTAR
app.message(/^exportar\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^exportar\s+(.+)$/i);
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:** `exportar [id_encuesta]`");
    return;
  }

  const encuestaId = match[1].trim();
  try {
    // 1) Cargar encuesta y resultados
    const encuesta = await azureService.cargarEncuesta(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
      return;
    }
    const resultados = await azureService.cargarResultados(encuestaId);
    if (!resultados || resultados.totalParticipantes === 0) {
      await context.sendActivity("📊 Esta encuesta no tiene respuestas para exportar.");
      return;
    }
    
    /*/ 1.5) Identificar el tenant y su plan
    const tenantId = context.activity.channelData?.tenant?.id;
    const plan = tenantId ? await getPlan(tenantId) : "free";

    if (plan === "free") {
      await context.sendActivity(
        "⚠️ La exportación a Excel está disponible solo en planes **Professional** y **Enterprise**."
      );
      return;   // corta la función para usuarios Free
    }
    /*/

    // 2) Generar contenido CSV
    let csv = `"Encuesta","${encuesta.titulo}"\n`;
    csv += `"Participantes",${resultados.totalParticipantes}\n\n`;
    csv += `"Pregunta","Opción","Votos"\n`;
    encuesta.preguntas.forEach((pregunta, idx) => {
      const conteos = resultados.resumen?.[idx] || {};
      const opciones = pregunta.opciones;
      opciones.forEach(opcion => {
        const votos = conteos[opcion] ?? 0;
        // Escapar comillas dobles en texto de pregunta/opción
        const preguntaTexto = pregunta.pregunta.replace(/\"/g, '""');
        const opcionTexto = opcion.replace(/\"/g, '""');
        csv += `"${preguntaTexto}","${opcionTexto}",${votos}\n`;
      });
    });

    // 3) Convertir a Base64 y armar attachment
    const csvBuffer = Buffer.from(csv, "utf-8");
    const base64 = csvBuffer.toString("base64");
    const attachment = {
      name: `${encuesta.titulo.replace(/[\/:*?"<>|]/g, "_") || "resultados"}.csv`,
      contentType: "text/csv",
      contentUrl: `data:text/csv;base64,${base64}`
    };

    // 4) Enviar el archivo al usuario
    await context.sendActivity({
      text: "📎 **Exportando resultados...**",  // mensaje opcional
      attachments: [attachment]
    });
    // Al enviarse, Teams mostrará el archivo .csv adjunto para descargar.

  } catch (error) {
    console.error("❌ Error al exportar resultados:", error);
    await context.sendActivity("❌ Ocurrió un error al generar la exportación.");
  }
});

// COMANDO DE DIAGNÓSTICO ADMIN
// Este comando es solo para administradores y permite diagnosticar problemas con los planes

app.message(/^admin_diagnose$/i, async (context) => {
  try {
    // Verificar si es administrador - Reemplaza estos IDs con los reales
    const adminUserIds = [
      "105af15b-7381-4370-99a0-0cb24dcc6886", // ID de Gregorio Correa en Tenant Incuba
      // Agrega otros IDs de administradores si es necesario
    ];
    
    const userId = context.activity.from.id;
    const userName = context.activity.from.name;
    
    if (!adminUserIds.includes(userId)) {
      await context.sendActivity("🔒 Este comando es solo para administradores.");
      return;
    }
    
    await context.sendActivity("🔍 **Iniciando diagnóstico...**");
    
    // Obtener info del tenant actual
    const tenantId = context.activity.channelData?.tenant?.id;
    const tenantName = context.activity.channelData?.tenant?.name || "Desconocido";
    
    await context.sendActivity(`📊 **Información de contexto:**
• Usuario: ${userName} (ID: ${userId})
• Tenant: ${tenantName} (ID: ${tenantId})
`);
    
    // Importar TableClient para diagnóstico
    const { TableClient, AzureNamedKeyCredential } = await import("@azure/data-tables");
    
    const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const key = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const cred = new AzureNamedKeyCredential(account, key);
    
    const subsTable = new TableClient(
      `https://${account}.table.core.windows.net`,
      "MarketplaceSubscriptions",
      cred
    );
    
    // Buscar todas las suscripciones relacionadas con este tenant
    let mensaje = `🔍 **Suscripciones para tenant ${tenantId}:**\n\n`;
    
    const entities = subsTable.listEntities({
      queryOptions: {
        filter: `userTenant eq '${tenantId}'`
      }
    });
    
    let count = 0;
    for await (const entity of entities) {
      count++;
      mensaje += `**Suscripción ${count}:**\n`;
      mensaje += `• PartitionKey: \`${entity.partitionKey}\`\n`;
      mensaje += `• RowKey: \`${entity.rowKey}\`\n`;
      mensaje += `• PlanId: \`${entity.planId}\`\n`;
      mensaje += `• Status: \`${entity.status}\`\n`;
      mensaje += `• UserEmail: \`${entity.userEmail}\`\n`;
      mensaje += `• UserName: \`${entity.userName}\`\n`;
      mensaje += `• LastModified: \`${entity.lastModified}\`\n\n`;
    }
    
    if (count === 0) {
      mensaje += "❌ **No se encontraron suscripciones para este tenant.**\n\n";
    }
    
    // Buscar todas las suscripciones en la tabla (max 10)
    mensaje += `📋 **Últimas 10 suscripciones en la tabla:**\n\n`;
    
    const allEntities = subsTable.listEntities();
    count = 0;
    for await (const entity of allEntities) {
      if (count >= 10) break;
      count++;
      
      mensaje += `**${count}. ${entity.planId || 'Sin planId'}:**\n`;
      mensaje += `• Tenant: \`${entity.userTenant || 'N/A'}\`\n`;
      mensaje += `• Status: \`${entity.status || 'N/A'}\`\n`;
      mensaje += `• UserName: \`${entity.userName || 'N/A'}\`\n\n`;
    }
    
    if (count === 0) {
      mensaje += "❌ **No se encontraron suscripciones en la tabla.**\n\n";
    }
    
    // Verificar el plan actual según la implementación de getPlan
    const { getPlan } = await import("../middleware/planLimiter");
    const planActual = await getPlan(tenantId);
    
    mensaje += `🎯 **Plan determinado por getPlan:** \`${planActual}\`\n\n`;
    
    mensaje += `✅ **Diagnóstico completado.**`;
    
    await context.sendActivity(mensaje);
    
  } catch (error) {
    console.error("❌ Error en diagnóstico admin:", error);
    await context.sendActivity("❌ Error durante el diagnóstico. Revisa los logs del servidor.");
  }
});

// COMANDO MAKE_ME_ADMIN CON VALIDACIONES - Más seguro
app.message(/^make_me_admin$/i, async (context, state) => {
  try {
    console.log('👑 Usuario solicitando convertirse en admin...');
    
    const userId = context.activity.from.id;
    const userName = context.activity.from.name || 'Admin User';
    const tenantId = context.activity.channelData?.tenant?.id;
    
    console.log(`👑 Usuario ${userId} del tenant ${tenantId} solicitando convertirse en admin...`);

    // Validaciones básicas
    if (!tenantId || !userId) {
      await context.sendActivity("❌ **Error:** Información de usuario o tenant incompleta.");
      console.log(`👑 Buscamos usuario ${userId} y tenant ${tenantId} solicitando convertirse en admin...`);
      return;
    }
    
    await context.sendActivity("👑 **Verificando permisos...**");
    
    // Verificar si hay otros admins en el tenant
    const existingAdmins = await azureService.listarAdminsEnTenant(tenantId);
    
    // Si ya hay admins, requerir confirmación especial
    if (existingAdmins.length > 0) {
      await context.sendActivity(`⚠️ **Este tenant ya tiene ${existingAdmins.length} administrador(es).**

**Admins existentes:**
${existingAdmins.map(admin => `• ${admin.name} (${admin.email})`).join('\n')}

**Para convertirte en admin adicional, usa:** \`force_make_me_admin\`

⚠️ **Nota:** Solo usa este comando si tienes autorización del administrador actual.`);
      return;
    }
    
    // Si no hay admins, proceder automáticamente (primer admin)
    const userEmail = `${userName.replace(/\s+/g, '').toLowerCase()}@${tenantId}.onmicrosoft.com`;
    
    await azureService.agregarAdminUser(
      userId,
      tenantId, 
      userEmail,
      userName,
      'First admin - auto-promotion via make_me_admin'
    );
    
    await context.sendActivity(`🎉 **¡Eres el primer administrador de este tenant!** 👑

✅ **Acceso de administrador concedido**
📧 **Email:** ${userEmail}
🏢 **Tenant:** \`${tenantId}\`

🎯 **Ahora puedes:**
- Acceder al panel de administración
- Gestionar todas las encuestas del tenant
- Agregar otros administradores
- Ver estadísticas completas

🚀 **¡Tu tenant está listo para usar TeamPulse!**`);

  } catch (error) {
    console.error('❌ Error en make_me_admin:', error);
    await context.sendActivity("❌ Error al procesar la solicitud. Intenta nuevamente.");
  }
});

// COMANDO FORCE - Para casos especiales
app.message(/^force_make_me_admin$/i, async (context, state) => {
  try {
    const userId = context.activity.from.id;
    const userName = context.activity.from.name || 'Admin User';
    const tenantId = context.activity.channelData?.tenant?.id;
    const userEmail = `${userName.replace(/\s+/g, '').toLowerCase()}@${tenantId}.onmicrosoft.com`;
    
    await azureService.agregarAdminUser(
      userId,
      tenantId, 
      userEmail,
      userName,
      'Forced admin promotion'
    );
    
    await context.sendActivity(`⚡ **¡Administrador agregado por fuerza!** 👑

✅ **Acceso concedido a:** ${userName}
📧 **Email:** ${userEmail}

⚠️ **Nota:** Este comando debe usarse solo con autorización apropiada.`);

  } catch (error) {
    console.error('❌ Error en force_make_me_admin:', error);
    await context.sendActivity("❌ Error al forzar promoción a administrador.");
  }
});

// COMANDO DEBUG
app.message(/^debug_cards$/i, async (context, state) => {
  const testCard = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
      {
        "type": "TextBlock",
        "text": "🔧 Test Handler - TeamPulse",
        "weight": "Bolder",
        "size": "Large"
      },
      {
        "type": "TextBlock",
        "text": "Haz click en el botón para probar el handler.",
        "wrap": true
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "🟢 PROBAR HANDLER",
        "data": {
          "verb": "debug_test",
          "mensaje": "Test desde debug_cards",
          "timestamp": new Date().toISOString()
        }
      }
    ]
  };
  
  const cardMessage = MessageFactory.attachment(CardFactory.adaptiveCard(testCard));
  await context.sendActivity(cardMessage);
  
  await context.sendActivity("✅ **Card enviada**\n\nSi funciona, verás una respuesta al hacer click.");
});

// COMANDO PLAN INFO
// Muestra el estado del plan del usuario

app.message(/^plan_info|mi_plan$/i, async (context) => {
  try {
    const tenantId = context.activity.channelData?.tenant?.id;
    if (!tenantId) {
      await context.sendActivity("❌ No se pudo determinar el tenant. Por favor, inténtalo desde Microsoft Teams.");
      return;
    }

    console.log(`🔍 Obteniendo información de plan para tenant: ${tenantId}`);
    
    // Importar directamente las funciones actualizadas
    // Esto garantiza que estamos usando la versión más reciente
    const { getPlan, getUsageSummary } = await import("../middleware/planLimiter");
    
    // Obtener información del plan directamente
    const planType = await getPlan(tenantId);
    console.log(`✅ Plan detectado: ${planType}`);
    
    // Obtener resumen de uso
    const info = await getUsageSummary(tenantId);
    
    // Nombres amigables de los planes
    const planNames = {
      "free": "GRATUITO",
      "pro": "PROFESIONAL",
      "ent": "ENTERPRISE"
    };
    
    const planName = planNames[info.plan] || info.plan.toUpperCase();
    
    // Incluir información de debug
    console.log(`📊 Información detallada: ${JSON.stringify(info)}`);
    
    await context.sendActivity(
      `📊 **Estado de tu plan ${planName}**\n` +
      `• Tenant ID: \`${tenantId}\`\n` +
      `• Plan ID interno: \`${info.planOriginal}\`\n` +
      `• Encuestas usadas este mes: **${info.usados}/${info.max}**\n` +
      `• Te quedan: **${info.quedan}**\n` +
      `• Uso: **${info.porcentaje}%**\n\n` +
      `_Para actualizar tu plan, visita https://teampulse.incumate.io/pricing_`
    );
  } catch (error) {
    console.error("❌ Error al obtener información del plan:", error);
    await context.sendActivity("❌ Ocurrió un error al recuperar la información de tu plan. Por favor, intenta nuevamente.");
  }
});

// COMANDO REPORTAR
app.message(/^reportar\s+([\s\S]+)/i, async (context) => {
  const match = context.activity.text?.match(/^reportar\s+([\s\S]+)/i);
  const detalle = match?.[1]?.trim();
  if (!detalle) {
    await context.sendActivity("❌ Usa `reportar [detalle]` para describir el problema.");
    return;
  }

  await context.sendActivity("✅ ¡Gracias! Tu reporte ha sido registrado.");

  /*
  // Guarda en Table Storage (si ya tenés la función)
  await azureService.guardarReporte({
    tenantId : context.activity.channelData?.tenant?.id ?? "desconocido",
    user     : context.activity.from?.name ?? "anónimo",
    mensaje  : detalle,
    fecha    : new Date().toISOString()
  });
  */

  // Enviar correo
  const asunto = `TeamPulse – Nuevo reporte (${context.activity.from?.name})`;
  const cuerpo =
    `Tenant: ${context.activity.channelData?.tenant?.id}\n` +
    `Usuario: ${context.activity.from?.name}\n` +
    `Fecha  : ${new Date().toISOString()}\n\n` +
    `Detalle:\n${detalle}`;

  try {
    await enviarReportePorEmail(asunto, cuerpo);
  } catch (e) {
    console.error("Error enviando correo ACS:", e);
  }
});

// COMANDO AYUDA
app.message(/^ayuda|Ayuda$/i, async (context, state) => {
  const welcomeCard = createWelcomeCard();
  await context.sendActivity("🔄 Generando...");
  await context.sendActivity(MessageFactory.attachment(welcomeCard));
});


// COMANDO AYUDA --- VERSIÓN VIEJA (Gregorio) 
/*app.message(/^ayuda$/i, async (context, state) => {
  const ayuda = `🤖 **TeamPulse - Comandos disponibles:**

**📝 Crear encuestas:**
• "Quiero crear una encuesta"
• "Ayuda con una encuesta de clima laboral"

**📋 Ver encuestas:**
• \`listar\` - Ver todas las encuestas

**📊 Ver resultados:**
• \`resultados [ID]\` - Ver resultados de una encuesta

**📝 Responder encuestas:**
• \`responder [ID]\` - Responder con interfaz visual

**🧪 Pruebas:**
• \`debug_cards\` - Probar Adaptive Cards
• \`ayuda\` - Mostrar este mensaje

**💡 Ejemplo:**
• *"Crear encuesta de satisfacción laboral"*

¡Empezá creando tu primera encuesta! 🚀`;

  await context.sendActivity(ayuda);
});
*/

// ============================
// COMANDOS DE TEMPLATES
// ============================

// COMANDO: Crear templates seed (para inicializar)
// REEMPLAZAR el comando seed_templates en app.ts con esta versión con debug:

app.message(/^seed_templates$/i, async (context, state) => {
  console.log('🌱 Ejecutando seed de templates...');
  
  try {
    await context.sendActivity("🌱 **Creando templates iniciales...** ☁️\n\nEsto puede tardar unos momentos...");
    
    console.log('🔧 Llamando a azureService.crearTemplatesSeed()...');
    
    await azureService.crearTemplatesSeed();
    
    console.log('✅ crearTemplatesSeed() completado sin errores');
    
    await context.sendActivity(`🎉 **¡Templates iniciales creados exitosamente!** ☁️

📋 **Templates disponibles:**
• 🆓 Clima Laboral (HR)
• 🆓 NPS Cliente (Customer)  
• 🆓 Feedback Capacitación (Training)
• 💼 Trabajo Remoto (HR)
• 💼 Evaluación 360° (360)

**🎯 Comandos disponibles:**
• \`ver_templates\` - Ver todos los templates
• \`usar_template [id]\` - Usar un template específico
• \`buscar_templates [término]\` - Buscar templates

¡Templates listos para usar! 🚀`);

  } catch (error) {
    console.error('❌ Error creando templates seed:', error);
    console.error('❌ Stack trace completo:', error.stack);
    
    await context.sendActivity(`❌ **Error al crear templates iniciales**: ${error.message}\n\n🔧 **Debug info:** Ver logs del servidor para más detalles.`);
  }
});

// COMANDO: Ver todos los templates disponibles
app.message(/^ver_templates|templates|mostrar_templates$/i, async (context, state) => {
  console.log('📋 Listando templates disponibles desde Azure...');
  try {
    await context.sendActivity("📋 **Cargando templates disponibles...** ☁️");

    // 1) Obtener todos los templates públicos
    const allTemplates = await azureService.listarTemplatesPublicos();

    // 2) Determinar plan del tenant
    const tenantId = context.activity.channelData?.tenant?.id!;
    const plan     = await getPlan(tenantId);

    // 3) Niveles permitidos según plan
    let allowedLevels: string[];
    if (plan === 'free') {
      allowedLevels = ['free'];
    } else if (plan === 'pro') {
      allowedLevels = ['free', 'professional'];
    } else {
      allowedLevels = ['free', 'professional', 'enterprise'];
    }

    // 4) Filtrar templates según nivel
    const templatesPublicos = allTemplates.filter(t =>
      allowedLevels.includes(t.nivelPlan)
    );

    if (templatesPublicos.length === 0) {
      await context.sendActivity("❌ No hay templates disponibles para tu plan.");
      return;
    }

    // 5) Construir mensaje
    let mensaje = `📋 **Templates Disponibles (${templatesPublicos.length})** ☁️\n\n`;
    const categorias = Array.from(new Set(templatesPublicos.map(t => t.categoria)));
    categorias.forEach(categoria => {
      const templatesCat = templatesPublicos.filter(t => t.categoria === categoria);
      mensaje += `### 📂 **${categoria.toUpperCase()}**\n`;
      templatesCat.forEach(template => {
        const badge = template.nivelPlan === 'free' ? '🆓' :
                      template.nivelPlan === 'professional' ? '💼' : '🏢';
        const pop   = template.vecesUsado > 0 ? ` (${template.vecesUsado} usos)` : '';
        mensaje += `${badge} **${template.nombre}**${pop}\n`;
        mensaje += `   📝 ${template.descripcion}\n`;
        mensaje += `   🎯 ${template.objetivo}\n`;
        mensaje += `   🏷️ _${template.tags}_\n`;
        mensaje += `   ▶️ **Usar:** \`usar_template ${template.rowKey}\`\n\n`;
      });
    });
    mensaje += `💡 **Comandos disponibles:**\n`;
    mensaje += `• \`usar_template [id]\` - Crear encuesta desde template\n`;
    mensaje += `• \`buscar_templates [término]\` - Buscar templates específicos\n`;
    mensaje += `• \`crear_template\` - Crear tu propio template (Admin)\n\n`;
    mensaje += `🆓 Free | 💼 Professional | 🏢 Enterprise`;

    await context.sendActivity(mensaje);
    console.log(`✅ Mostrados ${templatesPublicos.length} templates`);

  } catch (error) {
    console.error('❌ Error listando templates:', error);
    await context.sendActivity("❌ Error al cargar templates desde Azure. Intenta nuevamente.");
  }
});


// COMANDO: Usar template específico
app.message(/^usar_template\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^usar_template\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`usar_template [id_template]`\n\nEjemplo: `usar_template clima_laboral_v1`\n\nUsa `ver_templates` para ver IDs disponibles.");
    return;
  }

  const templateId = match[1].trim();
  console.log(`🎯 Usuario quiere usar template: ${templateId}`);

  try {
    await context.sendActivity("🔍 **Buscando template...** ☁️");
    
    let template = await azureService.obtenerTemplate('TEMPLATE', templateId);
    
    if (!template) {
      await context.sendActivity(`❌ **Template no encontrado**: \`${templateId}\`\n\nUsa \`ver_templates\` para ver templates disponibles.`);
      return;
    }

    if (template.nivelPlan === 'enterprise') {
      await context.sendActivity(`🏢 **Template Enterprise**: "${template.nombre}"\n\nEste template requiere plan Enterprise. Contacta al administrador.\n\n💡 **Alternativamente**, puedes usar templates gratuitos con \`ver_templates\`.`);
      return;
    }

    const preguntas = JSON.parse(template.preguntas as string) as Pregunta[];

    let preview = `📋 **Template: ${template.nombre}** ☁️\n\n`;
    preview += `📂 **Categoría:** ${template.categoria}\n`;
    preview += `🎯 **Objetivo:** ${template.objetivo}\n`;
    preview += `📝 **Descripción:** ${template.descripcion}\n`;
    preview += `👤 **Creado por:** ${template.creador}\n`;
    preview += `📊 **Usado:** ${template.vecesUsado} veces\n\n`;
    
    preview += `**❓ Preguntas incluidas (${preguntas.length}):**\n\n`;
    preguntas.forEach((pregunta: Pregunta, index: number) => {
      preview += `**${index + 1}.** ${pregunta.pregunta}\n`;
      preview += `   📊 Opciones: ${pregunta.opciones.join(' | ')}\n\n`;
    });

    preview += `✅ **Para crear encuesta desde este template:**\n`;
    preview += `\`confirmar_template ${templateId}\`\n\n`;
    preview += `🔙 **Ver otros templates:** \`ver_templates\``;

    await context.sendActivity(preview);
    console.log(`✅ Template preview mostrado: ${template.nombre}`);

  } catch (error) {
    console.error('❌ Error obteniendo template:', error);
    await context.sendActivity("❌ Error al cargar el template desde Azure. Verifica el ID e intenta nuevamente.");
  }
});

// COMANDO: Confirmar y crear encuesta desde template
app.message(/^confirmar_template\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^confirmar_template\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`confirmar_template [id_template]`");
    return;
  }

  const templateId = match[1].trim();
  console.log(`✅ Confirmando creación desde template: ${templateId}`);

  try {
    await context.sendActivity("🚀 **Creando encuesta desde template...** ☁️");
    
    const template = await azureService.obtenerTemplate('TEMPLATE', templateId);
    
    if (!template) {
      await context.sendActivity(`❌ **Template no encontrado**: \`${templateId}\``);
      return;
    }

    await azureService.incrementarUsoTemplate('TEMPLATE', templateId);

    // 🔍 ENCONTRÁ esta línea (ya la tenés):
    const encuestaId = generarIdEncuesta(template.nombre);

    // ⬇️ Pegá inmediatamente DESPUÉS:
    const tenantId = context.activity.channelData?.tenant?.id;
    if (!tenantId || !(await canCreateSurvey(tenantId))) {
      await context.sendActivity(
        "🚫 Límite: 1 encuesta por semana en plan **Free**. Probá la semana próxima o actualizá a Pro."
      );
      return;
    }

    if (!(await canCreateSurvey(tenantId))) {
      await context.sendActivity("🚫 Alcanzaste el límite de 3 encuestas activas para el plan Free. Actualizá a Pro o Ent.");
      return;
    }
    // ──────────────────────────────────────────────────────────────────

    const preguntasConvertidas: Pregunta[] = (JSON.parse(template.preguntas as string) as any[]).map(p => ({
      pregunta: p.pregunta,
      opciones: p.opciones
    }));

    const nuevaEncuesta: Encuesta = {
      titulo: `${template.nombre} - ${new Date().toLocaleDateString()}`,
      objetivo: template.objetivo,
      preguntas: preguntasConvertidas,
      creador: context.activity.from.name || 'Usuario',
      id: encuestaId,
      fechaCreacion: new Date(),
      basadoEnTemplate: templateId
    };

    await guardarEncuestaEnAzure(nuevaEncuesta);
    await registerSurveyCreation(tenantId);   // registra 1 encuesta nueva
    
    const resultadosIniciales: ResultadosEncuesta = {
      encuestaId: encuestaId,
      titulo: nuevaEncuesta.titulo,
      fechaCreacion: new Date(),
      estado: 'activa',
      totalParticipantes: 0,
      respuestas: [],
      resumen: {}
    };
    
    await guardarResultadosAzure(resultadosIniciales);

    const exito = `🎉 **¡Encuesta creada desde template exitosamente!** ☁️

📋 **Encuesta Nueva:**
• **Título:** ${nuevaEncuesta.titulo}
• **ID:** \`${encuestaId}\`
• **Basada en:** ${template.nombre}
• **Preguntas:** ${nuevaEncuesta.preguntas.length}

**🎯 Comandos disponibles:**
• **Responder:** \`responder ${encuestaId}\`
• **Ver resultados:** \`resultados ${encuestaId}\`
• **Analizar:** \`analizar ${encuestaId}\`

**📋 Preguntas incluidas:**
${nuevaEncuesta.preguntas.map((p, i) => 
  `**${i + 1}.** ${p.pregunta}`
).join('\n')}

✅ **¡Lista para recibir respuestas!**`;

    await context.sendActivity(exito);
    console.log(`🎉 Encuesta creada desde template: ${template.nombre} → ${encuestaId}`);

  } catch (error) {
    console.error('❌ Error creando encuesta desde template:', error);
    await context.sendActivity("❌ Error al crear encuesta desde template. Intenta nuevamente.");
  }
});

// COMANDO: Buscar templates por término
app.message(/^buscar_templates\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^buscar_templates\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`buscar_templates [término]`\n\nEjemplo: `buscar_templates clima` o `buscar_templates hr`");
    return;
  }

  const termino = match[1].trim();
  console.log(`🔍 Buscando templates con término: ${termino}`);

  try {
    await context.sendActivity(`🔍 **Buscando templates con "${termino}"...** ☁️`);
    
    const templatesEncontrados = await azureService.buscarTemplates(termino);
    
    if (templatesEncontrados.length === 0) {
      await context.sendActivity(`🔍 **No se encontraron templates con "${termino}"**\n\n💡 **Sugerencias:**\n• Intenta términos como: "clima", "cliente", "capacitacion", "hr"\n• Usa \`ver_templates\` para ver todos los disponibles`);
      return;
    }

    let mensaje = `🔍 **Resultados para "${termino}" (${templatesEncontrados.length})** ☁️\n\n`;

    templatesEncontrados.forEach(template => {
      const planBadge = template.nivelPlan === 'free' ? '🆓' : 
                       template.nivelPlan === 'professional' ? '💼' : '🏢';
      const popularidad = template.vecesUsado > 0 ? ` (${template.vecesUsado} usos)` : '';
      
      mensaje += `${planBadge} **${template.nombre}**${popularidad}\n`;
      mensaje += `   📂 ${template.categoria} | 📝 ${template.descripcion}\n`;
      mensaje += `   ▶️ **Usar:** \`usar_template ${template.rowKey}\`\n\n`;
    });

    mensaje += `💡 **Para ver detalles:** \`usar_template [id]\`\n`;
    mensaje += `📋 **Ver todos:** \`ver_templates\``;

    await context.sendActivity(mensaje);
    console.log(`✅ Encontrados ${templatesEncontrados.length} templates para: ${termino}`);

  } catch (error) {
    console.error('❌ Error buscando templates:', error);
    await context.sendActivity("❌ Error al buscar templates. Intenta nuevamente.");
  }
});


// ============================
// MANEJO DE ERRORES
// ============================

app.feedbackLoop(async (context, state, feedbackLoopData) => {
  console.log("📢 Feedback recibido:", JSON.stringify(feedbackLoopData, null, 2));
});

app.error(async (context, error) => {
  console.error(`💥 Error de aplicación:`, error);
  await context.sendActivity("❌ Ocurrió un error inesperado. Por favor, intenta nuevamente.");
});


// ============================
// FUNCIÓN PARA CREAR CARD DE LISTA DE ENCUESTAS
// ============================

async function createListSurveysCardAsync(encuestas: Encuesta[], userId?: string): Promise<any> {
  const card: any = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard", 
    "version": "1.4",
    "body": [
      {
        "type": "Container",
        "style": "emphasis",
        "items": [
          {
            "type": "TextBlock",
            "text": "🎯 TeamPulse",
            "weight": "Bolder",
            "size": "Medium", 
            "color": "Accent"
          },
          {
            "type": "TextBlock",
            "text": "Encuestas Disponibles",
            "size": "Large",
            "weight": "Bolder"
          },
          {
            "type": "TextBlock",
            "text": `📋 ${encuestas.length} encuestas encontradas`,
            "size": "Medium",
            "weight": "Bolder"
          }
        ]
      }
    ],
    "actions": []
  };

  if (encuestas.length === 0) {
    card.body.push({
      "type": "TextBlock",
      "text": "🔔 No hay encuestas disponibles. Crea tu primera encuesta escribiendo: Quiero crear una encuesta",
      "size": "Medium",
      "weight": "Bolder"
    });
    return CardFactory.adaptiveCard(card);
  }

  // 🆕 Procesar cada encuesta con estado del usuario
  for (const encuesta of encuestas.slice(0, 5)) {
    const fecha = encuesta.fechaCreacion
      ? new Date(encuesta.fechaCreacion).toLocaleDateString('es-ES', {
          weekday: 'long',
          year: 'numeric', 
          month: 'long',
          day: 'numeric'
        })
      : 'Fecha no disponible';

    // 🆕 Verificar si el usuario ya respondió
    let hasResponded = false;
    if (userId) {
      try {
        hasResponded = await azureService.checkUserResponse(encuesta.id!, userId);
      } catch (error) {
        console.error('⚠️ Error checking user response:', error);
      }
    }

    // 🆕 Obtener estado y textos dinámicos
    const accessInfo = validateSurveyAccess(encuesta, hasResponded);
    
    let estadoTexto = '🔴 Sin respuestas';
    try {
      const respuestas = await azureService.cargarRespuestasEncuesta(encuesta.id!);
      const participantesUnicos = new Set(respuestas.map(r => r.participanteId));
      const numParticipantes = participantesUnicos.size;
      if (numParticipantes > 0) {
        estadoTexto = `🟢 ${numParticipantes} ${numParticipantes === 1 ? 'respuesta' : 'respuestas'}`;
      }
    } catch (error) {
      console.error('⚠️ Error al obtener respuestas para encuesta:', encuesta.id, error);
      estadoTexto = '⚠️ Error al cargar estado';
    }

    card.body.push({
      "type": "Container",
      "style": "emphasis",
      "spacing": "Medium",
      "items": [
        {
          "type": "TextBlock",
          "text": encuesta.titulo || "Sin título",
          "weight": "Bolder",
          "size": "Medium"
        },
        {
          "type": "TextBlock", 
          "text": `🎯 ${encuesta.objetivo || "Sin objetivo"}`,
          "size": "Small",
          "wrap": true
        },
        {
          "type": "TextBlock", 
          "text": `ID de la encuesta: ${encuesta.id}`,
          "size": "Small",
          "wrap": true
        },
        {
          "type": "ColumnSet",
          "columns": [
            {
              "type": "Column",
              "width": "stretch",
              "items": [
                {
                  "type": "TextBlock",
                  "text": `🗓️ ${fecha}`,
                  "size": "Small",
                  "color": "Good"
                }
              ]
            },
            {
              "type": "Column", 
              "width": "auto",
              "items": [
                {
                  "type": "TextBlock",
                  "text": `${accessInfo.statusIcon} ${accessInfo.statusText}`,
                  "size": "Small",
                  "weight": "Bolder",
                  "horizontalAlignment": "Right"
                }
              ]
            }
          ]
        },
        {
          "type": "TextBlock",
          "text": estadoTexto,
          "size": "Small",
          "color": "Accent"
        },
        {
          "type": "ActionSet",
          "actions": [
            // 🆕 Botón dinámico según estado
            accessInfo.status !== 'survey_closed' ? {
              "type": "Action.Submit",
              "title": `${accessInfo.buttonIcon} ${accessInfo.buttonText}`,
              "data": {
                "verb": "start_survey",
                "encuestaId": encuesta.id,
                "titulo": encuesta.titulo
              }
            } : {
              "type": "Action.Submit", 
              "title": `${accessInfo.buttonIcon} ${accessInfo.buttonText}`,
              "data": {
                "verb": "survey_closed_info",
                "encuestaId": encuesta.id
              }
            },
            {
              "type": "Action.Submit",
              "title": "📊 Ver Resultados", 
              "data": {
                "verb": "view_survey_results",
                "encuestaId": encuesta.id,
                "titulo": encuesta.titulo
              }
            }
          ]
        }
      ]
    });
  }

  if (encuestas.length > 5) {
    card.body.push({
      "type": "TextBlock",
      "text": `... y ${encuestas.length - 5} encuestas más.`,
      "size": "Small",
      "weight": "Bolder"
    });
  }

  card.body.push({
    "type": "ActionSet",
    "actions": [
      {
        "type": "Action.Submit",
        "title": "➕ Crear Nueva Encuesta",
        "data": {
          "verb": "create_new_survey"
        }
      }
    ]
  });

  return CardFactory.adaptiveCard(card);
}

// ============================
// FUNCIÓN PARA CREAR CARD DE BIENVENIDA
// ============================
function createWelcomeCard(): any {
  const card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
      {
        "type": "TextBlock",
        "text": "👋 ¡Bienvenido a TeamPulse!",
        "weight": "Bolder",
        "size": "Large"
      },
      {
        "type": "TextBlock",
        "text": "¿Qué te gustaría hacer?",
        "wrap": true,
        "spacing": "Medium"
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "➕ Crear Encuesta",
        "data": { "verb": "create_new_survey" }
      },
      {
        "type": "Action.Submit",
        "title": "📋 Ver Encuestas",
        "data": { "verb": "list_surveys" }
      },
      {
        "type": "Action.Submit",
        "title": "📘 Ver Comandos",
        "data": { "verb": "show_commands" }
    },
    {
      "type": "Action.Submit",
      "title": "❓ Ayuda",
      "data": { "verb": "show_help" }
    }
  ]
};

  return CardFactory.adaptiveCard(card);
}

function createSurveyIdInputCard(): any {
  const card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
      {
        "type": "TextBlock",
        "text": "📝 Responder una Encuesta",
        "weight": "Bolder",
        "size": "Large"
      },
      {
        "type": "TextBlock",
        "text": "Ingresa el ID de la encuesta que deseas responder:",
        "wrap": true
      },
      {
        "type": "Input.Text",
        "id": "encuestaId",
        "placeholder": "Ejemplo: clima_123456_abcd"
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "Responder Encuesta",
        "data": {
          "verb": "start_survey_by_id"
        }
      }
    ]
  };

  return CardFactory.adaptiveCard(card);
}
// ============================
// FUNCIÓN PARA CREAR CARD DE COMANDOS DISPONIBLES
// ============================
function createAvailableCommandsCard(): any {
  const card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
      {
        "type": "TextBlock",
        "text": "📘 Comandos Disponibles",
        "weight": "Bolder",
        "size": "Large"
      },
      {
        "type": "TextBlock",
        "text": "Usá estos comandos en TeamPulse:",
        "wrap": true
      },

      /* ──────── CREACIÓN ──────── */
      {
        "type": "TextBlock",
        "text": "📝 **Creación de Encuestas**",
        "weight": "Bolder",
        "size": "Medium",
        "spacing": "Medium"
      },
      {
        "type": "FactSet",
        "facts": [
          { "title": "`crear encuesta`",     "value": "Asistente paso a paso" },
          { "title": "`usar_template [ID]`", "value": "Nueva encuesta desde template" },
          { "title": "`confirmar_template [ID]`", "value": "Confirmar creación" }
        ]
      },

      /* ──────── TEMPLATES ──────── */
      {
        "type": "TextBlock",
        "text": "📂 **Gestión de Templates**",
        "weight": "Bolder",
        "size": "Medium",
        "spacing": "Medium"
      },
      {
        "type": "FactSet",
        "facts": [
          { "title": "`ver_templates`",            "value": "Listar todas las plantillas" },
          { "title": "`buscar_templates [texto]`", "value": "Filtrar templates" },
          { "title": "`seed_templates`",           "value": "(Admin) cargar ejemplos" }
        ]
      },

      /* ──────── RESULTADOS ──────── */
      {
        "type": "TextBlock",
        "text": "📊 **Resultados y Análisis**",
        "weight": "Bolder",
        "size": "Medium",
        "spacing": "Medium"
      },
      {
        "type": "FactSet",
        "facts": [
          { "title": "`responder [ID]`",  "value": "Responder encuesta" },
          { "title": "`resultados [ID]`", "value": "Ver resultados en vivo" },
          { "title": "`analizar [ID]`",   "value": "Insights IA (Planes Pro/Enterprise)" },
          { "title": "`exportar [ID]`",   "value": "Descargar Excel/CSV (Planes Pro/Enterprise)" }
        ]
      },

      /* ──────── PLANES ──────── */
      {
        "type": "TextBlock",
        "text": "🔐 **Planes y Cuenta**",
        "weight": "Bolder",
        "size": "Medium",
        "spacing": "Medium"
      },
      {
        "type": "FactSet",
        "facts": [
          { "title": "`plan_info`", "value": "Ver uso y límites actuales" },
          { "title": "`mi_plan`",   "value": "Detalles de tu suscripción" }
        ]
      },

      /* ──────── OTROS ──────── */
      {
        "type": "TextBlock",
        "text": "ℹ️ **Otros Comandos**",
        "weight": "Bolder",
        "size": "Medium",
        "spacing": "Medium"
      },
      {
        "type": "FactSet",
        "facts": [
          { "title": "`listar`", "value": "Todas tus encuestas" },
          { "title": "`debug_cards`", "value": "Probar tarjetas Adaptive" },
          { "title": "`reportar {texto del mensaje}`", "value": "Reportar contenido objetable" },          
          { "title": "`ayuda` / `help`", "value": "Mostrar este menú" }
        ]
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "🔙 Menú Principal",
        "data": { "verb": "show_help" }
      }
    ]
  };

  return CardFactory.adaptiveCard(card);
}

// Función para crear la tarjeta de análisis
function createAnalysisCard(analisis: EncuestaAnalisis, encuesta: any, resultados: any): any {
  const participantes = resultados.totalParticipantes || 0;
  
  // Elegir el emoji de sentimiento
  const sentimientoEmoji = 
    analisis.sentimiento === "positivo" ? "🟢" :
    analisis.sentimiento === "negativo" ? "🔴" : "🟡";
  
  // Crear la tarjeta
  const card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
      {
        "type": "Container",
        "style": "emphasis",
        "items": [
          {
            "type": "ColumnSet",
            "columns": [
              {
                "type": "Column",
                "width": "stretch",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": "🧠 Análisis de IA",
                    "weight": "Bolder",
                    "size": "Medium",
                    "color": "Accent"
                  },
                  {
                    "type": "TextBlock",
                    "text": analisis.titulo,
                    "size": "Medium",
                    "weight": "Bolder"
                  }
                ]
              },
              {
                "type": "Column",
                "width": "auto",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": `👥 ${participantes}`,
                    "weight": "Bolder",
                    "horizontalAlignment": "Right"
                  },
                  {
                    "type": "TextBlock",
                    "text": "participantes",
                    "horizontalAlignment": "Right"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "Container",
        "style": "default",
        "items": [
          {
            "type": "TextBlock",
            "text": "📝 **Resumen Ejecutivo**",
            "weight": "Bolder",
            "size": "Medium",
            "color": "Accent"
          },
          {
            "type": "TextBlock",
            "text": analisis.resumen,
            "wrap": true
          }
        ]
      },
      {
        "type": "Container",
        "style": "emphasis",
        "items": [
          {
            "type": "ColumnSet",
            "columns": [
              {
                "type": "Column",
                "width": "stretch",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": "Sentimiento general",
                    "weight": "Bolder"
                  },
                  {
                    "type": "TextBlock",
                    "text": `${sentimientoEmoji} ${analisis.sentimiento.toUpperCase()}`
                  }
                ]
              },
              {
                "type": "Column",
                "width": "auto",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": analisis.puntuacionNPS ? "Puntuación NPS" : " ",
                    "weight": "Bolder"
                  },
                  {
                    "type": "TextBlock",
                    "text": analisis.puntuacionNPS ? `${analisis.puntuacionNPS}` : " "
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "Container",
        "style": "default",
        "items": [
          {
            "type": "TextBlock",
            "text": "🔍 **Insights Clave**",
            "weight": "Bolder",
            "size": "Medium",
            "color": "Accent"
          },
          {
            "type": "TextBlock",
            "text": analisis.insights.general,
            "wrap": true
          }
        ]
      },
      {
        "type": "Container",
        "style": "emphasis",
        "items": [
          {
            "type": "TextBlock",
            "text": "📈 **Tendencias Identificadas**",
            "weight": "Bolder",
            "size": "Medium",
            "color": "Accent"
          },
          {
            "type": "FactSet",
            "facts": analisis.insights.tendencias.map((t: string, i: number) => ({
              "title": `${i + 1}.`,
              "value": t
            }))
          }
        ]
      },
      {
        "type": "Container",
        "style": "default",
        "items": [
          {
            "type": "TextBlock",
            "text": "🎯 **Recomendaciones**",
            "weight": "Bolder",
            "size": "Medium",
            "color": "Accent"
          },
          {
            "type": "FactSet",
            "facts": analisis.insights.recomendaciones.map((r: string, i: number) => ({
              "title": `${i + 1}.`,
              "value": r
            }))
          }
        ]
      },
      {
        "type": "TextBlock",
        "text": `Última actualización: ${new Date(analisis.ultimaActualizacion).toLocaleString()}`,
        "size": "Small",
        "isSubtle": true
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "📋 Ver Todas las Encuestas",
        "data": {
          "verb": "list_surveys"
        }
      },
      {
        "type": "Action.Submit",
        "title": "📊 Ver Resultados",
        "data": {
          "verb": "view_survey_results",
          "encuestaId": encuesta.id,
          "titulo": encuesta.titulo
        }
      }
    ]
  };

  return CardFactory.adaptiveCard(card);
}

export default app;