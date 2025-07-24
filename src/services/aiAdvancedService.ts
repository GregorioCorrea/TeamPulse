import config from "../config";
import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// Interface para el resultado del análisis
export interface AdvancedAnalysisResult {
  encuestaId: string;
  tenantId: string;
  
  // Sentimiento detallado
  sentimiento: {
    general: 'positivo' | 'neutral' | 'negativo';
    scores: {
      positivo: number;
      neutral: number; 
      negativo: number;
    };
    confianza: number;
  };
  
  // Insights estratégicos
  insights: {
    patronesClave: string[];
    riesgosIdentificados: string[];
    oportunidadesMejora: string[];
    fortalezasDetectadas: string[];
  };
  
  // Recomendaciones priorizadas
  recomendaciones: {
    criticas: Array<{accion: string, plazo: string, impacto: string}>;
    importantes: Array<{accion: string, plazo: string, impacto: string}>;
    sugeridas: Array<{accion: string, plazo: string, impacto: string}>;
  };
  
  // Alertas automáticas
  alertas: Array<{
    tipo: 'riesgo' | 'oportunidad' | 'tendencia';
    severidad: 'alta' | 'media' | 'baja';
    mensaje: string;
    accionRecomendada: string;
  }>;
  
  // Comparación con benchmarks
  benchmark?: {
    industria: string;
    posicionRelativo: 'superior' | 'promedio' | 'inferior';
    percentil: number;
    mensaje: string;
  };
  
  // Metadatos
  fechaAnalisis: string;
  modeloUsado: string;
  confiabilidad: number;
  participantes: number;
}

// Configuración de conexión a Azure
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const key = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const cred = new AzureNamedKeyCredential(account, key);

const analisisTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "AnalisisAvanzado",
  cred
);

const benchmarksTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "Benchmarks", 
  cred
);

const historialTable = new TableClient(
  `https://${account}.table.core.windows.net`,
  "HistorialMetricas",
  cred
);

export class AdvancedAnalysisService {
  
  /**
   * 🧠 Genera análisis avanzado completo de una encuesta
   */
  async generateAdvancedAnalysis(
    encuestaId: string,
    encuestaTitulo: string,
    datosEncuesta: any[],
    tenantId: string,
    totalParticipantes: number
  ): Promise<AdvancedAnalysisResult> {
    
    try {
      console.log(`🧠 Iniciando análisis avanzado para: ${encuestaTitulo}`);
      
      // 1. Verificar si ya existe análisis reciente (menos de 6 horas)
      const analisisExistente = await this.getExistingAnalysis(encuestaId, tenantId);
      if (analisisExistente) {
        console.log(`✅ Usando análisis existente (cache 6h)`);
        return analisisExistente;
      }
      
      // 2. Preparar contexto para GPT-4
      const contextoAnalisis = this.prepararContextoAvanzado(
        encuestaTitulo, 
        datosEncuesta, 
        totalParticipantes
      );
      
      // 3. Crear prompt especializado
      const promptAvanzado = this.crearPromptEstrategico(contextoAnalisis);
      
      // 4. Llamar a Azure OpenAI GPT-4
      const respuestaIA = await this.llamarGPT4Analisis(promptAvanzado);
      
      // 5. Procesar y estructurar resultado
      const analisisEstructurado = this.procesarRespuestaIA(
        respuestaIA, 
        encuestaId, 
        tenantId,
        totalParticipantes
      );
      
      // 6. Comparar con benchmarks (si disponible)
      await this.agregarBenchmarkComparison(analisisEstructurado);
      
      // 7. Detectar alertas automáticas
      await this.detectarAlertas(analisisEstructurado, datosEncuesta);
      
      // 8. Guardar análisis en Azure
      await this.guardarAnalisisAvanzado(analisisEstructurado);
      
      // 9. Actualizar historial de métricas
      await this.actualizarHistorialMetricas(analisisEstructurado);
      
      console.log(`✅ Análisis avanzado completado: ${encuestaId}`);
      return analisisEstructurado;
      
    } catch (error) {
      console.error('❌ Error en análisis avanzado:', error);
      throw new Error(`Error generando análisis avanzado: ${error.message}`);
    }
  }
  
