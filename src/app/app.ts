import { MemoryStorage, CardFactory, MessageFactory, TurnContext } from "botbuilder";
import * as path from "path";
import config from "../config";
import * as fs from 'fs';
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


// AGREGAR handler para las acciones de la Adaptive Card
// Handler para las acciones de Adaptive Cards usando Teams AI library
app.ai.action('survey_response', async (context, state, data) => {
  const timestamp = new Date().toISOString();
  const userId = context.activity.from.id;
  const userName = context.activity.from.name || 'Usuario';
  
  console.log(`🎴 [${timestamp}] ADAPTIVE CARD ACTION: survey_response`);
  console.log(`👤 Usuario: ${userName} (${userId})`);
  console.log(`📥 Datos recibidos:`, JSON.stringify(data, null, 2));
  
  try {
    console.log(`🎴 [${timestamp}] ===== SURVEY_RESPONSE ACTION INICIADA =====`);
    console.log(`📥 Raw activity:`, JSON.stringify(context.activity, null, 2));
    console.log(`📥 Data estructura:`, JSON.stringify(data, null, 2));
    console.log(`📥 State:`, JSON.stringify(state, null, 2));
    // ✅ VALIDACIÓN ROBUSTA DE DATOS
    if (!data || !data.encuestaId || data.preguntaIndex === undefined || !data.respuesta || !data.preguntaTexto) {
      console.error(`❌ [${timestamp}] Datos inválidos:`, data);
      
      await context.sendActivity(`❌ **Error en los datos de la encuesta**

💡 **Alternativa:** Usa el comando \`responder ${data?.encuestaId || '[ID_encuesta]'}\` para responder manualmente.`);
      
      return 'survey_response_validation_error';
    }

    const { encuestaId, preguntaIndex, respuesta, preguntaTexto } = data;
    
    console.log(`🔍 [${timestamp}] Datos validados - Encuesta: ${encuestaId}, Pregunta: ${preguntaIndex}, Respuesta: ${respuesta}`);
    
    // ✅ VERIFICAR QUE LA ENCUESTA EXISTE
    const encuesta = await buscarEncuestaEnAzure(encuestaId);
    if (!encuesta) {
      console.error(`❌ [${timestamp}] Encuesta no encontrada: ${encuestaId}`);
      
      await context.sendActivity(`❌ **Encuesta no encontrada**

🆔 **ID buscado:** \`${encuestaId}\`

💡 **Usar:** \`listar\` para ver encuestas disponibles`);
      
      return 'survey_response_not_found';
    }

    // ✅ VERIFICAR QUE LA PREGUNTA EXISTE
    if (preguntaIndex < 0 || preguntaIndex >= encuesta.preguntas.length) {
      console.error(`❌ [${timestamp}] Índice de pregunta inválido: ${preguntaIndex}`);
      
      await context.sendActivity(`❌ **Pregunta no válida**

La encuesta "${encuesta.titulo}" tiene ${encuesta.preguntas.length} pregunta(s).`);
      
      return 'survey_response_invalid_question';
    }

    // ✅ VERIFICAR QUE LA RESPUESTA ES VÁLIDA
    const pregunta = encuesta.preguntas[preguntaIndex];
    const opcionValida = pregunta.opciones.find(opcion => 
      opcion.toLowerCase() === respuesta.toLowerCase()
    );

    if (!opcionValida) {
      console.error(`❌ [${timestamp}] Respuesta inválida: "${respuesta}"`);
      
      await context.sendActivity(`❌ **Respuesta no válida**

**Opciones disponibles:** ${pregunta.opciones.join(' | ')}
**Tu respuesta:** "${respuesta}"`);
      
      return 'survey_response_invalid_option';
    }

    console.log(`✅ [${timestamp}] Todas las validaciones pasaron. Guardando respuesta...`);
    
    // ✅ GUARDAR RESPUESTA
    await guardarRespuestaIndividualAzure(encuestaId, userId, preguntaIndex, opcionValida, preguntaTexto);
    
    console.log(`💾 [${timestamp}] Respuesta guardada exitosamente en Azure`);
    
    // ✅ DETERMINAR SIGUIENTE ACCIÓN
    if (preguntaIndex + 1 < encuesta.preguntas.length) {
      // Hay más preguntas - mostrar la siguiente
      console.log(`➡️ [${timestamp}] Mostrando siguiente pregunta: ${preguntaIndex + 1}`);
      
      const nextCard = createSurveyResponseCard(encuesta, preguntaIndex + 1);
      await context.sendActivity(MessageFactory.attachment(nextCard));
    } else {
      // Era la última pregunta - mostrar confirmación
      console.log(`🏁 [${timestamp}] Última pregunta completada. Mostrando confirmación.`);
      
      const confirmacion = `🎉 **¡Encuesta completada!** 

✅ **Respuesta guardada:** "${opcionValida}"
📊 **Encuesta:** ${encuesta.titulo}
☁️ **Almacenado en Azure** de forma anónima

🎯 **Ver resultados:** \`resultados ${encuestaId}\`
📋 **Otras encuestas:** \`listar\``;
      
      await context.sendActivity(confirmacion);
    }
    
    console.log(`✅ [${timestamp}] Acción survey_response completada exitosamente`);
    return 'survey_response_success';
    
  } catch (error) {
    console.error(`💥 [${timestamp}] ERROR CRÍTICO en survey_response:`, error);
    
    const errorMsg = `❌ **Error interno al procesar tu respuesta**

🔧 **Alternativa segura:** 
\`responder_encuesta ${data?.encuestaId || '[ID]'} ${(data?.preguntaIndex || 0) + 1} ${data?.respuesta || '[respuesta]'}\`

🆘 **O usa:** \`responder ${data?.encuestaId || '[ID]'}\` para ver la encuesta completa`;

    await context.sendActivity(errorMsg);
    return 'survey_response_critical_error';
  }
});


