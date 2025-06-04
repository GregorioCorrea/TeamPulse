// CREAR ARCHIVO: src/services/azureTableService.ts

import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";

// Interfaces
interface AzureEncuesta {
  partitionKey: string;
  rowKey: string;
  titulo: string;
  objetivo: string;
  preguntas: string; // JSON stringified
  creador: string;
  fechaCreacion: string;
  estado: string;
}

interface AzureRespuesta {
  partitionKey: string;
  rowKey: string;
  encuestaId: string;
  participanteId: string;
  preguntaIndex: number;
  respuesta: string;
  timestamp: string;
}

interface AzureResultados {
  partitionKey: string;
  rowKey: string;
  encuestaId: string;
  titulo: string;
  fechaCreacion: string;
  estado: string;
  totalParticipantes: number;
  respuestas: string; // JSON stringified
  resumen: string; // JSON stringified
}

export class AzureTableService {
  private encuestasTable: TableClient;
  private respuestasTable: TableClient;
  private resultadosTable: TableClient;

  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    
    const credential = new AzureNamedKeyCredential(accountName, accountKey);
    
    this.encuestasTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'Encuestas',
      credential
    );
    
    this.respuestasTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'Respuestas',
      credential
    );
    
    this.resultadosTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'Resultados',
      credential
    );
  }

  // ENCUESTAS
  async guardarEncuesta(encuesta: any): Promise<string> {
    try {
      const entity: AzureEncuesta = {
        partitionKey: 'ENCUESTA',
        rowKey: encuesta.id,
        titulo: encuesta.titulo,
        objetivo: encuesta.objetivo,
        preguntas: JSON.stringify(encuesta.preguntas),
        creador: encuesta.creador || 'Usuario',
        fechaCreacion: encuesta.fechaCreacion || new Date().toISOString(),
        estado: 'activa'
      };

      await this.encuestasTable.createEntity(entity);
      console.log(`✅ Encuesta guardada en Azure: ${encuesta.id}`);
      return encuesta.id;
    } catch (error) {
      console.error('❌ Error guardando encuesta en Azure:', error);
      throw error;
    }
  }

  async cargarEncuesta(encuestaId: string): Promise<any | null> {
    try {
      const entity = await this.encuestasTable.getEntity('ENCUESTA', encuestaId);
      
      return {
        id: entity.rowKey,
        titulo: entity.titulo,
        objetivo: entity.objetivo,
        preguntas: JSON.parse(entity.preguntas as string),
        creador: entity.creador,
        fechaCreacion: entity.fechaCreacion
      };
    } catch (error) {
      console.log(`📝 Encuesta no encontrada en Azure: ${encuestaId}`);
      return null;
    }
  }

  async listarEncuestas(): Promise<any[]> {
    try {
      const entities = this.encuestasTable.listEntities({
        queryOptions: { filter: "PartitionKey eq 'ENCUESTA'" }
      });

      const encuestas = [];
      for await (const entity of entities) {
        encuestas.push({
          id: entity.rowKey,
          titulo: entity.titulo,
          objetivo: entity.objetivo,
          preguntas: JSON.parse(entity.preguntas as string),
          creador: entity.creador,
          fechaCreacion: entity.fechaCreacion
        });
      }

      return encuestas;
    } catch (error) {
      console.error('❌ Error listando encuestas:', error);
      return [];
    }
  }

  // RESULTADOS
 // REEMPLAZAR la función guardarResultados en src/services/azureTableService.ts

  async guardarResultados(resultados: any): Promise<void> {
    try {
      // Fix para fechas - convertir a Date si es string
      let fechaCreacion: string;
      if (typeof resultados.fechaCreacion === 'string') {
        fechaCreacion = resultados.fechaCreacion;
      } else if (resultados.fechaCreacion instanceof Date) {
        fechaCreacion = resultados.fechaCreacion.toISOString();
      } else {
        fechaCreacion = new Date().toISOString();
      }

      const entity: AzureResultados = {
        partitionKey: 'RESULTADO',
        rowKey: resultados.encuestaId,
        encuestaId: resultados.encuestaId,
        titulo: resultados.titulo,
        fechaCreacion: fechaCreacion,
        estado: resultados.estado,
        totalParticipantes: resultados.totalParticipantes,
        respuestas: JSON.stringify(resultados.respuestas),
        resumen: JSON.stringify(resultados.resumen || {})
      };

      await this.resultadosTable.upsertEntity(entity);
      console.log(`✅ Resultados guardados en Azure: ${resultados.encuestaId}`);
    } catch (error) {
      console.error('❌ Error guardando resultados en Azure:', error);
      throw error;
    }
  }

  async cargarResultados(encuestaId: string): Promise<any | null> {
    try {
      const entity = await this.resultadosTable.getEntity('RESULTADO', encuestaId);
      
      return {
        encuestaId: entity.encuestaId,
        titulo: entity.titulo,
        fechaCreacion: new Date(entity.fechaCreacion as string),
        estado: entity.estado,
        totalParticipantes: entity.totalParticipantes,
        respuestas: JSON.parse(entity.respuestas as string),
        resumen: JSON.parse(entity.resumen as string)
      };
    } catch (error) {
      console.log(`📝 Resultados no encontrados en Azure: ${encuestaId}`);
      return null;
    }
  }

  // RESPUESTAS INDIVIDUALES
  async guardarRespuesta(encuestaId: string, participanteId: string, preguntaIndex: number, respuesta: string): Promise<void> {
    try {
      const rowKey = `${encuestaId}_${participanteId}_${preguntaIndex}`;
      
      const entity: AzureRespuesta = {
        partitionKey: encuestaId,
        rowKey: rowKey,
        encuestaId: encuestaId,
        participanteId: participanteId,
        preguntaIndex: preguntaIndex,
        respuesta: respuesta,
        timestamp: new Date().toISOString()
      };

      await this.respuestasTable.upsertEntity(entity);
      console.log(`✅ Respuesta guardada en Azure: ${rowKey}`);
    } catch (error) {
      console.error('❌ Error guardando respuesta en Azure:', error);
      throw error;
    }
  }

  async cargarRespuestasEncuesta(encuestaId: string): Promise<any[]> {
    try {
      const entities = this.respuestasTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${encuestaId}'` }
      });

      const respuestas = [];
      for await (const entity of entities) {
        respuestas.push({
          participanteId: entity.participanteId,
          preguntaIndex: entity.preguntaIndex,
          respuesta: entity.respuesta,
          timestamp: new Date(entity.timestamp as string)
        });
      }

      return respuestas;
    } catch (error) {
      console.error('❌ Error cargando respuestas:', error);
      return [];
    }
  }
}