  /**
   * 📊 Prepara contexto detallado para análisis
   */
  private prepararContextoAvanzado(
    titulo: string, 
    datos: any[], 
    participantes: number
  ): string {
    
    let contexto = `ENCUESTA: "${titulo}"\n`;
    contexto += `PARTICIPANTES: ${participantes}\n`;
    contexto += `ENGAGEMENT: ${participantes > 50 ? 'ALTO' : participantes > 20 ? 'MEDIO' : 'BAJO'}\n\n`;
    
    contexto += `=== ANÁLISIS DETALLADO POR PREGUNTA ===\n`;
    
    datos.forEach((item, index) => {
      const totalRespuestas = Object.values(item.resultados).reduce((a, b) => (a as number) + (b as number), 0) as number;      
      
      contexto += `\nPREGUNTA ${index + 1}: ${item.pregunta}\n`;
      contexto += `Total respuestas: ${totalRespuestas}\n`;
      
      // Calcular distribución y patrones
      let respuestaDominante = '';
      let maxVotos = 0;
      let distribucionCompleta = '';
      
      item.opciones.forEach((opcion: string) => {
        const cantidad = item.resultados[opcion] || 0;
        const porcentaje = (totalRespuestas as number) > 0 ? Math.round((cantidad / (totalRespuestas as number)) * 100) : 0;
        
        distribucionCompleta += `  • ${opcion}: ${cantidad} votos (${porcentaje}%)\n`;
        
        if (cantidad > maxVotos) {
          maxVotos = cantidad;
          respuestaDominante = opcion;
        }
      });
      
      contexto += distribucionCompleta;
      
      // Análisis de consenso
      const porcentajeDominante = totalRespuestas > 0 ? Math.round((maxVotos / totalRespuestas) * 100) : 0;
      
      if (porcentajeDominante >= 70) {
        contexto += `  → CONSENSO FUERTE (${porcentajeDominante}%): "${respuestaDominante}"\n`;
      } else if (porcentajeDominante >= 50) {
        contexto += `  → CONSENSO MODERADO (${porcentajeDominante}%): "${respuestaDominante}"\n`;
      } else {
        contexto += `  → OPINIONES DIVIDIDAS: Sin consenso claro (máx: ${porcentajeDominante}%)\n`;
      }
      
      // Detectar patrones preocupantes
      const opcionesNegativas = item.opciones.filter((op: string) => 
        op.toLowerCase().includes('malo') || 
        op.toLowerCase().includes('nunca') ||
        op.toLowerCase().includes('deficiente') ||
        op.toLowerCase().includes('no')
      );
      
      const votosNegativos = opcionesNegativas.reduce((sum, op) => 
        sum + (item.resultados[op] || 0), 0
      );
      
      const porcentajeNegativo = totalRespuestas > 0 ? Math.round((votosNegativos / totalRespuestas) * 100) : 0;
      
      if (porcentajeNegativo >= 30) {
        contexto += `  ⚠️ SEÑAL DE ALERTA: ${porcentajeNegativo}% respuestas negativas\n`;
      }
    });
    
    return contexto;
  }
  
