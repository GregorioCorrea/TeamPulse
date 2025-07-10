
import config from "../config";
import fetch from "node-fetch";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// Estructura de datos para el análisis
export interface EncuestaAnalisis {
  id: string;
  titulo: string;
  fecha: string;
  resumen: string;
  insights: {
    general: string;
    tendencias: string[];
    recomendaciones: string[];
  };
  sentimiento: "positivo" | "neutral" | "negativo";
  puntuacionNPS?: number;
  participacionPorDemografia?: Record<string, number>;
  ultimaActualizacion: string;
}

// Conexión a Azure Table
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const cred = new AzureNamedKeyCredential(account, key);

const insightsTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "EncuestaAnalisis",
  cred
);

// Inicializa la tabla si no existe
(async () => {
  try {
    await insightsTable.createTable();
    console.log("✅ Tabla EncuestaAnalisis inicializada");
  } catch (error) {
    // Tabla ya existe
  }
})();

/**
 * Genera un análisis detallado con IA para una encuesta específica
 */
export async function generarAnalisisIA(
  encuestaId: string,
  encuestaTitulo: string,
  datos: {
    pregunta: string;
    opciones: string[];
    resultados: Record<string, number>;
  }[]
): Promise<EncuestaAnalisis> {
  try {
    // 1. Preparar los datos para la IA
    let prompt = `Analiza los siguientes resultados de encuesta "${encuestaTitulo}" (ID: ${encuestaId}):\n\n`;
    
    let totalRespuestas = 0;
    datos.forEach(item => {
      const respuestasPregunta = Object.values(item.resultados).reduce((a, b) => a + b, 0);
      totalRespuestas += respuestasPregunta;
      
      prompt += `Pregunta: ${item.pregunta}\n`;
      item.opciones.forEach(opcion => {
        const cantidad = item.resultados[opcion] || 0;
        const porcentaje = respuestasPregunta > 0 
          ? Math.round((cantidad / respuestasPregunta) * 100) 
          : 0;
        prompt += `- ${opcion}: ${cantidad} respuestas (${porcentaje}%)\n`;
      });
      prompt += "\n";
    });
    
    prompt += `Total de respuestas: ${totalRespuestas}\n\n`;
    prompt += `Proporciona un análisis detallado que incluya:
1. Un resumen ejecutivo de los resultados (máximo 3 oraciones)
2. 3-5 insights clave de los datos
3. 2-3 tendencias identificables
4. 3 recomendaciones accionables basadas en los resultados
5. Sentimiento general (positivo, neutral o negativo)
6. Si es una encuesta NPS, calcula la puntuación NPS

Responde en formato JSON con esta estructura:
{
  "resumen": "Texto del resumen ejecutivo",
  "insights": {
    "general": "Texto con análisis general",
    "tendencias": ["tendencia 1", "tendencia 2", "tendencia 3"],
    "recomendaciones": ["recomendación 1", "recomendación 2", "recomendación 3"]
  },
  "sentimiento": "positivo|neutral|negativo",
  "puntuacionNPS": null
}`;

    // 2. Consultar a Azure OpenAI
    const openAIUrl = `${config.azureOpenAIEndpoint}/openai/deployments/${config.azureOpenAIDeploymentName}/chat/completions?api-version=2023-07-01-preview`;

    const openAIResponse = await fetch(openAIUrl, {
      method: "POST",
      headers: {
        "api-key": config.azureOpenAIKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "Eres un analista de datos experto especializado en encuestas y feedback." },
          { role: "user", content: prompt }
        ],
        max_tokens: 800,
        temperature: 0.2,
        response_format: { "type": "json_object" }
      })
    });

    const data = await openAIResponse.json();
    
    if (!data.choices || !data.choices[0]?.message?.content) {
      throw new Error("Respuesta inválida de Azure OpenAI");
    }
    
    // 3. Procesar respuesta
    const responseContent = data.choices[0].message.content;
    const analysisData = JSON.parse(responseContent);
    
    // 4. Crear objeto de análisis
    const analisis: EncuestaAnalisis = {
      id: encuestaId,
      titulo: encuestaTitulo,
      fecha: new Date().toISOString(),
      resumen: analysisData.resumen,
      insights: {
        general: analysisData.insights.general,
        tendencias: analysisData.insights.tendencias,
        recomendaciones: analysisData.insights.recomendaciones
      },
      sentimiento: analysisData.sentimiento,
      puntuacionNPS: analysisData.puntuacionNPS,
      ultimaActualizacion: new Date().toISOString()
    };
    
    // 5. Guardar en Azure Table
    await guardarAnalisisEnAzure(analisis);
    
    return analisis;
  } catch (error) {
    console.error("❌ Error generando análisis con IA:", error);
    throw error;
  }
}

/**
 * Guarda el análisis en Azure Table
 */
async function guardarAnalisisEnAzure(analisis: EncuestaAnalisis): Promise<void> {
  try {
    const entity = {
      partitionKey: "ANALISIS",
      rowKey: analisis.id,
      titulo: analisis.titulo,
      fecha: analisis.fecha,
      resumen: analisis.resumen,
      insightsGeneral: analisis.insights.general,
      insightsTendencias: JSON.stringify(analisis.insights.tendencias),
      insightsRecomendaciones: JSON.stringify(analisis.insights.recomendaciones),
      sentimiento: analisis.sentimiento,
      puntuacionNPS: analisis.puntuacionNPS || 0,
      ultimaActualizacion: analisis.ultimaActualizacion
    };

    await insightsTable.upsertEntity(entity);
    console.log(`✅ Análisis guardado en Azure: ${analisis.id}`);
  } catch (error) {
    console.error('❌ Error guardando análisis en Azure:', error);
    throw error;
  }
}

/**
 * Obtiene un análisis existente desde Azure Table
 */
export async function obtenerAnalisisDesdeAzure(encuestaId: string): Promise<EncuestaAnalisis | null> {
  try {
    const entity = await insightsTable.getEntity("ANALISIS", encuestaId);
    
    return {
      id: entity.rowKey as string,
      titulo: entity.titulo as string,
      fecha: entity.fecha as string,
      resumen: entity.resumen as string,
      insights: {
        general: entity.insightsGeneral as string,
        tendencias: JSON.parse(entity.insightsTendencias as string),
        recomendaciones: JSON.parse(entity.insightsRecomendaciones as string)
      },
      sentimiento: entity.sentimiento as "positivo" | "neutral" | "negativo",
      puntuacionNPS: entity.puntuacionNPS as number,
      ultimaActualizacion: entity.ultimaActualizacion as string
    };
  } catch (error) {
    console.log(`📝 Análisis no encontrado en Azure: ${encuestaId}`);
    return null;
  }
}