// MIGRACIÓN UTILITY - Ejecutar una sola vez
export async function migrarDatosJSON() {
  console.log('🔄 Iniciando migración de JSON a Azure Tables...');
  
  const azureService = new AzureTableService();
  const fs = await import('fs');
  const path = await import('path');
  
  try {
    // Migrar encuestas
    const dataDir = path.join(__dirname, '../../data');
    if (fs.existsSync(dataDir)) {
      const archivos = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
      
      for (const archivo of archivos) {
        try {
          const contenido = JSON.parse(fs.readFileSync(path.join(dataDir, archivo), 'utf-8'));
          if (contenido.id && contenido.titulo) {
            await azureService.guardarEncuesta(contenido);
            console.log(`✅ Migrada encuesta: ${contenido.titulo}`);
          }
        } catch (e) {
          console.log(`⚠️ Saltando archivo ${archivo}: ${e.message}`);
        }
      }
    }
    
    // Migrar resultados
    const resultadosDir = path.join(__dirname, '../../data/resultados');
    if (fs.existsSync(resultadosDir)) {
      const archivosResultados = fs.readdirSync(resultadosDir).filter(f => f.endsWith('.json'));
      
      for (const archivo of archivosResultados) {
        try {
          const contenido = JSON.parse(fs.readFileSync(path.join(resultadosDir, archivo), 'utf-8'));
          if (contenido.encuestaId) {
            await azureService.guardarResultados(contenido);
            
            // Migrar respuestas individuales
            if (contenido.respuestas && Array.isArray(contenido.respuestas)) {
              for (const respuesta of contenido.respuestas) {
                await azureService.guardarRespuesta(
                  contenido.encuestaId,
                  respuesta.participanteId,
                  respuesta.preguntaIndex,
                  respuesta.respuesta
                );
              }
            }
            
            console.log(`✅ Migrados resultados: ${contenido.encuestaId}`);
          }
        } catch (e) {
          console.log(`⚠️ Saltando archivo resultados ${archivo}: ${e.message}`);
        }
      }
    }
    
    console.log('🎉 Migración completada exitosamente!');
  } catch (error) {
    console.error('❌ Error en migración:', error);
    throw error;
  }
}