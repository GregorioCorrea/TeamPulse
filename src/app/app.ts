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

// Handler para respuestas de encuesta
app.adaptiveCards.actionExecute('survey_response', async (context, state, data) => {
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

  return "";
});

// Handler para ver resultados desde card
app.adaptiveCards.actionExecute('view_results', async (context, state, data) => {
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
  
  return "";
  
  return "";
});

// Handler para listar encuestas desde card
app.adaptiveCards.actionExecute('list_surveys', async (context, state, data) => {
  console.log('📋 Listar encuestas desde card');
  
  try {
    const encuestas = await listarEncuestasAzure();
    
    if (encuestas.length === 0) {
      await context.sendActivity("📂 **No hay encuestas guardadas aún.**");
      return;
    }
    
    let lista = `📋 **Encuestas (${encuestas.length}):**\n\n`;
    
    encuestas.slice(0, 3).forEach((encuesta, index) => {
      const fecha = encuesta.fechaCreacion ? new Date(encuesta.fechaCreacion).toLocaleDateString() : 'N/A';
      lista += `**${index + 1}.** ${encuesta.titulo}\n`;
      lista += `   🆔 \`${encuesta.id}\`\n\n`;
    });
    
    if (encuestas.length > 3) {
      lista += `... y ${encuestas.length - 3} más.`;
    }
    
    await context.sendActivity(lista);
    
  } catch (error) {
    console.error('❌ Error listando encuestas:', error);
    await context.sendActivity("❌ Error al cargar encuestas");
  }
  
  return "";
});

// Handler para debug
app.adaptiveCards.actionExecute('debug_test', async (context, state, data) => {
  console.log('🔧 Debug test ejecutado!', data);
  
  await context.sendActivity(`✅ **¡Handler funcionando!**

🎯 **Datos recibidos:** ${JSON.stringify(data)}
⏰ **Timestamp:** ${new Date().toISOString()}

🎉 **Las Adaptive Cards están funcionando correctamente!**`);
  
  return "";
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
        "type": "Action.Execute",
        "title": `${index === 0 ? '🟢' : index === 1 ? '🔵' : index === 2 ? '🟡' : '⚫'} ${opcion}`,
        "data": {
          "verb": "survey_response",  // ⚡ CLAVE: verb va DENTRO de data
          "encuestaId": encuesta.id,
          "preguntaIndex": preguntaIndex,
          "respuesta": opcion,
          "preguntaTexto": pregunta.pregunta
        }
      })),
      
      // Acciones adicionales
      {
        "type": "Action.Execute",
        "title": "📊 Ver Resultados",
        "data": {
          "verb": "view_results",  // ⚡ CLAVE: verb va DENTRO de data
          "encuestaId": encuesta.id
        }
      },
      {
        "type": "Action.Execute",
        "title": "📋 Todas las Encuestas",
        "data": {
          "verb": "list_surveys"  // ⚡ CLAVE: verb va DENTRO de data
        }
      }
    ]
  };
  
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
    
    if (encuestas.length === 0) {
      await context.sendActivity("📂 **No hay encuestas guardadas aún.**\n\nCrea tu primera encuesta escribiendo: *\"Quiero crear una encuesta\"*");
      return;
    }

    let lista = `📋 **Encuestas en Azure (${encuestas.length}):**\n\n`;
    
    encuestas.forEach((encuesta, index) => {
      const fecha = encuesta.fechaCreacion ? new Date(encuesta.fechaCreacion).toLocaleDateString() : 'N/A';
      lista += `**${index + 1}.** ${encuesta.titulo}\n`;
      lista += `   🆔 \`${encuesta.id}\`\n`;
      lista += `   📅 ${fecha} | 👤 ${encuesta.creador || 'N/A'}\n\n`;
    });

    await context.sendActivity(lista);
  } catch (error) {
    console.error('❌ Error listando encuestas:', error);
    await context.sendActivity("❌ Error al acceder a las encuestas.");
  }
});

// COMANDO RESULTADOS
app.message(/^resultados\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^resultados\s+(.+)$/i);
  const encuestaId = match[1].trim();

  try {
    const encuestaOriginal = await buscarEncuestaEnAzure(encuestaId);

    if (!encuestaOriginal) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\``);
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

    let reporte = `📊 **Resultados: ${resultados.titulo}**\n`;
    reporte += `👥 Participantes: **${resultados.totalParticipantes}**\n\n`;

    if (resultados.totalParticipantes === 0) {
      reporte += `🔔 **Sin respuestas aún**\n\n**Para responder:** \`responder ${encuestaId}\``;
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
    console.error('❌ Error generando resultados:', error);
    await context.sendActivity("❌ Error al cargar los resultados.");
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
        "type": "Action.Execute",
        "title": "🟢 PROBAR HANDLER",
        "data": {
          "verb": "debug_test",  // ⚡ CAMBIO: verb dentro de data
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

export default app;