  /**
   * 🎯 Crea prompt estratégico para GPT-4
   */
  private crearPromptEstrategico(contexto: string): string {
    return `Eres un consultor senior en People Analytics con 20+ años de experiencia analizando encuestas organizacionales para Fortune 500.

Tu especialidad es convertir datos de encuestas en insights estratégicos que los C-levels puedan actuar inmediatamente.

DATOS DE LA ENCUESTA:
${contexto}

MISIÓN: Analiza estos resultados como consultor McKinsey/Deloitte y proporciona:

1. **DIAGNÓSTICO EJECUTIVO**: ¿Qué story crítica cuentan estos datos? ¿Cuál es el mensaje central?

2. **PATRONES ESTRATÉGICOS**: Identifica 3-4 patrones que impacten el negocio (no solo HR)

3. **EVALUACIÓN DE RIESGOS**: ¿Qué riesgos organizacionales detectas? Prioriza por impacto al negocio

4. **OPORTUNIDADES DE VALOR**: ¿Qué oportunidades para crear valor competitivo identificas?

5. **ROADMAP EJECUTIVO**: Prioriza acciones por impacto vs esfuerzo
   - CRÍTICAS (1-2 semanas): ¿Qué no puede esperar?
   - IMPORTANTES (1-3 meses): ¿Qué mueve la aguja?
   - ESTRATÉGICAS (3-6 meses): ¿Qué transforma la organización?

6. **ALERTAS AUTOMÁTICAS**: ¿Qué métricas trackear para early warning?

7. **SENTIMIENTO ORGANIZACIONAL**: Evaluación general con score numérico

RESPONDE EN JSON VÁLIDO con esta estructura EXACTA:
{
  "diagnostico": "Mensaje ejecutivo en 2-3 oraciones",
  "sentimiento": {
    "general": "positivo|neutral|negativo", 
    "scores": {"positivo": 75, "neutral": 15, "negativo": 10},
    "confianza": 88
  },
  "patrones": ["Patrón 1 con impacto al negocio", "Patrón 2...", "Patrón 3..."],
  "riesgos": ["Riesgo 1 priorizados por impacto", "Riesgo 2...", "Riesgo 3..."],
  "oportunidades": ["Oportunidad 1 de valor", "Oportunidad 2...", "Oportunidad 3..."],
  "fortalezas": ["Fortaleza 1 organizacional", "Fortaleza 2...", "Fortaleza 3..."],
  "recomendaciones": {
    "criticas": [
      {"accion": "Acción específica", "plazo": "1-2 semanas", "impacto": "Impacto esperado"}
    ],
    "importantes": [
      {"accion": "Iniciativa", "plazo": "1-3 meses", "impacto": "Resultado esperado"}
    ],
    "estrategicas": [
      {"accion": "Transformación", "plazo": "3-6 meses", "impacto": "Cambio organizacional"}
    ]
  },
  "alertas": [
    {"tipo": "riesgo", "severidad": "alta", "mensaje": "Descripción", "accionRecomendada": "Qué hacer"}
  ],
  "metricas_seguimiento": ["Métrica 1", "Métrica 2", "Métrica 3"]
}

CRÍTICO: Responde SOLO con JSON válido. No agregues texto antes o después.`;
  }
  
  /**
   * 🔗 Llama a Azure OpenAI GPT-4
   */
  private async llamarGPT4Analisis(prompt: string): Promise<any> {
    
    const openAIUrl = `${config.azureOpenAIEndpoint}/openai/deployments/${config.azureOpenAIDeploymentName}/chat/completions?api-version=2023-07-01-preview`;
    
    const response = await fetch(openAIUrl, {
      method: "POST",
      headers: {
        "api-key": config.azureOpenAIKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          { 
            role: "system", 
            content: "Eres un consultor senior experto en People Analytics. Respondes SOLO en JSON válido, sin texto adicional." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.3,
        response_format: { "type": "json_object" }
      })
    });
    
    const data = await response.json() as any;
    
    if (!data.choices || !data.choices[0]?.message?.content) {
      throw new Error("Respuesta inválida de Azure OpenAI");
    }
    
    return JSON.parse(data.choices[0].message.content);
  }
  
  /**
   * 🔄 Procesa respuesta de IA y estructura resultado
   */
  private procesarRespuestaIA(
    respuestaIA: any,
    encuestaId: string, 
    tenantId: string,
    participantes: number
  ): AdvancedAnalysisResult {
    
    return {
      encuestaId,
      tenantId,
      
      sentimiento: {
        general: respuestaIA.sentimiento.general,
        scores: respuestaIA.sentimiento.scores,
        confianza: respuestaIA.sentimiento.confianza
      },
      
      insights: {
        patronesClave: respuestaIA.patrones || [],
        riesgosIdentificados: respuestaIA.riesgos || [],
        oportunidadesMejora: respuestaIA.oportunidades || [],
        fortalezasDetectadas: respuestaIA.fortalezas || []
      },
      
      recomendaciones: respuestaIA.recomendaciones || {
        criticas: [],
        importantes: [], 
        sugeridas: []
      },
      
      alertas: respuestaIA.alertas || [],
      
      // Metadatos
      fechaAnalisis: new Date().toISOString(),
      modeloUsado: 'gpt-4-mini',
      confiabilidad: this.calcularConfiabilidad(participantes, respuestaIA),
      participantes
    };
  }
  
