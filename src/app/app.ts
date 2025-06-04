import { MemoryStorage, MessageFactory, TurnContext } from "botbuilder";
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

// NUEVAS interfaces para respuestas
interface Respuesta {
  participanteId: string; // Hash anónimo
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

// Función para generar ID único de encuesta
function generarIdEncuesta(titulo: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const tituloLimpio = titulo.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toLowerCase();
  return `${tituloLimpio}_${timestamp}_${random}`;
}

// Función para crear hash anónimo de usuario
function crearParticipanteAnonimo(userId: string, encuestaId: string): string {
  // Crear hash simple pero anónimo
  const data = userId + encuestaId + "salt_secreto";
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `anon_${Math.abs(hash).toString(36)}`;
}

// Función para guardar/cargar resultados
function guardarResultados(resultados: ResultadosEncuesta): void {
  try {
    const dataDir = path.join(__dirname, '../../data/resultados');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const filePath = path.join(dataDir, `${resultados.encuestaId}_resultados.json`);
    fs.writeFileSync(filePath, JSON.stringify(resultados, null, 2), 'utf-8');
    console.log(`📊 Resultados guardados: ${resultados.encuestaId}`);
  } catch (error) {
    console.error('❌ Error guardando resultados:', error);
    throw error;
  }
}

function cargarResultados(encuestaId: string): ResultadosEncuesta | null {
  try {
    const filePath = path.join(__dirname, `../../data/resultados/${encuestaId}_resultados.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error cargando resultados:', error);
    return null;
  }
}

// Función para calcular resumen automático
function calcularResumen(resultados: ResultadosEncuesta, encuesta: Encuesta): void {
  resultados.resumen = {};
  
  encuesta.preguntas.forEach((pregunta, preguntaIndex) => {
    resultados.resumen![preguntaIndex] = {};
    
    // Inicializar contadores
    pregunta.opciones.forEach(opcion => {
      resultados.resumen![preguntaIndex][opcion] = 0;
    });
    
    // Contar respuestas
    resultados.respuestas
      .filter(r => r.preguntaIndex === preguntaIndex)
      .forEach(respuesta => {
        if (resultados.resumen![preguntaIndex][respuesta.respuesta] !== undefined) {
          resultados.resumen![preguntaIndex][respuesta.respuesta]++;
        }
      });
  });
  
  // Actualizar total de participantes únicos
  const participantesUnicos = new Set(resultados.respuestas.map(r => r.participanteId));
  resultados.totalParticipantes = participantesUnicos.size;
}

// Función mejorada para guardar encuestas
function guardarEncuestaComoJSON(encuesta: Encuesta): string {
  try {
    // Crear directorio data si no existe
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Generar nombre de archivo más limpio
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const tituloLimpio = encuesta.titulo
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase()
      .substring(0, 30);
    
    const fileName = `${tituloLimpio}_${timestamp}.json`;
    const filePath = path.join(dataDir, fileName);

    // Agregar metadata
    const encuestaCompleta = {
      ...encuesta,
      fechaCreacion: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(encuestaCompleta, null, 2), 'utf-8');
    console.log(`✅ Encuesta guardada exitosamente en: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('❌ Error detallado al guardar encuesta:', error);
    throw new Error(`Error al guardar: ${error.message}`);
  }
}

// ACCIÓN PRINCIPAL - Mejorada con IDs únicos
app.ai.action('crear_encuesta', async (context, state, data) => {
  console.log('🚀 ACCIÓN crear_encuesta INICIADA');
  console.log('📝 Datos recibidos:', JSON.stringify(data, null, 2));
  console.log('👤 Usuario:', context.activity.from.name);
  
  try {
    // Validación inicial
    if (!data || typeof data !== 'object') {
      console.error('❌ Datos inválidos o vacíos');
      await context.sendActivity("❌ Error: No se recibieron datos válidos para crear la encuesta.");
      return 'create-survey';
    }

    const { titulo, objetivo, preguntas } = data as Encuesta;
    console.log('🔍 Validando datos:', { titulo, objetivo, preguntasCount: preguntas?.length });

    // Validaciones específicas
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

    // Validar cada pregunta
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

      // Validar que las opciones no estén vacías
      const opcionesValidas = pregunta.opciones.filter(op => op && op.trim().length > 0);
      if (opcionesValidas.length < 2) {
        await context.sendActivity(`❌ Error: La pregunta ${i + 1} necesita al menos 2 opciones válidas.`);
        return 'create-survey';
      }
      
      // Limpiar las opciones
      pregunta.opciones = opcionesValidas.map(op => op.trim());
    }

    console.log('✅ Validaciones completadas, creando encuesta...');

    // GENERAR ID ÚNICO
    const encuestaId = generarIdEncuesta(titulo);
    
    const encuesta: Encuesta = {
      titulo: titulo.trim(),
      objetivo: objetivo.trim(),
      preguntas,
      creador: context.activity.from.name || 'Usuario desconocido',
      id: encuestaId, // NUEVO: ID único
    };

    const rutaArchivo = guardarEncuestaComoJSON(encuesta);
    
    // NUEVO: Crear archivo de resultados vacío
    const resultadosIniciales: ResultadosEncuesta = {
      encuestaId: encuestaId,
      titulo: encuesta.titulo,
      fechaCreacion: new Date(),
      estado: 'activa',
      totalParticipantes: 0,
      respuestas: [],
      resumen: {}
    };
    
    guardarResultados(resultadosIniciales);
    
    // Generar respuesta exitosa detallada
    const resumen = `🎉 **¡Encuesta "${encuesta.titulo}" creada exitosamente!**

**📋 Detalles:**
• **ID:** \`${encuestaId}\`
• **Objetivo:** ${encuesta.objetivo}
• **Creador:** ${encuesta.creador}
• **Preguntas:** ${preguntas.length}
• **Archivo:** ${path.basename(rutaArchivo)}

**❓ Preguntas incluidas:**
${preguntas.map((p, i) => 
  `**${i + 1}.** ${p.pregunta}\n   📊 Opciones: ${p.opciones.join(' | ')}`
).join('\n\n')}

✅ La encuesta ha sido guardada correctamente y está lista para usar.

**🎯 Próximos pasos:**
• **Ver resultados:** \`resultados ${encuestaId}\``;

    await context.sendActivity(resumen);
    console.log('🎉 Encuesta creada y respuesta enviada exitosamente');
    return 'create-survey';

  } catch (error) {
    console.error("💥 ERROR CRÍTICO en crear_encuesta:", error);
    console.error("Stack trace:", error.stack);
    await context.sendActivity(`❌ Error interno al crear la encuesta: ${error.message}\n\nPor favor, intenta nuevamente.`);
    return 'create-survey';
  }
});

// NUEVO comando para ver resultados
app.message(/^ver_resultados|resultados\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^(?:ver_resultados|resultados)\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`resultados [ID_encuesta]`\n\nEjemplo: `resultados clima_1234567_abc123`");
    return;
  }