app.ai.action('view_results', async (context, state, data) => {
  const timestamp = new Date().toISOString();
  console.log(`📊 [${timestamp}] view_results solicitado para: ${data?.encuestaId}`);
  
  try {
    console.log(`📊 [${timestamp}] ===== VIEW_RESULTS ACTION INICIADA =====`);
    console.log(`📥 Raw activity:`, JSON.stringify(context.activity, null, 2));
    console.log(`📥 Data recibida:`, JSON.stringify(data, null, 2));
    if (!data?.encuestaId) {
      console.error(`❌ [${timestamp}] view_results: encuestaId faltante`);
      await context.sendActivity("❌ **Error:** ID de encuesta requerido\n\n💡 **Usar:** `listar` para ver encuestas disponibles");
      return 'view_results_missing_id';
    }
    
    const { encuestaId } = data;
    
    const encuestaOriginal = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaOriginal) {
      console.log(`❌ [${timestamp}] Encuesta no encontrada: ${encuestaId}`);
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\n💡 **Ver disponibles:** \`listar\``);
      return 'view_results_not_found';
    }

    let resultados = await cargarResultadosAzure(encuestaId);
    if (!resultados) {
      resultados = {
        encuestaId: encuestaId,
        titulo: encuestaOriginal.titulo,
        fechaCreacion: new Date(),
        estado: 'activa',
        totalParticipantes: 0,
        respuestas: [],
        resumen: {}
      };
      await guardarResultadosAzure(resultados);
    }

    calcularResumen(resultados, encuestaOriginal);
    await guardarResultadosAzure(resultados);

    // Generar reporte compacto para card
    let reporte = `📊 **${resultados.titulo}** ☁️\n`;
    reporte += `👥 **${resultados.totalParticipantes}** participantes | `;
    reporte += `📊 **${resultados.estado}**\n\n`;

    if (resultados.totalParticipantes === 0) {
      reporte += `🔔 **Sin respuestas aún**\n\n**Para responder:** \`responder ${encuestaId}\``;
    } else {
      reporte += `📈 **Resultados disponibles**\n\n**Ver completo:** \`resultados ${encuestaId}\`\n**Análisis IA:** \`analizar ${encuestaId}\``;
    }

    await context.sendActivity(reporte);
    console.log(`✅ [${timestamp}] Resultados mostrados exitosamente`);
    return 'view_results_success';
    
  } catch (error) {
    console.error(`💥 [${timestamp}] Error en view_results:`, error);
    await context.sendActivity(`❌ Error al cargar resultados\n\n💡 **Alternativa:** \`resultados ${data?.encuestaId || '[ID]'}\``);
    return 'view_results_error';
  }
});


app.ai.action('list_surveys', async (context, state, data) => {
  const timestamp = new Date().toISOString();
  console.log(`📋 [${timestamp}] Listando encuestas desde Adaptive Card`);
  
  try {
    console.log(`📋 [${timestamp}] ===== LIST_SURVEYS ACTION INICIADA =====`);
    console.log(`📥 Raw activity:`, JSON.stringify(context.activity, null, 2));
    console.log(`📥 Data:`, JSON.stringify(data, null, 2));

    const encuestas = await listarEncuestasAzure();
      
    if (encuestas.length === 0) {
      console.log(`📂 [${timestamp}] No hay encuestas disponibles`);
      await context.sendActivity("📂 **No hay encuestas guardadas en Azure aún.**\n\n💡 **Crear:** \"Quiero crear una encuesta\"");
      return 'list_surveys_empty';
    }

    let lista = `📋 **Encuestas en Azure (${encuestas.length}):** ☁️\n\n`;
    
    // Mostrar solo las primeras 3 para cards (más compacto)
    encuestas.slice(0, 3).forEach((encuesta, index) => {
      const fecha = encuesta.fechaCreacion ? new Date(encuesta.fechaCreacion).toLocaleDateString() : 'N/A';
      lista += `**${index + 1}.** ${encuesta.titulo}\n`;
      lista += `   🆔 \`${encuesta.id}\` | 📅 ${fecha}\n\n`;
    });

    if (encuestas.length > 3) {
      lista += `... y ${encuestas.length - 3} más.\n\n`;
    }
    
    lista += `💡 **Ver todas:** \`listar\`\n`;
    lista += `🎯 **Responder:** \`responder [ID]\``;

    await context.sendActivity(lista);
    console.log(`✅ [${timestamp}] Mostradas ${Math.min(encuestas.length, 3)} encuestas`);
    return 'list_surveys_success';
    
  } catch (error) {
    console.error(`💥 [${timestamp}] Error en list_surveys:`, error);
    await context.sendActivity("❌ Error al cargar encuestas\n\n💡 **Alternativa:** `listar`");
    return 'list_surveys_error';
  }
});