  /**
   * 📊 Verifica análisis existente (cache 6 horas)
   */
  private async getExistingAnalysis(
    encuestaId: string, 
    tenantId: string
  ): Promise<AdvancedAnalysisResult | null> {
    
    try {
      const entities = analisisTable.listEntities({
        queryOptions: { 
          filter: `PartitionKey eq '${tenantId}' and encuestaId eq '${encuestaId}'` 
        }
      });
      
      for await (const entity of entities) {
        const fechaAnalisis = new Date(entity.fechaAnalisis as string);
        const horasTranscurridas = Math.abs(new Date().getTime() - fechaAnalisis.getTime()) / 36e5;
        
        // Si tiene menos de 6 horas, usar cache
        if (horasTranscurridas < 6) {
          return {
            encuestaId: entity.encuestaId as string,
            tenantId: entity.tenantId as string,
            sentimiento: JSON.parse(entity.sentimentoDetallado as string),
            insights: {
              patronesClave: JSON.parse(entity.patronesIdentificados as string),
              riesgosIdentificados: JSON.parse(entity.riesgosDetectados as string),
              oportunidadesMejora: JSON.parse(entity.oportunidadesMejora as string || '[]'),
              fortalezasDetectadas: JSON.parse(entity.fortalezasDetectadas as string || '[]')
            },
            recomendaciones: JSON.parse(entity.recomendacionesPriorizadas as string),
            alertas: JSON.parse(entity.alertas as string),
            benchmark: JSON.parse(entity.benchmarkComparison as string || 'null'),
            fechaAnalisis: entity.fechaAnalisis as string,
            modeloUsado: entity.modeloUsado as string,
            confiabilidad: entity.confiabilidad as number,
            participantes: entity.participantes as number
          };
        }
      }
      
      return null;
    } catch (error) {
      console.log('📝 No se encontró análisis existente');
      return null;
    }
  }
  
  /**
   * 💾 Guarda análisis en Azure Tables
   */
  private async guardarAnalisisAvanzado(analisis: AdvancedAnalysisResult): Promise<void> {
    
    try {
      const entity = {
        partitionKey: analisis.tenantId,
        rowKey: `${analisis.encuestaId}_${Date.now()}`,
        encuestaId: analisis.encuestaId,
        tenantId: analisis.tenantId,
        
        // Datos serializados
        sentimentoDetallado: JSON.stringify(analisis.sentimiento),
        patronesIdentificados: JSON.stringify(analisis.insights.patronesClave),
        riesgosDetectados: JSON.stringify(analisis.insights.riesgosIdentificados),
        oportunidadesMejora: JSON.stringify(analisis.insights.oportunidadesMejora),
        fortalezasDetectadas: JSON.stringify(analisis.insights.fortalezasDetectadas),
        recomendacionesPriorizadas: JSON.stringify(analisis.recomendaciones),
        alertas: JSON.stringify(analisis.alertas),
        benchmarkComparison: JSON.stringify(analisis.benchmark || null),
        
        // Metadatos
        fechaAnalisis: analisis.fechaAnalisis,
        ultimaActualizacion: new Date().toISOString(),
        modeloUsado: analisis.modeloUsado,
        confiabilidad: analisis.confiabilidad,
        participantes: analisis.participantes
      };
      
      await analisisTable.upsertEntity(entity);
      console.log(`✅ Análisis avanzado guardado: ${analisis.encuestaId}`);
      
    } catch (error) {
      console.error('❌ Error guardando análisis avanzado:', error);
      throw error;
    }
  }
  