  const encuestaId = match[1].trim();
  console.log(`📊 Buscando resultados para: ${encuestaId}`);

  try {
    // Cargar encuesta original
    const dataDir = path.join(__dirname, '../../data');
    const archivosEncuestas = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    
    let encuestaOriginal: Encuesta | null = null;
    for (const archivo of archivosEncuestas) {
      try {
        const contenido = JSON.parse(fs.readFileSync(path.join(dataDir, archivo), 'utf-8'));
        if (contenido.id === encuestaId) {
          encuestaOriginal = contenido;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!encuestaOriginal) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    // Cargar resultados
    let resultados = cargarResultados(encuestaId);
    if (!resultados) {
      // Crear resultados vacíos si no existen
      resultados = {
        encuestaId: encuestaId,
        titulo: encuestaOriginal.titulo,
        fechaCreacion: new Date(),
        estado: 'activa',
        totalParticipantes: 0,
        respuestas: [],
        resumen: {}
      };
      guardarResultados(resultados);
    }

    // Calcular resumen actualizado
    calcularResumen(resultados, encuestaOriginal);
    guardarResultados(resultados);

    // Generar reporte
    let reporte = `📊 **Resultados: ${resultados.titulo}**\n`;
    reporte += `🆔 ID: \`${encuestaId}\`\n`;
    reporte += `📅 Creada: ${new Date(resultados.fechaCreacion).toLocaleDateString()}\n`;
    reporte += `👥 Participantes: **${resultados.totalParticipantes}**\n`;
    reporte += `📊 Estado: **${resultados.estado}**\n\n`;

    if (resultados.totalParticipantes === 0) {
      reporte += `🔔 **Sin respuestas aún**\n\n`;
      reporte += `**📋 Preguntas disponibles:**\n`;
      encuestaOriginal.preguntas.forEach((pregunta, index) => {
        reporte += `${index + 1}. ${pregunta.pregunta}\n`;
      });
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
    console.error('❌ Error al generar resultados:', error);
    await context.sendActivity("❌ Error al cargar los resultados. Verifica que el ID sea correcto.");
  }
});

// Comando de prueba mejorado
app.message(/^test_encuesta$/i, async (context, state) => {
  console.log('🧪 Ejecutando prueba de guardado...');
  
  const encuestaPrueba: Encuesta = {
    titulo: "Encuesta de Prueba Automática",
    objetivo: "Verificar el correcto funcionamiento del sistema de guardado",
    preguntas: [
      {
        pregunta: "¿Cómo calificarías tu experiencia con TeamPulse?",
        opciones: ["Excelente", "Buena", "Regular", "Mala", "Muy mala"]
      },
      {
        pregunta: "¿Recomendarías TeamPulse a tu equipo?",
        opciones: ["Definitivamente sí", "Probablemente sí", "No estoy seguro", "Probablemente no", "Definitivamente no"]
      },
      {
        pregunta: "¿Qué función te parece más útil?",
        opciones: ["Creación rápida de encuestas", "Análisis con IA", "Integración con Teams", "Anonimato garantizado"]
      }
    ],
    creador: context.activity.from.name || 'Sistema de Pruebas',
  };

  try {
    // Generar ID y completar datos
    const encuestaId = generarIdEncuesta(encuestaPrueba.titulo);
    encuestaPrueba.id = encuestaId;
    
    const rutaArchivo = guardarEncuestaComoJSON(encuestaPrueba);
    
    // Crear resultados vacíos
    const resultadosIniciales: ResultadosEncuesta = {
      encuestaId: encuestaId,
      titulo: encuestaPrueba.titulo,
      fechaCreacion: new Date(),
      estado: 'activa',
      totalParticipantes: 0,
      respuestas: [],
      resumen: {}
    };
    
    guardarResultados(resultadosIniciales);
    
    await context.sendActivity(`✅ **Prueba exitosa!**

📋 **Encuesta creada:**
• **Título:** ${encuestaPrueba.titulo}
• **ID:** \`${encuestaId}\`
• **Archivo:** \`${path.basename(rutaArchivo)}\`

🧪 **Prueba estos comandos:**
• \`resultados ${encuestaId}\`
• \`listar\`

El sistema está funcionando correctamente. 🎉`);
  } catch (error) {
    await context.sendActivity(`❌ **Prueba fallida:** ${error.message}`);
  }
});

// Comando para listar encuestas con más detalles
app.message(/^listar|mostrar_encuestas$/i, async (context, state) => {
  try {
    const dataDir = path.join(__dirname, '../../data');
    console.log(`📁 Buscando encuestas en: ${dataDir}`);
    
    if (!fs.existsSync(dataDir)) {
      await context.sendActivity("📂 **No hay encuestas guardadas aún.**\n\nCrea tu primera encuesta escribiendo: *\"Quiero crear una encuesta\"*");
      return;
    }

    const archivos = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
    
    if (archivos.length === 0) {
      await context.sendActivity("📂 **No hay encuestas guardadas aún.**\n\nCrea tu primera encuesta escribiendo: *\"Quiero crear una encuesta\"*");
      return;
    }

    let lista = `📋 **Encuestas guardadas (${archivos.length}):**\n\n`;
    
    archivos.forEach((archivo, index) => {
      try {
        const contenido = JSON.parse(fs.readFileSync(path.join(dataDir, archivo), 'utf-8'));
        const fecha = contenido.fechaCreacion ? new Date(contenido.fechaCreacion).toLocaleDateString() : 'N/A';
        lista += `**${index + 1}.** ${contenido.titulo || archivo.replace('.json', '')}\n`;
        lista += `   🆔 ID: \`${contenido.id || 'sin_id'}\`\n`;
        lista += `   📅 Creada: ${fecha} | 👤 ${contenido.creador || 'N/A'} | ❓ ${contenido.preguntas?.length || 0} preguntas\n\n`;
      } catch (e) {
        lista += `**${index + 1}.** ${archivo.replace('.json', '')} *(error al leer detalles)*\n\n`;
      }
    });

    await context.sendActivity(lista);
  } catch (error) {
    console.error('Error al listar encuestas:', error);
    await context.sendActivity("❌ Error al acceder a las encuestas guardadas.");
  }
});

// Comando de ayuda
app.message(/^ayuda|help$/i, async (context, state) => {
  const ayuda = `🤖 **TeamPulse - Comandos disponibles:**

**📝 Crear encuestas:**
• "Quiero crear una encuesta"
• "Ayuda con una encuesta de clima laboral"
• "Necesito hacer preguntas de satisfacción"

**📋 Ver encuestas:**
• "listar" - Ver todas las encuestas guardadas
• "mostrar_encuestas" - Mismo comando anterior

**📊 Ver resultados:**
• "resultados [ID]" - Ver resultados de una encuesta
• Ejemplo: \`resultados clima_1234567_abc123\`

**🧪 Pruebas:**
• "test_encuesta" - Crear encuesta de prueba
• "ayuda" - Mostrar este mensaje

**💡 Ejemplos de uso:**
• *"Crear encuesta de satisfacción laboral"*
• *"Encuesta sobre la nueva oficina"*
• *"Feedback del último proyecto"*

¡Empezá creando tu primera encuesta! 🚀`;

  await context.sendActivity(ayuda);
});

// Manejo de errores del feedback loop
app.feedbackLoop(async (context, state, feedbackLoopData) => {
  console.log("📢 Feedback recibido:", JSON.stringify(feedbackLoopData, null, 2));
  console.log("💬 Actividad completa:", JSON.stringify(context.activity, null, 2));
});

// Manejo de errores generales
app.error(async (context, error) => {
  console.error(`💥 Error general de la aplicación:`, error);
  await context.sendActivity("❌ Ocurrió un error inesperado. Por favor, intenta nuevamente o contacta al administrador.");
});

// AGREGAR ESTE ÚNICO COMANDO al final de src/app/app.ts
// (antes del export default app)

// MICRO-PASO 1: Solo un comando simple para responder encuestas
app.message(/^responder_encuesta\s+([^\s]+)\s+(\d+)\s+(.+)$/i, async (context, state) => {
  console.log('🎯 Comando responder_encuesta ejecutado');
  
  try {
    const match = context.activity.text.match(/^responder_encuesta\s+([^\s]+)\s+(\d+)\s+(.+)$/i);
    
    if (!match) {
      await context.sendActivity("❌ **Formato incorrecto**\n\nUsa: `responder_encuesta [ID_encuesta] [número_pregunta] [tu_respuesta]`\n\nEjemplo: `responder_encuesta encuestaso_1748980691593_288msj 1 Si`");
      return;
    }
    
    const encuestaId = match[1].trim();
    const numeroPregunta = parseInt(match[2]);
    const respuestaTexto = match[3].trim();
    const preguntaIndex = numeroPregunta - 1; // Convertir a índice
    
    console.log(`📝 Datos: ID=${encuestaId}, Pregunta=${numeroPregunta}, Respuesta=${respuestaTexto}`);
    
    // Buscar la encuesta
    const dataDir = path.join(__dirname, '../../data');
    const archivosEncuestas = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    
    let encuestaEncontrada: Encuesta | null = null;
    for (const archivo of archivosEncuestas) {
      try {
        const contenido = JSON.parse(fs.readFileSync(path.join(dataDir, archivo), 'utf-8'));
        if (contenido.id === encuestaId) {
          encuestaEncontrada = contenido;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!encuestaEncontrada) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    // Validar número de pregunta
    if (preguntaIndex < 0 || preguntaIndex >= encuestaEncontrada.preguntas.length) {
      await context.sendActivity(`❌ **Pregunta inválida**: ${numeroPregunta}\n\nLa encuesta "${encuestaEncontrada.titulo}" tiene ${encuestaEncontrada.preguntas.length} pregunta(s).`);
      return;
    }

    const pregunta = encuestaEncontrada.preguntas[preguntaIndex];
    
    // Validar que la respuesta sea una de las opciones válidas
    const opcionValida = pregunta.opciones.find(opcion => 
      opcion.toLowerCase() === respuestaTexto.toLowerCase()
    );
    
    if (!opcionValida) {
      await context.sendActivity(`❌ **Respuesta inválida**: "${respuestaTexto}"\n\n**Opciones válidas para la pregunta ${numeroPregunta}:**\n${pregunta.opciones.map(op => `• ${op}`).join('\n')}`);
      return;
    }

    // Cargar resultados existentes
    let resultados = cargarResultados(encuestaId);
    if (!resultados) {
      await context.sendActivity(`❌ **Error**: No se encontraron datos de resultados para esta encuesta.`);
      return;
    }

    // Crear hash anónimo para el participante
    const userId = context.activity.from.id;
    const participanteAnonimo = crearParticipanteAnonimo(userId, encuestaId);

    // Verificar si ya respondió esta pregunta
    const respuestaExistente = resultados.respuestas.find(
      r => r.participanteId === participanteAnonimo && r.preguntaIndex === preguntaIndex
    );

    if (respuestaExistente) {
      // Actualizar respuesta existente
      respuestaExistente.respuesta = opcionValida;
      respuestaExistente.timestamp = new Date();
      console.log(`🔄 Respuesta actualizada para pregunta ${numeroPregunta}`);
    } else {
      // Agregar nueva respuesta
      const nuevaRespuesta: Respuesta = {
        participanteId: participanteAnonimo,
        preguntaIndex: preguntaIndex,
        respuesta: opcionValida,
        timestamp: new Date()
      };
      resultados.respuestas.push(nuevaRespuesta);
      console.log(`✅ Nueva respuesta agregada para pregunta ${numeroPregunta}`);
    }

    // Guardar resultados actualizados
    guardarResultados(resultados);

    // Confirmar al usuario
    const confirmacion = `✅ **¡Respuesta guardada exitosamente!**

📋 **Encuesta:** ${encuestaEncontrada.titulo}
❓ **Pregunta ${numeroPregunta}:** ${pregunta.pregunta}
💬 **Tu respuesta:** ${opcionValida}

🎯 **Ver resultados actualizados:** \`resultados ${encuestaId}\`
📝 **Responder otra pregunta:** \`responder_encuesta ${encuestaId} [número] [respuesta]\``;
    
    await context.sendActivity(confirmacion);
    console.log(`✅ Respuesta procesada exitosamente`);

  } catch (error) {
    console.error('❌ Error en responder_encuesta:', error);
    await context.sendActivity("❌ Error interno al procesar tu respuesta. Intenta nuevamente o contacta al administrador.");
  }
});

// AGREGAR ESTE SEGUNDO COMANDO al final de src/app/app.ts
// (después del comando anterior, antes del export default app)

// MICRO-PASO 2: Comando más amigable para mostrar encuesta y opciones
app.message(/^responder\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^responder\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`responder [ID_encuesta]`\n\nEjemplo: `responder encuestaso_1748980691593_288msj`");
    return;
  }

  const encuestaId = match[1].trim();
  console.log(`🎯 Usuario quiere responder encuesta: ${encuestaId}`);

  try {
    // Buscar la encuesta
    const dataDir = path.join(__dirname, '../../data');
    const archivosEncuestas = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    
    let encuestaEncontrada: Encuesta | null = null;
    for (const archivo of archivosEncuestas) {
      try {
        const contenido = JSON.parse(fs.readFileSync(path.join(dataDir, archivo), 'utf-8'));
        if (contenido.id === encuestaId) {
          encuestaEncontrada = contenido;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!encuestaEncontrada) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    // Verificar estado de la encuesta
    const resultados = cargarResultados(encuestaId);
    if (resultados && resultados.estado === 'cerrada') {
      await context.sendActivity(`🔒 **Encuesta cerrada**: "${encuestaEncontrada.titulo}"\n\nEsta encuesta ya no acepta respuestas.`);
      return;
    }

    // Mostrar encuesta con formato amigable
    let mensaje = `📋 **${encuestaEncontrada.titulo}**\n`;
    mensaje += `🎯 **Objetivo:** ${encuestaEncontrada.objetivo}\n\n`;
    mensaje += `**❓ Preguntas disponibles:**\n\n`;

    encuestaEncontrada.preguntas.forEach((pregunta, index) => {
      mensaje += `**${index + 1}.** ${pregunta.pregunta}\n`;
      mensaje += `**Opciones:** ${pregunta.opciones.join(' | ')}\n\n`;
    });

    mensaje += `**📝 Para responder:**\n`;
    mensaje += `\`responder_encuesta ${encuestaId} [número_pregunta] [tu_respuesta]\`\n\n`;
    mensaje += `**💡 Ejemplos:**\n`;
    mensaje += `• \`responder_encuesta ${encuestaId} 1 ${encuestaEncontrada.preguntas[0].opciones[0]}\`\n`;
    if (encuestaEncontrada.preguntas.length > 1) {
      mensaje += `• \`responder_encuesta ${encuestaId} 2 ${encuestaEncontrada.preguntas[1].opciones[0]}\`\n`;
    }
    mensaje += `\n🆔 **ID:** \`${encuestaId}\``;

    await context.sendActivity(mensaje);
    console.log(`✅ Encuesta mostrada para responder: ${encuestaId}`);

  } catch (error) {
    console.error('❌ Error al mostrar encuesta:', error);
    await context.sendActivity("❌ Error al cargar la encuesta. Verifica que el ID sea correcto.");
  }
});

// AGREGAR ESTE ANÁLISIS INTELIGENTE SIMPLE al final de src/app/app.ts

// ANÁLISIS INTELIGENTE SIN APIs COMPLEJAS
app.message(/^analizar\s+(.+)$/i, async (context, state) => {
  const match = context.activity.text.match(/^analizar\s+(.+)$/i);
  
  if (!match || !match[1]) {
    await context.sendActivity("❌ **Uso correcto:**\n`analizar [ID_encuesta]`\n\nEjemplo: `analizar encuestaso_1748980691593_288msj`");
    return;
  }

  const encuestaId = match[1].trim();
  console.log(`📊 Iniciando análisis inteligente para: ${encuestaId}`);

  try {
    // Cargar encuesta
    const dataDir = path.join(__dirname, '../../data');
    const archivosEncuestas = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    
    let encuestaOriginal: Encuesta | null = null;
    for (const archivo of archivosEncuestas) {
      try {
        const contenido = JSON.parse(fs.readFileSync(path.join(dataDir, archivo), 'utf-8'));
        if (contenido.id === encuestaId) {
          encuestaOriginal = contenido;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!encuestaOriginal) {
      await context.sendActivity(`❌ **Encuesta no encontrada**: \`${encuestaId}\`\n\nUsa \`listar\` para ver encuestas disponibles.`);
      return;
    }

    let resultados = cargarResultados(encuestaId);
    if (!resultados) {
      await context.sendActivity(`❌ **Error**: No se encontraron datos de resultados.`);
      return;
    }

    calcularResumen(resultados, encuestaOriginal);

    if (resultados.totalParticipantes === 0) {
      await context.sendActivity(`📊 **Sin datos para analizar**\n\nLa encuesta "${encuestaOriginal.titulo}" no tiene respuestas aún.\n\nPara responder: \`responder ${encuestaId}\``);
      return;
    }

    await context.sendActivity("🧠 **Generando análisis inteligente...**");

    // ANÁLISIS INTELIGENTE SIN LLAMADAS EXTERNAS
    let analisis = `🧠 **Análisis Inteligente: ${encuestaOriginal.titulo}**\n\n`;
    
    // Datos generales
    analisis += `📊 **RESUMEN EJECUTIVO:**\n`;
    analisis += `• **Participantes:** ${resultados.totalParticipantes} ${resultados.totalParticipantes === 1 ? 'persona' : 'personas'}\n`;
    analisis += `• **Tasa de respuesta:** ${resultados.totalParticipantes > 0 ? 'Datos disponibles' : 'Sin respuestas'}\n`;
    analisis += `• **Fecha análisis:** ${new Date().toLocaleDateString()}\n\n`;

    // Análisis por pregunta
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
        // Encontrar respuesta más popular
        const respuestasOrdenadas = Object.entries(respuestasPregunta)
          .sort(([,a], [,b]) => (b as number) - (a as number));
        
        const [respuestaMasVotada, votosMax] = respuestasOrdenadas[0];
        const porcentajeMax = Math.round(((votosMax as number) / totalRespuestas) * 100);
        
        analisis += `   🏆 **Respuesta principal:** "${respuestaMasVotada}" (${porcentajeMax}%)\n`;
        
        // Análisis de consenso
        if (porcentajeMax >= 80) {
          analisis += `   💪 **Alto consenso** - Clara preferencia mayoritaria\n`;
          recomendaciones.push(`Pregunta ${index + 1}: Aprovechar el fuerte consenso hacia "${respuestaMasVotada}"`);
        } else if (porcentajeMax >= 60) {
          analisis += `   ⚖️ **Consenso moderado** - Mayoría clara pero con diversidad\n`;
        } else if (porcentajeMax < 40) {
          analisis += `   🤔 **Opiniones divididas** - No hay consenso claro\n`;
          alertas.push(`Pregunta ${index + 1}: Opiniones muy divididas requieren atención`);
        }
        
        // Mostrar distribución
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

    // Análisis específico por tipo de encuesta
    const tituloLower = encuestaOriginal.titulo.toLowerCase();
    if (tituloLower.includes('mascota') || tituloLower.includes('oficina')) {
      analisis += `🐕 **ANÁLISIS ESPECÍFICO - MASCOTAS EN OFICINA:**\n`;
      
      // Buscar patrones específicos
      const primeraRespuesta = resultados.resumen![0] ? Object.entries(resultados.resumen![0])
        .sort(([,a], [,b]) => (b as number) - (a as number))[0] : null;
      
      if (primeraRespuesta) {
        const [respuesta, votos] = primeraRespuesta;
        if (respuesta.toLowerCase().includes('sí') || respuesta.toLowerCase().includes('si')) {
          analisis += `• ✅ **Receptividad positiva** a mascotas en la oficina\n`;
          recomendaciones.push('Considerar programa piloto de mascotas en oficina');
        } else if (respuesta.toLowerCase().includes('no')) {
          analisis += `• ❌ **Resistencia** a mascotas en la oficina\n`;
          recomendaciones.push('Investigar preocupaciones específicas antes de implementar');
        }
      }
    }

    // Recomendaciones inteligentes
    if (recomendaciones.length > 0) {
      analisis += `\n💡 **RECOMENDACIONES ESTRATÉGICAS:**\n`;
      recomendaciones.forEach((rec, i) => {
        analisis += `${i + 1}. ${rec}\n`;
      });
    }

    // Alertas importantes
    if (alertas.length > 0) {
      analisis += `\n⚠️ **PUNTOS DE ATENCIÓN:**\n`;
      alertas.forEach((alerta, i) => {
        analisis += `${i + 1}. ${alerta}\n`;
      });
    }

    // Siguientes pasos
    analisis += `\n🎯 **PRÓXIMOS PASOS:**\n`;
    if (resultados.totalParticipantes < 5) {
      analisis += `• Aumentar participación para obtener datos más representativos\n`;
    }
    analisis += `• Monitorear tendencias con futuras encuestas\n`;
    analisis += `• Compartir resultados con stakeholders relevantes\n`;
    
    analisis += `\n📋 **Datos detallados:** \`resultados ${encuestaId}\`\n`;
    analisis += `🔄 **Actualizar análisis:** \`analizar ${encuestaId}\``;

    await context.sendActivity(analisis);
    console.log(`✅ Análisis inteligente completado para: ${encuestaId}`);

  } catch (error) {
    console.error('❌ Error en análisis inteligente:', error);
    await context.sendActivity(`❌ Error al generar análisis. Usa \`resultados ${encuestaId}\` para ver datos básicos.`);
  }
});

// COMANDO DE MIGRACIÓN (ejecutar solo una vez)
app.message(/^migrar_azure$/i, async (context, state) => {
  await context.sendActivity("🔄 **Iniciando migración a Azure Tables...**\n\nEsto puede tardar unos momentos...");
  
  try {
    const { migrarDatosJSON } = await import('../services/azureTableService');
    await migrarDatosJSON();
    await context.sendActivity("🎉 **¡Migración completada exitosamente!**\n\nTodos los datos ahora están en Azure Table Storage.");
  } catch (error) {
    console.error('Error en migración:', error);
    await context.sendActivity("❌ **Error en migración**: " + error.message);
  }
});

export default app;