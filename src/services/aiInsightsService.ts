
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
  kpis?: string[]; // 🆕 AGREGAR
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
  }[],
  tenantId?: string
): Promise<EncuestaAnalisis> {
  try {
    // 1. Preparar los datos para la IA
    let prompt = `ANÁLISIS DE ENCUESTA: "${encuestaTitulo}" (ID: ${encuestaId})

    === CONTEXTO ORGANIZACIONAL ===
    Esta encuesta fue implementada para obtener insights accionables que permitan tomar decisiones estratégicas basadas en datos.

    === RESULTADOS DETALLADOS ===\n`;

    let totalRespuestas = 0;
    let patrones = [];

    datos.forEach((item, index) => {
      const respuestasPregunta = Object.values(item.resultados).reduce((a, b) => a + b, 0);
      totalRespuestas += respuestasPregunta;
      
      prompt += `\nPREGUNTA ${index + 1}: ${item.pregunta}\n`;
      
      // Calcular respuesta dominante
      let respuestaDominante = '';
      let maxVotos = 0;
      
      item.opciones.forEach(opcion => {
        const cantidad = item.resultados[opcion] || 0;
        const porcentaje = respuestasPregunta > 0 
          ? Math.round((cantidad / respuestasPregunta) * 100) 
          : 0;
        
        if (cantidad > maxVotos) {
          maxVotos = cantidad;
          respuestaDominante = opcion;
        }
        
        prompt += `• ${opcion}: ${cantidad} respuestas (${porcentaje}%)\n`;
      });
      
      // Agregar contexto de la respuesta dominante
      const porcentajeDominante = respuestasPregunta > 0 
        ? Math.round((maxVotos / respuestasPregunta) * 100) 
        : 0;
      
      prompt += `→ PATRÓN IDENTIFICADO: ${porcentajeDominante}% eligió "${respuestaDominante}"\n`;
      
      // Interpretar el patrón
      if (porcentajeDominante >= 70) {
        prompt += `→ NIVEL DE CONSENSO: ALTO (${porcentajeDominante}%) - Señal clara para actuar\n`;
      } else if (porcentajeDominante >= 50) {
        prompt += `→ NIVEL DE CONSENSO: MODERADO (${porcentajeDominante}%) - Investigar más a fondo\n`;
      } else {
        prompt += `→ NIVEL DE CONSENSO: BAJO (${porcentajeDominante}%) - Opiniones divididas, requiere análisis segmentado\n`;
      }
    });

    prompt += `\n=== MÉTRICAS CLAVE ===
    - Total de participantes únicos: ${totalRespuestas}
    - Tasa de respuesta por pregunta: ${Math.round(totalRespuestas / datos.length)} promedio
    - Nivel de engagement: ${totalRespuestas > 50 ? 'ALTO' : totalRespuestas > 20 ? 'MEDIO' : 'BAJO'}

    === SOLICITUD DE ANÁLISIS ===
    Como consultor experto, analiza estos resultados y proporciona:

    1. **DIAGNÓSTICO EJECUTIVO** (2-3 oraciones): ¿Qué story cuentan estos datos?

    2. **INSIGHTS ESTRATÉGICOS** (3-4 puntos clave): 
      - ¿Qué patrones críticos emergen?
      - ¿Qué riesgos organizacionales detectas?
      - ¿Qué oportunidades de mejora identificas?

    3. **ROADMAP DE ACCIONES** clasificado por urgencia:
      - **INMEDIATAS (1-2 semanas)**: Acciones críticas que no pueden esperar
      - **CORTO PLAZO (1-3 meses)**: Iniciativas importantes para implementar
      - **MEDIANO PLAZO (3-6 meses)**: Estrategias de transformación cultural

    4. **SENTIMIENTO ORGANIZACIONAL**: Basado en los patrones de respuesta

    5. **KPIs DE SEGUIMIENTO**: ¿Qué métricas trackear para medir mejoras?

    Responde en formato JSON con esta estructura exacta:
    {
      "resumen": "Diagnóstico ejecutivo en 2-3 oraciones que capture la situación actual",
      "insights": {
        "general": "Análisis estratégico de los patrones identificados y su impacto organizacional",
        "tendencias": [
          "Tendencia 1: Descripción específica con impacto",
          "Tendencia 2: Patrón identificado con contexto",
          "Tendencia 3: Señal organizacional clave"
        ],
        "recomendaciones": [
          "INMEDIATO - Acción: "[Acción específica]" → Impacto: [Impacto esperado] → Responsable: [Responsable] → Plazo: [1-2 semanas]",
          "CORTO PLAZO - Iniciativa: [Iniciativa] → Resultado: [Resultado esperado] → Responsable: [Owner] → Plazo: [1-3 meses]",
          "MEDIANO PLAZO - Estrategia: [Estrategia] → Resultado: [Transformación esperada] → Responsable: [Líder] → Plazo: [3-6 meses]"
        ]
      },
      "sentimiento": "positivo|neutral|negativo",
      "puntuacionNPS": null,
      "kpis": [
        "Métrica 1 a trackear mensualmente",
        "Métrica 2 para medir progreso",
        "Métrica 3 de impacto organizacional"
      ]
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
          { 
            role: "system", 
            content: `Eres un consultor senior en experiencia del empleado y análisis organizacional con 15+ años de experiencia. 

    Tu especialidad es convertir datos de encuestas en recomendaciones estratégicas accionables que los líderes puedan implementar inmediatamente.

    ENFOQUE:
    - Piensa como un Head of People/CHRO experimentado
    - Cada insight debe ser específico y medible
    - Las recomendaciones deben incluir plazos y responsables sugeridos
    - Identifica riesgos ocultos y oportunidades de mejora
    - Usa benchmarks de industria cuando sea relevante`
          },
          { 
            role: "user", 
            content: `${prompt}

    IMPORTANTE: Basándote en estos resultados específicos, proporciona recomendaciones que respondan a:

    1. **¿Qué acciones inmediatas (1-2 semanas) debe tomar el liderazgo?**
    2. **¿Qué iniciativas de mediano plazo (1-3 meses) implementar?**
    3. **¿Qué estrategias de largo plazo (3+ meses) considerar?**
    4. **¿Qué métricas seguir para medir el progreso?**
    5. **¿Qué riesgos específicos hay que mitigar?**

    Estructura cada recomendación como: "ACCIÓN ESPECÍFICA → IMPACTO ESPERADO → RESPONSABLE SUGERIDO → PLAZO"

    Ejemplo: "Implementar sesiones de feedback 1:1 semanales → Mejorar satisfacción en 15-20% → Managers directos → 2 semanas"` 
          }
        ],
        max_tokens: 1000, // 🆕 Aumentar para más detalle
        temperature: 0.3, // 🆕 Más creativo pero controlado
        response_format: { "type": "json_object" }
      })
    });

    const data = await openAIResponse.json() as any;
    
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
    await guardarAnalisisEnAzure(analisis, tenantId);
    
    return analisis;
  } catch (error) {
    console.error("❌ Error generando análisis con IA:", error);
    throw error;
  }
}

/**
 * Guarda el análisis en Azure Table
 */
async function guardarAnalisisEnAzure(analisis: EncuestaAnalisis, tenantId?: string): Promise<void> {
  try {
    const entity = {
      partitionKey: tenantId || "ANALISIS",
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
export async function obtenerAnalisisDesdeAzure(encuestaId: string, tenantId?: string): Promise<EncuestaAnalisis | null> {
  try {
    const partutionKey = tenantId || "ANALISIS";
    // Intentar obtener la entidad por partitionKey y rowKey
    const entity = await insightsTable.getEntity(partutionKey, encuestaId);
    
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