  /**
   * 🏆 Agregar comparación con benchmarks
   */
  private async agregarBenchmarkComparison(analisis: AdvancedAnalysisResult): Promise<void> {
    
    try {
      // Detectar tipo de encuesta por patrones en insights
      let industria = 'general';
      const patrones = analisis.insights.patronesClave.join(' ').toLowerCase();
      
      if (patrones.includes('clima') || patrones.includes('satisfac') || patrones.includes('laboral')) {
        industria = 'hr_satisfaction';
      } else if (patrones.includes('nps') || patrones.includes('cliente') || patrones.includes('recomend')) {
        industria = 'customer_nps';
      } else if (patrones.includes('capacit') || patrones.includes('entrena') || patrones.includes('curso')) {
        industria = 'training_effectiveness';
      }
      
      // Buscar benchmark correspondiente
      const benchmark = await this.getBenchmark(industria, 'satisfaction_score');
      
      if (benchmark) {
        // Calcular score aproximado del sentimiento
        const score = analisis.sentimiento.scores.positivo - analisis.sentimiento.scores.negativo;
        
        let posicion: 'superior' | 'promedio' | 'inferior';
        let percentil = 50;
        
        if (score >= benchmark.percentil75) {
          posicion = 'superior';
          percentil = score >= benchmark.percentil90 ? 90 : 75;
        } else if (score <= benchmark.percentil25) {
          posicion = 'inferior'; 
          percentil = 25;
        } else {
          posicion = 'promedio';
          percentil = 50;
        }
        
        analisis.benchmark = {
          industria,
          posicionRelativo: posicion,
          percentil,
          mensaje: `Tu score de ${score} está en el percentil ${percentil} de la industria ${industria}`
        };
      }
      
    } catch (error) {
      console.warn('⚠️ Error comparando benchmarks:', error);
      // No es crítico, continuar sin benchmark
    }
  }
  
  /**
   * 🚨 Detecta alertas automáticas
   */
  private async detectarAlertas(
    analisis: AdvancedAnalysisResult, 
    datosEncuesta: any[]
  ): Promise<void> {
    
    // Alerta por sentimiento muy negativo
    if (analisis.sentimiento.scores.negativo >= 40) {
      analisis.alertas.push({
        tipo: 'riesgo',
        severidad: 'alta',
        mensaje: `${analisis.sentimiento.scores.negativo}% de sentimiento negativo detectado`,
        accionRecomendada: 'Revisar inmediatamente con liderazgo y planificar intervención'
      });
    }
    
    // Alerta por baja participación
    if (analisis.participantes < 10) {
      analisis.alertas.push({
        tipo: 'riesgo',
        severidad: 'media',
        mensaje: `Participación baja: solo ${analisis.participantes} respuestas`,
        accionRecomendada: 'Extender periodo de respuesta y enviar recordatorios'
      });
    }
    
    // Alerta por consenso muy bajo (opiniones muy divididas)
    const consensoBajo = datosEncuesta.some(item => {
        const total = Object.values(item.resultados).reduce((a, b) => (a as number) + (b as number), 0) as number;
        const maxVotos = Math.max(...Object.values(item.resultados).map(v => v as number));
        const porcentajeMax = (total as number) > 0 ? (maxVotos / (total as number)) * 100 : 0;
      return porcentajeMax < 35; // Ninguna opción tiene más del 35%
    });
    
    if (consensoBajo) {
      analisis.alertas.push({
        tipo: 'tendencia',
        severidad: 'media',
        mensaje: 'Opiniones muy divididas detectadas en varias preguntas',
        accionRecomendada: 'Realizar focus groups para entender las diferencias de perspectiva'
      });
    }
    
    // Alerta por alta confianza en resultado positivo (oportunidad)
    if (analisis.sentimiento.general === 'positivo' && 
        analisis.sentimiento.confianza >= 85 && 
        analisis.participantes >= 30) {
      analisis.alertas.push({
        tipo: 'oportunidad',
        severidad: 'baja',
        mensaje: 'Resultados consistentemente positivos con alta participación',
        accionRecomendada: 'Documentar y replicar buenas prácticas en otras áreas'
      });
    }
  }
  
