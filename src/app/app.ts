// 🧹 APP.TS LIMPIO - Solo código que funciona
//
// INSTRUCCIONES: REEMPLAZAR todo el contenido de src/app/app.ts con esto

import { MemoryStorage, CardFactory, MessageFactory, TurnContext } from "botbuilder";
import * as path from "path";
import config from "../config";
import { AzureTableService } from "../services/azureTableService";

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

// ============================
// ADAPTIVE CARDS HANDLERS (MÉTODO CORRECTO)
// ============================

// handler para mostrar comandos disponibles
app.adaptiveCards.actionSubmit('show_commands', async (context, state, data) => {
  const card = createAvailableCommandsCard();
  await context.sendActivity(MessageFactory.attachment(card));
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
    const encuestas = await listarEncuestasAzure();
    
    const listCard = await createListSurveysCardAsync(encuestas);
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
    await context.sendActivity(MessageFactory.attachment(resultsCard));

  } catch (error) {
    console.error('❌ Error mostrando resultados:', error);
    await context.sendActivity("❌ Error al cargar resultados");
  }
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
  const data = userId + encuestaId + "salt_secreto";
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `anon_${Math.abs(hash).toString(36)}`;
}

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

async function listarEncuestasAzure(): Promise<Encuesta[]> {
  try {
    return await azureService.listarEncuestas();
  } catch (error) {
    console.error('❌ Error listando encuestas desde Azure:', error);
    return [];
  }
}

async function guardarRespuestaIndividualAzure(
  encuestaId: string, 
  userId: string, 
  preguntaIndex: number, 
  respuesta: string, 
  preguntaTexto: string
): Promise<void> {
  try {
    const participanteAnonimo = crearParticipanteAnonimo(userId, encuestaId);
    await azureService.guardarRespuesta(encuestaId, participanteAnonimo, preguntaIndex, respuesta);
    await actualizarResultadosConsolidados(encuestaId);
  } catch (error) {
    console.error('❌ Error al guardar respuesta en Azure:', error);
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
    
    const encuesta: Encuesta = {
      titulo: titulo.trim(),
      objetivo: objetivo.trim(),
      preguntas,
      creador: context.activity.from.name || 'Usuario desconocido',
      id: encuestaId,
      fechaCreacion: new Date(),
    };

    await guardarEncuestaEnAzure(encuesta);
    
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

  const encuestas = await listarEncuestasAzure();

  const coincidencias = encuestas.filter(e =>
    keywords.some(k =>
      (typeof e.titulo === 'string' && e.titulo.toLowerCase().includes(k)) ||
      (typeof e.objetivo === 'string' && e.objetivo.toLowerCase().includes(k))
    )
  );

  if (coincidencias.length === 0) {
    await context.sendActivity("🔍 No se encontraron encuestas que coincidan con esas palabras.");
  } else {
    const card = await createListSurveysCardAsync(coincidencias);
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

  const encuestas = await listarEncuestasAzure();
  const coincidencia = encuestas.find(e =>
    typeof e.titulo === 'string' && e.titulo.toLowerCase().includes(titulo)
  );

  if (!coincidencia) {
    await context.sendActivity(`🔍 No se encontró ninguna encuesta con el título que contenga: "${titulo}"`);
  } else {
    const card = createSurveyResponseCard(coincidencia, 0);
    await context.sendActivity(MessageFactory.attachment(card));
  }

  return 'responder_por_nombre';
});


// ============================
// COMANDOS DE TEXTO
// ============================

// COMANDO RESPONDER
app.message(/^responder\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^responder\s+(.+)$/i);
  const encuestaId = match[1].trim();
  
  try {
    const encuestaEncontrada = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaEncontrada) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    const responseCard = createSurveyResponseCard(encuestaEncontrada, 0);
    await context.sendActivity(MessageFactory.attachment(responseCard));

  } catch (error) {
    console.error('❌ Error al mostrar encuesta:', error);
    await context.sendActivity("❌ Error al cargar la encuesta. Verifica que el ID sea correcto.");
  }
});

// COMANDO LISTAR
app.message(/^listar$/i, async (context, state) => {
  try {
    const encuestas = await listarEncuestasAzure();
    
    const listCard = await createListSurveysCardAsync(encuestas);
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
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\`

💡 **Tip**: Usa \`listar\` para ver todas las encuestas disponibles.`);
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
    await context.sendActivity(MessageFactory.attachment(resultsCard));

  } catch (error) {
    console.error('❌ Error mostrando resultados:', error);
    await context.sendActivity("❌ Error al cargar resultados. Intenta nuevamente.");
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

// COMANDO AYUDA
app.message(/^ayuda$/i, async (context, state) => {
  const welcomeCard = createWelcomeCard();
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

async function createListSurveysCardAsync(encuestas: Encuesta[]): Promise<any> {
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

  for (const encuesta of encuestas.slice(0, 5)) {
    const fecha = encuesta.fechaCreacion
      ? new Date(encuesta.fechaCreacion).toLocaleDateString('es-ES', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : 'Fecha no disponible';

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
          "text": `🗓️ ${fecha} | ${estadoTexto}`,
          "size": "Small",
          "color": "Good"
        },
        {
          "type": "ActionSet",
          "actions": [
            {
              "type": "Action.Submit",
              "title": "📝 Responder",
              "data": {
                "verb": "start_survey",
                "encuestaId": encuesta.id,
                "titulo": encuesta.titulo
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
        "text": "Estos son los comandos que puedes usar en TeamPulse:",
        "wrap": true
      },
      {
        "type": "FactSet",
        "facts": [
          { "title": "`responder [ID]`", "value": "Responder una encuesta por ID" },
          { "title": "`listar`", "value": "Ver todas las encuestas disponibles" },
          { "title": "`resultados [ID]`", "value": "Ver resultados de una encuesta" },
          { "title": "`debug_cards`", "value": "Probar tarjetas Adaptive" },
          { "title": "`ayuda`", "value": "Mostrar ayuda general" }
        ]
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "🔙 Volver al Menú Principal",
        "data": { "verb": "show_welcome" }
      }
    ]
  };

  return CardFactory.adaptiveCard(card);
}



export default app;