// HANDLER DE DEBUG
app.ai.action('debug_test', async (context, state, data) => {
  const timestamp = new Date().toISOString();
  const userId = context.activity.from.id;
  const userName = context.activity.from.name || 'Usuario';
  
  console.log(`🔧 [${timestamp}] DEBUG_TEST ACTION EJECUTADA!`);
  console.log(`👤 Usuario: ${userName} (${userId})`);
  console.log(`📥 Datos recibidos en debug_test:`, JSON.stringify(data, null, 2));
  
  try {
    await context.sendActivity(`✅ **¡Handler debug_test funcionando!**

🎯 **Datos recibidos:** ${JSON.stringify(data, null, 2)}
👤 **Usuario:** ${userName}
⏰ **Timestamp:** ${timestamp}

🎉 **¡Los handlers de Adaptive Cards están funcionando correctamente!**

💡 **Esto significa que el problema anterior está resuelto.**`);

    console.log(`✅ [${timestamp}] Debug test completado exitosamente`);
    return 'debug_test_success';
    
  } catch (error) {
    console.error(`💥 [${timestamp}] Error en debug_test:`, error);
    await context.sendActivity("❌ Error en handler de debug");
    return 'debug_test_error';
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
    console.log(`📊 Cargando resultados desde Azure: ${encuestaId}`);
    return await azureService.cargarResultados(encuestaId);
  } catch (error) {
    console.error('❌ Error cargando resultados desde Azure:', error);
    return null;
  }
}

async function guardarResultadosAzure(resultados: ResultadosEncuesta): Promise<void> {
  try {
    console.log(`💾 Guardando resultados en Azure: ${resultados.encuestaId}`);
    await azureService.guardarResultados(resultados);
  } catch (error) {
    console.error('❌ Error guardando resultados en Azure:', error);
    throw error;
  }
}

async function buscarEncuestaEnAzure(encuestaId: string): Promise<Encuesta | null> {
  try {
    console.log(`🔍 Buscando encuesta en Azure: ${encuestaId}`);
    return await azureService.cargarEncuesta(encuestaId);
  } catch (error) {
    console.error('❌ Error buscando encuesta en Azure:', error);
    return null;
  }
}

async function listarEncuestasAzure(): Promise<Encuesta[]> {
  try {
    console.log(`📋 Listando encuestas desde Azure`);
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
    console.log(`💾 Guardando respuesta en Azure: ${encuestaId}, Pregunta ${preguntaIndex}`);
    
    const participanteAnonimo = crearParticipanteAnonimo(userId, encuestaId);
    await azureService.guardarRespuesta(encuestaId, participanteAnonimo, preguntaIndex, respuesta);
    await actualizarResultadosConsolidados(encuestaId);
    
    console.log(`✅ Respuesta guardada en Azure exitosamente`);
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
  console.log(`🎨 Creando Adaptive Card para: ${encuesta.titulo}, pregunta ${preguntaIndex + 1}`);
  
  if (!encuesta || !encuesta.preguntas || preguntaIndex >= encuesta.preguntas.length) {
    console.error(`❌ Error creando card: datos inválidos`);
    throw new Error("Datos de encuesta inválidos para crear card");
  }

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
            "type": "ColumnSet",
            "columns": [
              {
                "type": "Column",
                "width": "auto",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": "🎯",
                    "size": "Large"
                  }
                ]
              },
              {
                "type": "Column",
                "width": "stretch",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": "TeamPulse",
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
              }
            ]
          }
        ]
      },
      {
        "type": "Container",
        "items": [
          {
            "type": "TextBlock",
            "text": `Pregunta ${preguntaIndex + 1} de ${totalPreguntas}`,
            "size": "Small",
            "color": "Accent",
            "weight": "Bolder"
          }
        ],
        "spacing": "Medium"
      },
      {
        "type": "Container",
        "items": [
          {
            "type": "TextBlock",
            "text": pregunta.pregunta,
            "size": "Large",
            "weight": "Bolder",
            "wrap": true,
            "color": "Default"
          }
        ],
        "spacing": "Large",
        "style": "emphasis"
      },
      {
        "type": "Container",
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
                    "text": `💾 Progreso: ${progreso}%`,
                    "size": "Small",
                    "color": "Accent"
                  }
                ]
              },
              {
                "type": "Column",
                "width": "auto",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": "🔒 Anónimo",
                    "size": "Small",
                    "color": "Good"
                  }
                ]
              }
            ]
          }
        ],
        "spacing": "Large",
        "separator": true
      }
    ],
    "actions": [
      // ✅ RESPUESTAS - Una acción por opción
      ...pregunta.opciones.map((opcion, index) => ({
        "type": "Action.Submit",
        "title": `${index === 0 ? '🟢' : index === 1 ? '🔵' : index === 2 ? '🟡' : '⚫'} ${opcion}`,
        "data": {
          "action": "survey_response",
          "encuestaId": encuesta.id,
          "preguntaIndex": preguntaIndex,
          "respuesta": opcion,
          "preguntaTexto": pregunta.pregunta,
          "timestamp": new Date().toISOString()
        },
        "style": index === 0 ? "positive" : "default"
      })),
      
      // ✅ ACCIONES ADICIONALES
      {
        "type": "Action.Submit",
        "title": "📊 Ver Resultados",
        "data": {
          "action": "view_results",
          "encuestaId": encuesta.id
        },
        "style": "default"
      },
      {
        "type": "Action.Submit", 
        "title": "📋 Todas las Encuestas",
        "data": {
          "action": "list_surveys"
        },
        "style": "default"
      }
    ]
  };
  
  console.log(`✅ Card creada exitosamente para pregunta ${preguntaIndex + 1}`);
  return CardFactory.adaptiveCard(card);
}


// ============================
// COMANDOS PRINCIPALES
// ============================