  /**
   * 📈 Actualiza historial de métricas
   */
  private async actualizarHistorialMetricas(analisis: AdvancedAnalysisResult): Promise<void> {
    
    try {
      const fecha = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Guardar métrica de satisfacción
      const satisfactionScore = analisis.sentimiento.scores.positivo - analisis.sentimiento.scores.negativo;
      
      await historialTable.upsertEntity({
        partitionKey: analisis.tenantId,
        rowKey: `${fecha}_satisfaction_${analisis.encuestaId}`,
        encuestaId: analisis.encuestaId,
        metrica: 'satisfaction_score',
        valor: satisfactionScore,
        fecha: fecha,
        participantes: analisis.participantes
      });
      
      // Guardar métrica de engagement (participación)
      await historialTable.upsertEntity({
        partitionKey: analisis.tenantId,
        rowKey: `${fecha}_engagement_${analisis.encuestaId}`,
        encuestaId: analisis.encuestaId,
        metrica: 'engagement_rate',
        valor: analisis.participantes, // O calcular basado en invitados vs respuestas
        fecha: fecha,
        participantes: analisis.participantes
      });
      
      console.log(`✅ Historial de métricas actualizado: ${analisis.encuestaId}`);
      
    } catch (error) {
      console.error('❌ Error actualizando historial:', error);
      // No es crítico
    }
  }
  
  /**
   * 🎯 Calcula confiabilidad del análisis
   */
  private calcularConfiabilidad(participantes: number, respuestaIA: any): number {
    
    let confiabilidad = 50; // Base
    
    // Bonus por participación
    if (participantes >= 50) confiabilidad += 30;
    else if (participantes >= 20) confiabilidad += 20;
    else if (participantes >= 10) confiabilidad += 10;
    
    // Bonus por confianza del sentimiento
    if (respuestaIA.sentimiento?.confianza >= 80) confiabilidad += 15;
    else if (respuestaIA.sentimiento?.confianza >= 60) confiabilidad += 10;
    
    // Bonus por completitud de respuesta
    if (respuestaIA.patrones?.length >= 3) confiabilidad += 5;
    if (respuestaIA.recomendaciones?.criticas?.length >= 1) confiabilidad += 5;
    
    return Math.min(confiabilidad, 95); // Máximo 95%
  }
  
  /**
   * 📊 Obtiene benchmark de industria
   */
  private async getBenchmark(industria: string, metrica: string): Promise<any> {
    
    try {
      const entity = await benchmarksTable.getEntity(industria, metrica);
      return {
        promedio: entity.promedio as number,
        percentil25: entity.percentil25 as number,
        percentil50: entity.percentil50 as number, 
        percentil75: entity.percentil75 as number,
        percentil90: entity.percentil90 as number
      };
    } catch (error) {
      console.log(`📝 Benchmark no encontrado: ${industria}/${metrica}`);
      return null;
    }
  }
}

/**
 * 🌱 Función para crear benchmarks iniciales
 */
export async function crearBenchmarksIniciales(): Promise<void> {
  
  console.log('🌱 Creando benchmarks iniciales...');
  
  const benchmarks = [
    {
      partitionKey: 'hr_satisfaction',
      rowKey: 'satisfaction_score',
      metrica: 'satisfaction_score',
      promedio: 68,
      percentil25: 55,
      percentil50: 68,
      percentil75: 78,
      percentil90: 85,
      muestras: 1000,
      fechaActualizacion: new Date().toISOString()
    },
    {
      partitionKey: 'customer_nps',
      rowKey: 'satisfaction_score', 
      metrica: 'nps_score',
      promedio: 45,
      percentil25: 25,
      percentil50: 45,
      percentil75: 65,
      percentil90: 75,
      muestras: 800,
      fechaActualizacion: new Date().toISOString()
    },
    {
      partitionKey: 'training_effectiveness',
      rowKey: 'satisfaction_score',
      metrica: 'effectiveness_score',
      promedio: 72,
      percentil25: 60,
      percentil50: 72,
      percentil75: 82,
      percentil90: 88,
      muestras: 500,
      fechaActualizacion: new Date().toISOString()
    }
  ];
  
  for (const benchmark of benchmarks) {
    try {
      await benchmarksTable.upsertEntity(benchmark);
      console.log(`✅ Benchmark creado: ${benchmark.partitionKey}/${benchmark.metrica}`);
    } catch (error) {
      console.error(`❌ Error creando benchmark:`, error);
    }
  }
  
  console.log('🎉 Benchmarks iniciales completados!');
}