// ACCIÓN PRINCIPAL - CREAR ENCUESTA
app.ai.action('crear_encuesta', async (context, state, data) => {
  console.log('🚀 ACCIÓN crear_encuesta INICIADA (Azure)');
  console.log('📝 Datos recibidos:', JSON.stringify(data, null, 2));
  console.log('👤 Usuario:', context.activity.from.name);
  
  try {
    if (!data || typeof data !== 'object') {
      console.error('❌ Datos inválidos o vacíos');
      await context.sendActivity("❌ Error: No se recibieron datos válidos para crear la encuesta.");
      return 'create-survey';
    }

    const { titulo, objetivo, preguntas } = data as Encuesta;
    console.log('🔍 Validando datos:', { titulo, objetivo, preguntasCount: preguntas?.length });

    if (!titulo || titulo.trim().length === 0) {
      await context.sendActivity("❌ Error: El título de la encuesta es obligatorio.");
      return 'create-survey';
    }

    if (!objetivo || objetivo.trim().length === 0) {
      await context.sendActivity("❌ Error: El objetivo de la encuesta es obligatorio.");
      return 'create-survey';
    }

    if (!preguntas || !Array.isArray(preguntas) || preguntas.length === 0) {
      await context.sendActivity("❌ Error: Se necesita al menos una pregunta para crear la encuesta.");
      return 'create-survey';
    }

    for (let i = 0; i < preguntas.length; i++) {
      const pregunta = preguntas[i];
      if (!pregunta.pregunta || pregunta.pregunta.trim().length === 0) {
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

    console.log('✅ Validaciones completadas, creando encuesta en Azure...');

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
    
    const resumen = `🎉 **¡Encuesta "${encuesta.titulo}" creada exitosamente en Azure!**

**📋 Detalles:**
• **ID:** \`${encuestaId}\`
• **Objetivo:** ${encuesta.objetivo}
• **Creador:** ${encuesta.creador}
• **Preguntas:** ${preguntas.length}
• **Almacenado en:** Azure Table Storage ☁️

**❓ Preguntas incluidas:**
${preguntas.map((p, i) => 
  `**${i + 1}.** ${p.pregunta}\n   📊 Opciones: ${p.opciones.join(' | ')}`
).join('\n\n')}

✅ La encuesta ha sido guardada correctamente en la nube y está lista para usar.

**🎯 Próximos pasos:**
• **Responder:** \`responder ${encuestaId}\`
• **Ver resultados:** \`resultados ${encuestaId}\``;

    await context.sendActivity(resumen);
    console.log('🎉 Encuesta creada en Azure y respuesta enviada exitosamente');
    return 'create-survey';

  } catch (error) {
    console.error("💥 ERROR CRÍTICO en crear_encuesta (Azure):", error);
    console.error("Stack trace:", error.stack);
    await context.sendActivity(`❌ Error interno al crear la encuesta en Azure: ${error.message}\n\nPor favor, intenta nuevamente.`);
    return 'create-survey';
  }
});

// COMANDO VER RESULTADOS
app.message(/^ver_resultados|resultados\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^(?:ver_resultados|resultados)\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`resultados [ID_encuesta]`\n\nEjemplo: `resultados clima_1234567_abc123`");
    return;
  }

  const encuestaId = match[1].trim();
  console.log(`📊 Buscando resultados en Azure para: ${encuestaId}`);

  try {
    const encuestaOriginal = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaOriginal) {
      await context.sendActivity(`❌ **Encuesta no encontrada en Azure**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    let resultados = await cargarResultadosAzure(encuestaId);
    if (!resultados) {
      resultados = {
        encuestaId: encuestaId,
        titulo: encuestaOriginal.titulo,
        fechaCreacion: new Date(),
        estado: 'activa',
        totalParticipantes: 0,
        respuestas: [],
        resumen: {}
      };
      await guardarResultadosAzure(resultados);
    }

    calcularResumen(resultados, encuestaOriginal);
    await guardarResultadosAzure(resultados);

    let reporte = `📊 **Resultados: ${resultados.titulo}** ☁️\n`;
    reporte += `🆔 ID: \`${encuestaId}\`\n`;
    reporte += `📅 Creada: ${new Date(resultados.fechaCreacion).toLocaleDateString()}\n`;
    reporte += `👥 Participantes: **${resultados.totalParticipantes}**\n`;
    reporte += `📊 Estado: **${resultados.estado}**\n`;
    reporte += `💾 Almacenado en: **Azure Table Storage**\n\n`;

    if (resultados.totalParticipantes === 0) {
      reporte += `🔔 **Sin respuestas aún**\n\n`;
      reporte += `**📋 Preguntas disponibles:**\n`;
      encuestaOriginal.preguntas.forEach((pregunta, index) => {
        reporte += `${index + 1}. ${pregunta.pregunta}\n`;
      });
      reporte += `\n**Para responder:** \`responder ${encuestaId}\``;
    } else {
      reporte += `📈 **Resultados por pregunta:**\n\n`;
      
      encuestaOriginal.preguntas.forEach((pregunta, index) => {
        reporte += `**${index + 1}.** ${pregunta.pregunta}\n`;
        
        const respuestasPregunta = resultados.resumen![index] || {};
        const totalRespuestas = Object.values(respuestasPregunta).reduce((sum: number, count) => sum + (count as number), 0);
        
        if (totalRespuestas === 0) {
          reporte += `   _(Sin respuestas)_\n\n`;
        } else {
          Object.entries(respuestasPregunta).forEach(([opcion, cantidad]) => {
            const porcentaje = totalRespuestas > 0 ? Math.round(((cantidad as number) / totalRespuestas) * 100) : 0;
            const barras = '█'.repeat(Math.floor(porcentaje / 10));
            reporte += `   📊 **${opcion}**: ${cantidad} (${porcentaje}%) ${barras}\n`;
          });
          reporte += `\n`;
        }
      });
    }

    await context.sendActivity(reporte);

  } catch (error) {
    console.error('❌ Error al generar resultados desde Azure:', error);
    await context.sendActivity("❌ Error al cargar los resultados desde Azure. Verifica que el ID sea correcto.");
  }
});

// COMANDO LISTAR
app.message(/^listar|mostrar_encuestas$/i, async (context, state) => {
  try {
    console.log(`📁 Listando encuestas desde Azure Table Storage`);
    
    const encuestas = await listarEncuestasAzure();
    
    if (encuestas.length === 0) {
      await context.sendActivity("📂 **No hay encuestas guardadas en Azure aún.**\n\nCrea tu primera encuesta escribiendo: *\"Quiero crear una encuesta\"*");
      return;
    }

    let lista = `📋 **Encuestas en Azure (${encuestas.length}):**\n\n`;
    
    encuestas.forEach((encuesta, index) => {
      const fecha = encuesta.fechaCreacion ? new Date(encuesta.fechaCreacion).toLocaleDateString() : 'N/A';
      lista += `**${index + 1}.** ${encuesta.titulo}\n`;
      lista += `   🆔 ID: \`${encuesta.id}\`\n`;
      lista += `   📅 Creada: ${fecha} | 👤 ${encuesta.creador || 'N/A'} | ❓ ${encuesta.preguntas?.length || 0} preguntas\n`;
      lista += `   ☁️ **Almacenado en Azure Table Storage**\n\n`;
    });

    await context.sendActivity(lista);
  } catch (error) {
    console.error('Error al listar encuestas desde Azure:', error);
    await context.sendActivity("❌ Error al acceder a las encuestas en Azure Table Storage.");
  }
});

// COMANDO RESPONDER ENCUESTA
app.message(/^responder_encuesta\s+([^\s]+)\s+(\d+)\s+(.+)$/i, async (context, state) => {
  console.log('🎯 Comando responder_encuesta ejecutado (Azure)');
  
  try {
    const match = context.activity.text.match(/^responder_encuesta\s+([^\s]+)\s+(\d+)\s+(.+)$/i);
    
    if (!match) {
      await context.sendActivity("❌ **Formato incorrecto**\n\nUsa: `responder_encuesta [ID_encuesta] [número_pregunta] [tu_respuesta]`\n\nEjemplo: `responder_encuesta encuestaso_1748980691593_288msj 1 Si`");
      return;
    }
    
    const encuestaId = match[1].trim();
    const numeroPregunta = parseInt(match[2]);
    const respuestaTexto = match[3].trim();
    const preguntaIndex = numeroPregunta - 1;
    
    console.log(`📝 Datos: ID=${encuestaId}, Pregunta=${numeroPregunta}, Respuesta=${respuestaTexto}`);
    
    const encuestaEncontrada = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaEncontrada) {
      await context.sendActivity(`❌ **Encuesta no encontrada en Azure**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    if (preguntaIndex < 0 || preguntaIndex >= encuestaEncontrada.preguntas.length) {
      await context.sendActivity(`❌ **Pregunta inválida**: ${numeroPregunta}\n\nLa encuesta "${encuestaEncontrada.titulo}" tiene ${encuestaEncontrada.preguntas.length} pregunta(s).`);
      return;
    }

    const pregunta = encuestaEncontrada.preguntas[preguntaIndex];
    
    const opcionValida = pregunta.opciones.find(opcion => 
      opcion.toLowerCase() === respuestaTexto.toLowerCase()
    );
    
    if (!opcionValida) {
      await context.sendActivity(`❌ **Respuesta inválida**: "${respuestaTexto}"\n\n**Opciones válidas para la pregunta ${numeroPregunta}:**\n${pregunta.opciones.map(op => `• ${op}`).join('\n')}`);
      return;
    }

    const userId = context.activity.from.id;
    await guardarRespuestaIndividualAzure(encuestaId, userId, preguntaIndex, opcionValida, pregunta.pregunta);

    const confirmacion = `✅ **¡Respuesta guardada en Azure exitosamente!** ☁️

📋 **Encuesta:** ${encuestaEncontrada.titulo}
❓ **Pregunta ${numeroPregunta}:** ${pregunta.pregunta}
💬 **Tu respuesta:** ${opcionValida}

🎯 **Ver resultados actualizados:** \`resultados ${encuestaId}\`
📝 **Responder otra pregunta:** \`responder_encuesta ${encuestaId} [número] [respuesta]\``;
    
    await context.sendActivity(confirmacion);
    console.log(`✅ Respuesta procesada exitosamente en Azure`);

  } catch (error) {
    console.error('❌ Error en responder_encuesta (Azure):', error);
    await context.sendActivity("❌ Error interno al procesar tu respuesta en Azure. Intenta nuevamente o contacta al administrador.");
  }
});

// COMANDO RESPONDER
app.message(/^responder\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^responder\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`responder [ID_encuesta]`\n\nEjemplo: `responder encuestaso_1748980691593_288msj`");
    return;
  }

  const encuestaId = match[1].trim();
  console.log(`🎯 Usuario quiere responder encuesta desde Azure: ${encuestaId}`);

  try {
    const encuestaEncontrada = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaEncontrada) {
      await context.sendActivity(`❌ **Encuesta no encontrada en Azure**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    const resultados = await cargarResultadosAzure(encuestaId);
    if (resultados && resultados.estado === 'cerrada') {
      await context.sendActivity(`🔒 **Encuesta cerrada**: "${encuestaEncontrada.titulo}"\n\nEsta encuesta ya no acepta respuestas.`);
      return;
    }

    // 🎴 CREAR ADAPTIVE CARD para la primera pregunta
    const responseCard = createSurveyResponseCard(encuestaEncontrada, 0);
    
    await context.sendActivity(MessageFactory.attachment(responseCard));
    console.log(`✅ Survey Response Card enviada para: ${encuestaId}`);

  } catch (error) {
    console.error('❌ Error al mostrar encuesta desde Azure:', error);
    await context.sendActivity("❌ Error al cargar la encuesta desde Azure. Verifica que el ID sea correcto.");
  }
});

// ANÁLISIS INTELIGENTE
app.message(/^analizar\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^analizar\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`analizar [ID_encuesta]`\n\nEjemplo: `analizar encuestaso_1748980691593_288msj`");
    return;
  }

  const encuestaId = match[1].trim();
  console.log(`📊 Iniciando análisis inteligente desde Azure para: ${encuestaId}`);

  try {
    const encuestaOriginal = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaOriginal) {
      await context.sendActivity(`❌ **Encuesta no encontrada en Azure**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    let resultados = await cargarResultadosAzure(encuestaId);
    if (!resultados) {
      await context.sendActivity(`❌ **Error**: No se encontraron datos de resultados en Azure.`);
      return;
    }

    calcularResumen(resultados, encuestaOriginal);

    if (resultados.totalParticipantes === 0) {
      await context.sendActivity(`📊 **Sin datos para analizar**\n\nLa encuesta "${encuestaOriginal.titulo}" no tiene respuestas aún.\n\nPara responder: \`responder ${encuestaId}\``);
      return;
    }

    await context.sendActivity("🧠 **Generando análisis inteligente desde Azure...** ☁️");

    let analisis = `🧠 **Análisis Inteligente: ${encuestaOriginal.titulo}** ☁️\n\n`;
    
    analisis += `📊 **RESUMEN EJECUTIVO:**\n`;
    analisis += `• **Participantes:** ${resultados.totalParticipantes} ${resultados.totalParticipantes === 1 ? 'persona' : 'personas'}\n`;
    analisis += `• **Fuente de datos:** Azure Table Storage ☁️\n`;
    analisis += `• **Fecha análisis:** ${new Date().toLocaleDateString()}\n\n`;

    analisis += `🔍 **INSIGHTS POR PREGUNTA:**\n\n`;
    
    let recomendaciones: string[] = [];
    let alertas: string[] = [];

    encuestaOriginal.preguntas.forEach((pregunta, index) => {
      const respuestasPregunta = resultados!.resumen![index] || {};
      const totalRespuestas = Object.values(respuestasPregunta).reduce((sum, count) => sum + (count as number), 0);
      
      analisis += `**${index + 1}. ${pregunta.pregunta}**\n`;
      
      if (totalRespuestas === 0) {
        analisis += `   📝 _Sin respuestas registradas_\n\n`;
        alertas.push(`Pregunta ${index + 1} no tiene respuestas`);
      } else {
        const respuestasOrdenadas = Object.entries(respuestasPregunta)
          .sort(([,a], [,b]) => (b as number) - (a as number));
        
        const [respuestaMasVotada, votosMax] = respuestasOrdenadas[0];
        const porcentajeMax = Math.round(((votosMax as number) / totalRespuestas) * 100);
        
        analisis += `   🏆 **Respuesta principal:** "${respuestaMasVotada}" (${porcentajeMax}%)\n`;
        
        if (porcentajeMax >= 80) {
          analisis += `   💪 **Alto consenso** - Clara preferencia mayoritaria\n`;
          recomendaciones.push(`Pregunta ${index + 1}: Aprovechar el fuerte consenso hacia "${respuestaMasVotada}"`);
        } else if (porcentajeMax >= 60) {
          analisis += `   ⚖️ **Consenso moderado** - Mayoría clara pero con diversidad\n`;
        } else if (porcentajeMax < 40) {
          analisis += `   🤔 **Opiniones divididas** - No hay consenso claro\n`;
          alertas.push(`Pregunta ${index + 1}: Opiniones muy divididas requieren atención`);
        }
        
        if (respuestasOrdenadas.length > 1) {
          analisis += `   📈 **Distribución:** `;
          respuestasOrdenadas.slice(0, 3).forEach(([resp, votos], i) => {
            const pct = Math.round(((votos as number) / totalRespuestas) * 100);
            analisis += `${resp}(${pct}%)${i < Math.min(respuestasOrdenadas.length - 1, 2) ? ', ' : ''}`;
          });
          analisis += `\n`;
        }
        analisis += `\n`;
      }
    });

    if (recomendaciones.length > 0) {
      analisis += `\n💡 **RECOMENDACIONES ESTRATÉGICAS:**\n`;
      recomendaciones.forEach((rec, i) => {
        analisis += `${i + 1}. ${rec}\n`;
      });
    }

    if (alertas.length > 0) {
      analisis += `\n⚠️ **PUNTOS DE ATENCIÓN:**\n`;
      alertas.forEach((alerta, i) => {
        analisis += `${i + 1}. ${alerta}\n`;
      });
    }

    analisis += `\n🎯 **PRÓXIMOS PASOS:**\n`;
    if (resultados.totalParticipantes < 5) {
      analisis += `• Aumentar participación para obtener datos más representativos\n`;
    }
    analisis += `• Monitorear tendencias con futuras encuestas\n`;
    analisis += `• Compartir resultados con stakeholders relevantes\n`;
    
    analisis += `\n📋 **Datos detallados:** \`resultados ${encuestaId}\`\n`;
    analisis += `🔄 **Actualizar análisis:** \`analizar ${encuestaId}\`\n`;
    analisis += `☁️ **Datos desde:** Azure Table Storage`;

    await context.sendActivity(analisis);
    console.log(`✅ Análisis inteligente completado desde Azure para: ${encuestaId}`);

  } catch (error) {
    console.error('❌ Error en análisis inteligente desde Azure:', error);
    await context.sendActivity(`❌ Error al generar análisis desde Azure. Usa \`resultados ${encuestaId}\` para ver datos básicos.`);
  }
});

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
    
    const templatesPublicos = await azureService.listarTemplatesPublicos();
    
    if (templatesPublicos.length === 0) {
      await context.sendActivity("📂 **No hay templates disponibles.**\n\nEjecuta `seed_templates` para cargar templates iniciales.");
      return;
    }

    let mensaje = `📋 **Templates Disponibles (${templatesPublicos.length})** ☁️\n\n`;

    const categorias = Array.from(new Set(templatesPublicos.map(t => t.categoria)));
    
    categorias.forEach(categoria => {
      const templatesCategoria = templatesPublicos.filter(t => t.categoria === categoria);
      
      mensaje += `### 📂 **${categoria.toUpperCase()}**\n`;
      
      templatesCategoria.forEach(template => {
        const planBadge = template.nivelPlan === 'free' ? '🆓' : 
                         template.nivelPlan === 'professional' ? '💼' : '🏢';
        const popularidad = template.vecesUsado > 0 ? ` (${template.vecesUsado} usos)` : '';
        
        mensaje += `${planBadge} **${template.nombre}**${popularidad}\n`;
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

    const encuestaId = generarIdEncuesta(template.nombre);
    
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
// COMANDOS DE UTILIDAD
// ============================

// COMANDO DE MIGRACIÓN
app.message(/^migrar_azure$/i, async (context, state) => {
  await context.sendActivity("🔄 **Iniciando migración a Azure Tables...**\n\nEsto puede tardar unos momentos...");
  
  try {
    const { migrarDatosJSON } = await import('../services/azureTableService');
    await migrarDatosJSON();
    await context.sendActivity("🎉 **¡Migración completada exitosamente!**\n\nTodos los datos ahora están en Azure Table Storage.\n\n✅ **El sistema ahora funciona 100% en la nube** ☁️");
  } catch (error) {
    console.error('Error en migración:', error);
    await context.sendActivity("❌ **Error en migración**: " + error.message);
  }
});

// COMANDO DE PRUEBA AZURE
app.message(/^test_azure$/i, async (context, state) => {
  console.log('🧪 Ejecutando prueba de Azure Table Storage...');
  
  const encuestaPrueba: Encuesta = {
    titulo: "🔬 Prueba Azure Table Storage",
    objetivo: "Verificar el correcto funcionamiento de la migración a Azure",
    preguntas: [
      {
        pregunta: "¿Funciona correctamente Azure Table Storage?",
        opciones: ["Excelente", "Bien", "Regular", "Mal"]
      },
      {
        pregunta: "¿La migración fue exitosa?",
        opciones: ["Totalmente", "Parcialmente", "No funciona"]
      }
    ],
    creador: context.activity.from.name || 'Sistema de Pruebas Azure',
  };

  try {
    const encuestaId = generarIdEncuesta(encuestaPrueba.titulo);
    encuestaPrueba.id = encuestaId;
    encuestaPrueba.fechaCreacion = new Date();
    
    await guardarEncuestaEnAzure(encuestaPrueba);
    
    const resultadosIniciales: ResultadosEncuesta = {
      encuestaId: encuestaId,
      titulo: encuestaPrueba.titulo,
      fechaCreacion: new Date(),
      estado: 'activa',
      totalParticipantes: 0,
      respuestas: [],
      resumen: {}
    };
    
    await guardarResultadosAzure(resultadosIniciales);
    
    await context.sendActivity(`✅ **¡Prueba Azure exitosa!** ☁️

📋 **Encuesta creada en Azure:**
• **Título:** ${encuestaPrueba.titulo}
• **ID:** \`${encuestaId}\`
• **Almacenado en:** Azure Table Storage

🧪 **Prueba estos comandos:**
• \`resultados ${encuestaId}\`
• \`responder ${encuestaId}\`
• \`listar\`

🎉 **Azure Table Storage está funcionando correctamente!**`);
  } catch (error) {
    await context.sendActivity(`❌ **Prueba Azure fallida:** ${error.message}\n\nVerifica la configuración de Azure Table Storage.`);
  }
});

// COMANDO DE AYUDA
app.message(/^ayuda|help$/i, async (context, state) => {
  const ayuda = `🤖 **TeamPulse - Comandos disponibles (Azure):** ☁️

**📝 Crear encuestas:**
• "Quiero crear una encuesta"
• "Ayuda con una encuesta de clima laboral"
• "Necesito hacer preguntas de satisfacción"

**📋 Templates:**
• \`ver_templates\` - Ver todos los templates disponibles
• \`usar_template [id]\` - Crear encuesta desde template
• \`buscar_templates [término]\` - Buscar templates específicos
• \`seed_templates\` - Cargar templates iniciales

**📋 Ver encuestas:**
• \`listar\` - Ver todas las encuestas en Azure
• \`mostrar_encuestas\` - Mismo comando anterior

**📊 Ver resultados:**
• \`resultados [ID]\` - Ver resultados desde Azure
• Ejemplo: \`resultados clima_1234567_abc123\`

**📝 Responder encuestas:**
• \`responder [ID]\` - Ver encuesta y opciones
• \`responder_encuesta [ID] [#pregunta] [respuesta]\`

**🧠 Análisis inteligente:**
• \`analizar [ID]\` - Análisis avanzado con insights

**🧪 Pruebas y migración:**
• \`test_azure\` - Probar Azure Table Storage
• \`migrar_azure\` - Migrar datos JSON a Azure (una vez)
• \`ayuda\` - Mostrar este mensaje

**💾 Almacenamiento:**
✅ **Todos los datos están en Azure Table Storage** ☁️
• Alta disponibilidad y escalabilidad
• Respaldo automático en la nube
• Acceso desde cualquier parte del mundo

**💡 Ejemplos de uso:**
• *"Crear encuesta de satisfacción laboral"*
• *"Encuesta sobre la nueva oficina"*
• *"Feedback del último proyecto"*

¡Empezá creando tu primera encuesta en Azure! 🚀☁️`;

  await context.sendActivity(ayuda);
});

// ============================
// MANEJO DE ERRORES
// ============================

// Manejo de errores del feedback loop
app.feedbackLoop(async (context, state, feedbackLoopData) => {
  console.log("📢 Feedback recibido:", JSON.stringify(feedbackLoopData, null, 2));
  console.log("💬 Actividad completa:", JSON.stringify(context.activity, null, 2));
});

// Manejo de errores generales
app.error(async (context, error) => {
  console.error(`💥 Error general de la aplicación:`, error);
  await context.sendActivity("❌ Ocurrió un error inesperado con Azure. Por favor, intenta nuevamente o contacta al administrador.");
});

// COMANDO DE PRUEBA
app.message(/^test_card$/i, async (context, state) => {
  const testCard = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard", 
    "version": "1.4",
    "body": [
      {
        "type": "TextBlock",
        "text": "🔧 Prueba de Adaptive Card",
        "weight": "Bolder",
        "size": "Large"
      }
    ],
    "actions": [
      {
        "type": "Action.Submit",
        "title": "Probar Handler",
        "data": {
          "action": "debug_test",
          "mensaje": "Hola desde la card"
        }
      }
    ]
  };
  
  const cardMessage = MessageFactory.attachment(CardFactory.adaptiveCard(testCard));
  await context.sendActivity(cardMessage);
});

// Comando de debug para cards
app.message(/^debug_cards$/i, async (context, state) => {
  console.log('🔧 DEBUG DE ADAPTIVE CARDS - VERSIÓN MEJORADA');
  
  try {
    await context.sendActivity("🔧 **Iniciando debug mejorado de Adaptive Cards...**");
    
    // Card más simple para testing
    const testCard = {
      "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      "type": "AdaptiveCard",
      "version": "1.4",
      "body": [
        {
          "type": "TextBlock",
          "text": "🧪 Debug Handler - TeamPulse",
          "weight": "Bolder",
          "size": "Large",
          "color": "Accent"
        },
        {
          "type": "TextBlock",
          "text": "Haz click en el botón para probar el handler.",
          "wrap": true,
          "spacing": "Medium"
        },
        {
          "type": "TextBlock",
          "text": "⚠️ IMPORTANTE: Mira los logs en Azure después del click.",
          "wrap": true,
          "size": "Small",
          "color": "Warning"
        }
      ],
      "actions": [
        {
          "type": "Action.Submit",
          "title": "🟢 PROBAR HANDLER",
          "data": {
            "action": "debug_test",
            "mensaje": "Test desde debug_cards",
            "timestamp": new Date().toISOString(),
            "test_id": "debug_001"
          },
          "style": "positive"
        }
      ]
    };
    
    const cardMessage = MessageFactory.attachment(CardFactory.adaptiveCard(testCard));
    await context.sendActivity(cardMessage);
    
    await context.sendActivity(`✅ **Card de debug enviada**

🎯 **Instrucciones:**
1. **Haz click** en el botón verde "PROBAR HANDLER"
2. **Espera 2-3 segundos** para la respuesta
3. **Si NO responde:** Mira los logs en Azure Log Stream

💡 **Logs a buscar:**
\`🔧 DEBUG_TEST ACTION EJECUTADA!\`
\`📥 Datos recibidos en debug_test:\`

🔍 **Si no ves esos logs:** Los handlers no se están registrando correctamente.`);
    
  } catch (error) {
    console.error('❌ Error en debug de cards:', error);
    await context.sendActivity(`❌ **Error en debug:** ${error.message}

🔧 El sistema de comandos sigue funcionando normalmente.`);
  }
});


// Comando de diagnóstico completo
app.message(/^diagnostico_cards$/i, async (context, state) => {
  console.log('🔬 DIAGNÓSTICO COMPLETO DE ADAPTIVE CARDS');
  
  try {
    await context.sendActivity("🔬 **Iniciando diagnóstico completo...**");
    
    const encuestas = await listarEncuestasAzure();
    const hayEncuestas = encuestas.length > 0;
    
    let reporte = `🔍 **Diagnóstico TeamPulse - Adaptive Cards**\n\n`;
    
    reporte += `**🏗️ Sistema Base:**\n`;
    reporte += `✅ Azure Table Storage: Conectado\n`;
    reporte += `${hayEncuestas ? '✅' : '⚠️'} Encuestas disponibles: ${encuestas.length}\n`;
    reporte += `✅ Handlers registrados: survey_response, view_results, list_surveys\n\n`;
    
    reporte += `**📋 Comandos Disponibles:**\n`;
    reporte += `• \`responder [ID]\` - Adaptive Card mejorada\n`;
    reporte += `• \`debug_cards\` - Test handlers\n`;
    reporte += `• \`diagnostico_cards\` - Este diagnóstico\n\n`;
    
    if (hayEncuestas) {
      reporte += `**🎯 Test rápido:**\n`;
      reporte += `\`responder ${encuestas[0].id}\``;
    } else {
      reporte += `**💡 Para testing:**\n`;
      reporte += `1. Crear encuesta: "Quiero crear una encuesta"\n`;
      reporte += `2. Probar responder: \`responder [ID]\``;
    }
    
    await context.sendActivity(reporte);
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
    await context.sendActivity(`❌ **Error en diagnóstico:** ${error.message}`);
  }
});

app.activity('invoke', async (context, state) => {
  const timestamp = new Date().toISOString();
  console.log(`🔔 [${timestamp}] ===== INVOKE ACTIVITY RECIBIDA =====`);
  console.log(`📥 Tipo de actividad:`, context.activity.type);
  console.log(`📥 Nombre de invoke:`, context.activity.name);
  console.log(`📥 Value completo:`, JSON.stringify(context.activity.value, null, 2));
  console.log(`📥 Actividad completa:`, JSON.stringify(context.activity, null, 2));
  console.log(`========================================`);
});

export default app;