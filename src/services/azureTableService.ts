// CREAR ARCHIVO: src/services/azureTableService.ts

import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";
import { sha256 } from "../utils/hash";

// Interfaces
interface AzureEncuesta {
  partitionKey: string; // "ENCUESTA"
  rowKey: string; // ID único de la encuesta
  titulo: string; // Título de la encuesta
  objetivo: string; // Objetivo de la encuesta
  preguntas: string; // JSON stringified
  creador: string; // Usuario que creó la encuesta
  fechaCreacion: string; // ISO timestamp
  estado: string;   // "activa", "cerrada", "archivada"
  tenantId: string; // ID del tenant
    // Soft delete metadata (opcionales)
  fechaEliminacion?: string; // ISO timestamp
  eliminadaPor?: string; // Usuario que eliminó
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

interface TemplateEncuesta {
  partitionKey: string;     // "TEMPLATE" o "ORG_[orgId]"  
  rowKey: string;          // template_id único
  nombre: string;          // "Clima Laboral", "NPS Cliente"
  categoria: string;       // "HR", "Customer", "Training", "360"
  descripcion: string;     // Descripción detallada
  objetivo: string;        // Objetivo del template
  preguntas: string;       // JSON de preguntas y opciones
  creador: string;         // Usuario que lo creó
  esPublico: boolean;      // Si está disponible para todos
  organizacion?: string;   // ID de org (para templates privados)
  fechaCreacion: string;   // ISO timestamp
  vecesUsado: number;      // Métrica de popularidad
  tags: string;           // "clima,hr,satisfaccion" para búsqueda
  nivelPlan: string;      // "free", "professional", "enterprise"
}

interface AzureTemplate {
  partitionKey: string;
  rowKey: string;
  nombre: string;
  categoria: string;
  descripcion: string;
  objetivo: string;
  preguntas: string; // JSON stringified
  creador: string;
  esPublico: boolean;
  organizacion?: string;
  fechaCreacion: string;
  vecesUsado: number;
  tags: string;
  nivelPlan: string;
}

export type TenantRole = 'admin' | 'manager' | 'user';

interface TenantMember {
  partitionKey: string; // tenantId
  rowKey: string;       // userId
  email: string;
  name: string;
  role: TenantRole;
  dateAdded: string;
  addedBy: string;
}

// 🧠 Análisis avanzado por encuesta
interface AnalisisAvanzado {
  partitionKey: string;    // tenantId
  rowKey: string;          // encuestaId_timestamp
  encuestaId: string;
  tenantId: string;
  sentimentoDetallado: string; // JSON: {positivo: 85, neutral: 10, negativo: 5, confianza: 92}
  patronesIdentificados: string; // JSON array
  riesgosDetectados: string; // JSON array  
  recomendacionesPriorizadas: string; // JSON array
  alertas: string; // JSON array
  benchmarkComparison: string; // JSON object
  fechaAnalisis: string;
  ultimaActualizacion: string;
  modeloUsado: string; // "gpt-4-mini"
  confiabilidad: number; // 0-100
}

// 📊 Benchmarks por industria
interface Benchmark {
  partitionKey: string;    // industria (HR, Tech, Healthcare, etc)
  rowKey: string;          // metrica (satisfaction_rate, engagement_score)
  metrica: string;
  promedio: number;
  percentil25: number;
  percentil50: number;
  percentil75: number;
  percentil90: number;
  muestras: number; // cantidad de datos usados
  fechaActualizacion: string;
}

// 📈 Historial de métricas por tenant
interface HistorialMetricas {
  partitionKey: string;    // tenantId
  rowKey: string;          // fecha_metrica (2024-01-satisfaction)
  encuestaId: string;
  metrica: string; // satisfaction, engagement, nps, etc
  valor: number;
  fecha: string;
  participantes: number;
}

export class AzureTableService {
  private encuestasTable: TableClient;
  private respuestasTable: TableClient;
  private resultadosTable: TableClient;
  private templatesTable: TableClient;
  private membersTable: TableClient;
  private analisisAvanzadoTable: TableClient;
  private benchmarksTable: TableClient;
  private historialMetricasTable: TableClient;

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

    this.templatesTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'Templates',
      credential
    );

    this.membersTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'AdminUsers',
      credential
    );


    // 🆕 Nuevas tablas para análisis avanzado
    this.analisisAvanzadoTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'AnalisisAvanzado',
      credential
    );
    
    this.benchmarksTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'Benchmarks', 
      credential
    );
    
    this.historialMetricasTable = new TableClient(
      `https://${accountName}.table.core.windows.net`,
      'HistorialMetricas',
      credential
    );

    // Crear tablas si no existen
    this.initializeTables();
  }

  private async initializeTables(): Promise<void> {
    try {
      await this.encuestasTable.createTable();
      console.log('✅ Tabla Encuestas inicializada');
    } catch (error) {
      // Tabla ya existe
    }

    try {
      await this.respuestasTable.createTable();
      console.log('✅ Tabla Respuestas inicializada');
    } catch (error) {
      // Tabla ya existe
    }

    try {
      await this.resultadosTable.createTable();
      console.log('✅ Tabla Resultados inicializada');
    } catch (error) {
      // Tabla ya existe
    }

        // NUEVA TABLA TEMPLATES
    try {
      await this.templatesTable.createTable();
      console.log('✅ Tabla Templates inicializada');
    } catch (error) {
      // Tabla ya existe
    }

    try {
      await this.membersTable.createTable();
      console.log('✅ Tabla AdminUsers inicializada');
    } catch (error) {
      // Tabla ya existe
    }

    try {
      await this.analisisAvanzadoTable.createTable();
      console.log('✅ Tabla AnalisisAvanzado inicializada');
    } catch (error) {
      // Tabla ya existe
    }

    try {
      await this.benchmarksTable.createTable();
      console.log('✅ Tabla Benchmarks inicializada');
    } catch (error) {
      // Tabla ya existe
    }

    try {
      await this.historialMetricasTable.createTable();
      console.log('✅ Tabla HistorialMetricas inicializada');
    } catch (error) {
      // Tabla ya existe
    }
  }

  // 👤 Verificar si un usuario ya respondió una encuesta
  async  checkUserResponse(encuestaId: string, userId: string): Promise<boolean> {
    try {
      // Crear ID anónimo consistente para buscar
      const participanteAnonimo = sha256(userId.trim().toLowerCase(), encuestaId);
      
      // Buscar respuestas del usuario en esta encuesta
      const entities = this.respuestasTable.listEntities({
        queryOptions: { 
          filter: `PartitionKey eq '${encuestaId}' and participanteId eq '${participanteAnonimo}'`
        }
      });

      // Si encontramos al menos una respuesta, ya respondió
      for await (const entity of entities) {
        return true; // Ya respondió
      }
      
      return false; // No ha respondido
    } catch (error) {
      console.error('❌ Error checking user response:', error);
      return false; // En caso de error, asumir que no respondió
    }
  }
  // TENANT MEMBERS & ROLES
  private mapMemberEntity(entity: Record<string, unknown>): TenantMember {
    const role = String(entity.role || 'user').toLowerCase() as TenantRole;
    return {
      partitionKey: entity.partitionKey as string,
      rowKey: entity.rowKey as string,
      email: (entity.email as string) || '',
      name: (entity.name as string) || 'Unknown',
      role: role === 'admin' || role === 'manager' ? role : 'user',
      dateAdded: (entity.dateAdded as string) || new Date().toISOString(),
      addedBy: (entity.addedBy as string) || 'System'
    };
  }

  async obtenerMiembro(userId: string, tenantId: string): Promise<TenantMember | null> {
    try {
      const entity = await this.membersTable.getEntity(tenantId, userId);
      return this.mapMemberEntity(entity as Record<string, unknown>);
    } catch (error) {
      console.log(`📝 Tenant member not found: ${userId} in ${tenantId}`);
      return null;
    }
  }

  async upsertMiembro(options: {
    userId: string;
    tenantId: string;
    email: string;
    name: string;
    role: TenantRole;
    addedBy?: string;
  }): Promise<void> {
    const { userId, tenantId, email, name, role, addedBy } = options;

    try {
      const entity = {
        partitionKey: tenantId,
        rowKey: userId,
        email,
        name,
        role,
        tenantId,
        dateAdded: new Date().toISOString(),
        addedBy: addedBy || 'System'
      };

      await this.membersTable.upsertEntity(entity);
      console.log(`✅ Tenant member ${role} upserted: ${email} in ${tenantId}`);
    } catch (error) {
      console.error('❌ Error upserting tenant member:', error);
      throw error;
    }
  }

  async actualizarRolMiembro(tenantId: string, userId: string, role: TenantRole): Promise<void> {
    try {
      await this.membersTable.updateEntity(
        {
          partitionKey: tenantId,
          rowKey: userId,
          role
        },
        'Merge'
      );
      console.log(`🛠️ Tenant member role updated: ${userId} → ${role}`);
    } catch (error) {
      console.error('❌ Error updating tenant member role:', error);
      throw error;
    }
  }

  async eliminarMiembro(tenantId: string, userId: string): Promise<void> {
    try {
      await this.membersTable.deleteEntity(tenantId, userId);
      console.log(`🗑️ Tenant member removed: ${userId} in ${tenantId}`);
    } catch (error) {
      console.error('❌ Error removing tenant member:', error);
      throw error;
    }
  }

  async listarMiembrosEnTenant(tenantId: string, roles?: TenantRole[]): Promise<TenantMember[]> {
    try {
      const entities = this.membersTable.listEntities({
        queryOptions: { filter: `PartitionKey eq '${tenantId}'` }
      });

      const members: TenantMember[] = [];
      for await (const entity of entities) {
        const member = this.mapMemberEntity(entity as Record<string, unknown>);
        if (!roles || roles.includes(member.role)) {
          members.push(member);
        }
      }

      return members;
    } catch (error) {
      console.error('❌ Error listing tenant members:', error);
      return [];
    }
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
        fechaCreacion: (() => {
          if (!encuesta.fechaCreacion) return new Date().toISOString();
          if (encuesta.fechaCreacion instanceof Date) return encuesta.fechaCreacion.toISOString();
          if (typeof encuesta.fechaCreacion === 'string') return encuesta.fechaCreacion;
          return new Date().toISOString();
        })(),
        estado: encuesta.estado || 'activa',
        tenantId: encuesta.tenantId || 'default_tenant',
        // ⬇️ si vienen campos de soft delete, los conservamos
        fechaEliminacion: encuesta.fechaEliminacion,
        eliminadaPor: encuesta.eliminadaPor
      };

      await this.encuestasTable.upsertEntity(entity); // upsert mantiene idempotencia
      console.log(`✅ Encuesta guardada en Azure: ${encuesta.id}`);
      return encuesta.id;
    } catch (error) {
      console.error('❌ Error guardando encuesta en Azure:', error);
      throw error;
    }
  }

  async marcarEncuestaEliminada(encuestaId: string, tenantId: string, eliminadoPor: string) {
    // Carga y ownership
    const encuesta = await this.cargarEncuesta(encuestaId);
    if (!encuesta) throw new Error('survey_not_found');
    if (encuesta.tenantId !== tenantId) throw new Error('forbidden_tenant');

    const fechaEliminacion = new Date().toISOString();
    const encuestaEliminada = {
      ...encuesta,
      estado: 'eliminada',
      fechaEliminacion,
      eliminadaPor: eliminadoPor || 'Admin'
    };

    await this.guardarEncuesta(encuestaEliminada);

    // (Opcional) también “congelar” o marcar resultados si querés
    try {
      const res = await this.cargarResultados(encuestaId, tenantId);
      if (res) {
        await this.guardarResultados({
          ...res,
          estado: 'eliminada',
          // Mantengo título/fecha/resumen para auditoría
        });
      }
    } catch (e) {
      console.warn('⚠️ No se pudo marcar resultados como eliminados (continuo):', e);
    }

    return { encuestaId, fechaEliminacion };
  }

  async eliminarEncuestaFisica(encuestaId: string, tenantId: string) {
    // Verificación
    const encuesta = await this.cargarEncuesta(encuestaId);
    if (!encuesta) return;
    if (encuesta.tenantId !== tenantId) throw new Error('forbidden_tenant');

    // Borrado físico de la encuesta
    await this.encuestasTable.deleteEntity('ENCUESTA', encuestaId).catch(() => {});

    // Borrado de resultados (si existen)
    await this.resultadosTable.deleteEntity('RESULTADO', encuestaId).catch(() => {});

    // Borrado de respuestas (puede ser voluminoso; hacerlo con cuidado)
    const ents = this.respuestasTable.listEntities({
      queryOptions: { filter: `PartitionKey eq '${encuestaId}'` }
    });
    for await (const e of ents) {
      await this.respuestasTable.deleteEntity(e.partitionKey as string, e.rowKey as string).catch(() => {});
    }

    console.log(`🧹 Hard delete completado para encuesta ${encuestaId}`);
  }

  async cargarEncuesta(encuestaId: string): Promise<any | null> {
    try {
      const entity = await this.encuestasTable.getEntity('ENCUESTA', encuestaId);
      const entityTenant = (entity as any).tenantId || (entity as any).tenantid || null;

      return {
        id: entity.rowKey,
        titulo: entity.titulo,
        objetivo: entity.objetivo,
        preguntas: JSON.parse(entity.preguntas as string),
        creador: entity.creador,
        fechaCreacion: entity.fechaCreacion,
        estado: (entity.estado as string) || 'activa',
        tenantId: entityTenant,
        fechaEliminacion: entity.fechaEliminacion as string | undefined,
        eliminadaPor: entity.eliminadaPor as string | undefined
      };
    } catch (error) {
      console.log(`📝 Encuesta no encontrada en Azure: ${encuestaId}`);
      return null;
    }
  }

  // 🆕 Verificar si encuesta pertenece al tenant
  async verificarOwnershipEncuesta(encuestaId: string, tenantId: string): Promise<boolean> {
    try {
      const encuesta = await this.cargarEncuesta(encuestaId);
      return encuesta && encuesta.tenantId === tenantId;
    } catch (error) {
      console.error('❌ Error verificando ownership:', error);
      return false;
    }
  }

  async listarEncuestas(tenantId?: string, includeDeleted: boolean = false): Promise<any[]> {
    try {
      const filter = "PartitionKey eq 'ENCUESTA'";

      const entities = this.encuestasTable.listEntities({ queryOptions: { filter } });

      const encuestas: any[] = [];
      for await (const entity of entities) {
        const entityTenant = (entity as any).tenantId || (entity as any).tenantid || null;
        const estadoEntidad = ((entity as any).estado as string) || 'activa';

        if (!includeDeleted && estadoEntidad === 'eliminada') {
          continue;
        }

        if (tenantId && entityTenant !== tenantId) {
          continue;
        }

        encuestas.push({
          id: entity.rowKey,
          titulo: entity.titulo,
          objetivo: entity.objetivo,
          preguntas: JSON.parse(entity.preguntas as string),
          creador: entity.creador,
          fechaCreacion: entity.fechaCreacion,
          estado: estadoEntidad,
          tenantId: entityTenant,
          fechaEliminacion: entity.fechaEliminacion as string | undefined,
          eliminadaPor: entity.eliminadaPor as string | undefined,
          totalRespuestas: 0
        });
      }
      return encuestas;
    } catch (error) {
      console.error('❌ Error listando encuestas:', error);
      return [];
    }
  }

  // RESULTADOS - VERSIÓN CORREGIDA
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
        totalParticipantes: resultados.totalParticipantes || 0,
        respuestas: JSON.stringify(resultados.respuestas || []),
        resumen: JSON.stringify(resultados.resumen || {})
      };

      await this.resultadosTable.upsertEntity(entity);
      console.log(`✅ Resultados guardados en Azure: ${resultados.encuestaId}`);
    } catch (error) {
      console.error('❌ Error guardando resultados en Azure:', error);
      throw error;
    }
  }

  async cargarResultados(encuestaId: string, tenantId?: string): Promise<any | null> {
    try {
      // 🔧 Verificar ownership si se proporciona tenantId
      if (tenantId) {
        const hasAccess = await this.verificarOwnershipEncuesta(encuestaId, tenantId);
        if (!hasAccess) {
          console.warn(`⚠️ Tenant ${tenantId} no tiene acceso a encuesta ${encuestaId}`);
          return null;
        }
      }
      
      const entity = await this.resultadosTable.getEntity('RESULTADO', encuestaId);
      
      return {
        encuestaId: entity.encuestaId,
        titulo: entity.titulo,
        fechaCreacion: new Date(entity.fechaCreacion as string),
        estado: entity.estado,
        totalParticipantes: entity.totalParticipantes || 0,
        respuestas: JSON.parse(entity.respuestas as string || '[]'),
        resumen: JSON.parse(entity.resumen as string || '{}')
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

  async cargarRespuestasEncuesta(encuestaId: string, tenantId?: string): Promise<any[]> {
    try {
      // 🔧 Verificar ownership si se proporciona tenantId
      if (tenantId) {
        const hasAccess = await this.verificarOwnershipEncuesta(encuestaId, tenantId);
        if (!hasAccess) {
          console.warn(`⚠️ Tenant ${tenantId} no tiene acceso a encuesta ${encuestaId}`);
          return [];
        }
      }
      
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

  // ========================
  // FUNCIONES DE TEMPLATES
  // ========================

  // Guardar template
  async guardarTemplate(template: TemplateEncuesta): Promise<string> {
    try {
      const entity: AzureTemplate = {
        partitionKey: template.partitionKey,
        rowKey: template.rowKey,
        nombre: template.nombre,
        categoria: template.categoria,
        descripcion: template.descripcion,
        objetivo: template.objetivo,
        preguntas: JSON.stringify(template.preguntas),
        creador: template.creador,
        esPublico: template.esPublico,
        organizacion: template.organizacion,
        fechaCreacion: template.fechaCreacion,
        vecesUsado: template.vecesUsado,
        tags: template.tags,
        nivelPlan: template.nivelPlan
      };

      await this.templatesTable.createEntity(entity);
      console.log(`✅ Template guardado en Azure: ${template.nombre}`);
      return template.rowKey;
    } catch (error) {
      console.error('❌ Error guardando template en Azure:', error);
      throw error;
    }
  }

  // Listar templates públicos
  async listarTemplatesPublicos(): Promise<TemplateEncuesta[]> {
    try {
      const entities = this.templatesTable.listEntities({
        queryOptions: { 
          filter: "PartitionKey eq 'TEMPLATE' and esPublico eq true" 
        }
      });

      const templates = [];
      for await (const entity of entities) {
        templates.push({
          partitionKey: entity.partitionKey as string,
          rowKey: entity.rowKey as string,
          nombre: entity.nombre as string,
          categoria: entity.categoria as string,
          descripcion: entity.descripcion as string,
          objetivo: entity.objetivo as string,
          preguntas: JSON.parse(entity.preguntas as string),
          creador: entity.creador as string,
          esPublico: entity.esPublico as boolean,
          organizacion: entity.organizacion as string,
          fechaCreacion: entity.fechaCreacion as string,
          vecesUsado: entity.vecesUsado as number,
          tags: entity.tags as string,
          nivelPlan: entity.nivelPlan as string
        });
      }

      // Ordenar por popularidad (vecesUsado) y luego por fecha
      return templates.sort((a, b) => {
        if (b.vecesUsado !== a.vecesUsado) {
          return b.vecesUsado - a.vecesUsado;
        }
        return new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime();
      });
    } catch (error) {
      console.error('❌ Error listando templates públicos:', error);
      return [];
    }
  }

// Listar templates por organización
  async listarTemplatesOrganizacion(organizacion: string): Promise<TemplateEncuesta[]> {
    try {
      const entities = this.templatesTable.listEntities({
        queryOptions: { 
          filter: `PartitionKey eq 'ORG_${organizacion}'` 
        }
      });

      const templates = [];
      for await (const entity of entities) {
        templates.push({
          partitionKey: entity.partitionKey as string,
          rowKey: entity.rowKey as string,
          nombre: entity.nombre as string,
          categoria: entity.categoria as string,
          descripcion: entity.descripcion as string,
          objetivo: entity.objetivo as string,
          preguntas: JSON.parse(entity.preguntas as string),
          creador: entity.creador as string,
          esPublico: entity.esPublico as boolean,
          organizacion: entity.organizacion as string,
          fechaCreacion: entity.fechaCreacion as string,
          vecesUsado: entity.vecesUsado as number,
          tags: entity.tags as string,
          nivelPlan: entity.nivelPlan as string
        });
      }

      return templates.sort((a, b) => b.vecesUsado - a.vecesUsado);
    } catch (error) {
      console.error('❌ Error listando templates de organización:', error);
      return [];
    }
  }

  // Obtener template por ID
  async obtenerTemplate(partitionKey: string, rowKey: string): Promise<TemplateEncuesta | null> {
    try {
      const entity = await this.templatesTable.getEntity(partitionKey, rowKey);
      
      return {
        partitionKey: entity.partitionKey as string,
        rowKey: entity.rowKey as string,
        nombre: entity.nombre as string,
        categoria: entity.categoria as string,
        descripcion: entity.descripcion as string,
        objetivo: entity.objetivo as string,
        preguntas: JSON.parse(entity.preguntas as string),
        creador: entity.creador as string,
        esPublico: entity.esPublico as boolean,
        organizacion: entity.organizacion as string,
        fechaCreacion: entity.fechaCreacion as string,
        vecesUsado: entity.vecesUsado as number,
        tags: entity.tags as string,
        nivelPlan: entity.nivelPlan as string
      };
    } catch (error) {
      console.log(`📝 Template no encontrado: ${partitionKey}/${rowKey}`);
      return null;
    }
  }

  // Buscar templates por categoría o tags
  async buscarTemplates(query: string): Promise<TemplateEncuesta[]> {
    try {
      // Buscar en templates públicos
      const templates = await this.listarTemplatesPublicos();
      
      const queryLower = query.toLowerCase();
      return templates.filter(template => 
        template.nombre.toLowerCase().includes(queryLower) ||
        template.categoria.toLowerCase().includes(queryLower) ||
        template.tags.toLowerCase().includes(queryLower) ||
        template.descripcion.toLowerCase().includes(queryLower)
      );
    } catch (error) {
      console.error('❌ Error buscando templates:', error);
      return [];
    }
  }

  async incrementarUsoTemplate(partitionKey: string, rowKey: string): Promise<void> {
    try {
      const template = await this.obtenerTemplate(partitionKey, rowKey);
      if (template) {
        template.vecesUsado += 1;
        
        const entity: AzureTemplate = {
          partitionKey: template.partitionKey,
          rowKey: template.rowKey,
          nombre: template.nombre,
          categoria: template.categoria,
          descripcion: template.descripcion,
          objetivo: template.objetivo,
          preguntas: JSON.stringify(template.preguntas),
          creador: template.creador,
          esPublico: template.esPublico,
          organizacion: template.organizacion,
          fechaCreacion: template.fechaCreacion,
          vecesUsado: template.vecesUsado,
          tags: template.tags,
          nivelPlan: template.nivelPlan
        };

        await this.templatesTable.updateEntity(entity);
        console.log(`✅ Incrementado uso de template: ${template.nombre}`);
      }
    } catch (error) {
      console.error('❌ Error incrementando uso de template:', error);
    }
  }


// 🆕 Función para obtener suscripción activa en Marketplace
async obtenerSuscripcionMarketplace(userId: string, tenantId: string): Promise<any | null> {
  try {
    // Crear tabla MarketplaceSubscriptions si no existe
    const marketplaceTable = new TableClient(
      `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`,
      'MarketplaceSubscriptions',
      new AzureNamedKeyCredential(
        process.env.AZURE_STORAGE_ACCOUNT_NAME!,
        process.env.AZURE_STORAGE_ACCOUNT_KEY!
      )
    );

    // Buscar suscripción activa del usuario
    const entities = marketplaceTable.listEntities({
      queryOptions: { 
        filter: `userOid eq '${userId}' and userTenant eq '${tenantId}' and status eq 'Activated'`
      }
    });
    
    for await (const subscription of entities) {
      return {
        userOid: subscription.userOid,
        userEmail: subscription.userEmail,
        userName: subscription.userName,
        status: subscription.status,
        planId: subscription.planId,
        subscriptionId: subscription.rowKey
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error obteniendo suscripción marketplace:', error);
    return null;
  }
}

  // Función para crear templates seed (ejecutar una vez)
async crearTemplatesSeed(): Promise<void> {
  console.log('🌱 Creando templates seed...');

  const templatesSeed = [
    {
      partitionKey: 'TEMPLATE',
      rowKey: 'clima_laboral_v1',
      nombre: 'Clima Laboral',
      categoria: 'HR',
      descripcion: 'Evaluación completa del ambiente de trabajo y satisfacción laboral',
      objetivo: 'Medir la satisfacción y engagement de los empleados',
      preguntas: JSON.stringify([ // 🔧 FIX: Convertir a JSON string
        {
          pregunta: '¿Cómo calificarías el ambiente general de trabajo?',
          opciones: ['Excelente', 'Bueno', 'Regular', 'Malo', 'Muy malo']
        },
        {
          pregunta: '¿Te sientes valorado por tu supervisor inmediato?',
          opciones: ['Siempre', 'Frecuentemente', 'A veces', 'Raramente', 'Nunca']
        },
        {
          pregunta: '¿Recomendarías esta empresa como un buen lugar para trabajar?',
          opciones: ['Definitivamente sí', 'Probablemente sí', 'No estoy seguro', 'Probablemente no', 'Definitivamente no']
        },
        {
          pregunta: '¿Qué tan clara es la comunicación de los objetivos del equipo?',
          opciones: ['Muy clara', 'Clara', 'Moderadamente clara', 'Poco clara', 'Nada clara']
        },
        {
          pregunta: '¿Tienes las herramientas necesarias para hacer bien tu trabajo?',
          opciones: ['Completamente', 'Mayormente', 'Parcialmente', 'Muy poco', 'Para nada']
        }
      ]),
      creador: 'TeamPulse System',
      esPublico: true,
      fechaCreacion: new Date().toISOString(),
      vecesUsado: 0,
      tags: 'clima,laboral,hr,satisfaccion,ambiente',
      nivelPlan: 'free'
    },
    {
      partitionKey: 'TEMPLATE',
      rowKey: 'nps_cliente_v1',
      nombre: 'NPS - Satisfacción Cliente',
      categoria: 'Customer',
      descripcion: 'Net Promoter Score para medir lealtad y satisfacción del cliente',
      objetivo: 'Evaluar la probabilidad de recomendación y identificar áreas de mejora',
      preguntas: JSON.stringify([ // 🔧 FIX: JSON string
        {
          pregunta: '¿Qué tan probable es que recomiendes nuestro producto/servicio?',
          opciones: ['10 - Extremadamente probable', '9 - Muy probable', '8 - Probable', '7 - Neutral', '6 - Poco probable', '5 - Muy poco probable', '0-4 - Nada probable']
        },
        {
          pregunta: '¿Cómo calificarías la calidad de nuestro servicio al cliente?',
          opciones: ['Excelente', 'Muy bueno', 'Bueno', 'Regular', 'Malo']
        },
        {
          pregunta: '¿Qué tan fácil fue resolver tu consulta/problema?',
          opciones: ['Muy fácil', 'Fácil', 'Moderado', 'Difícil', 'Muy difícil']
        }
      ]),
      creador: 'TeamPulse System',
      esPublico: true,
      fechaCreacion: new Date().toISOString(),
      vecesUsado: 0,
      tags: 'nps,cliente,satisfaccion,recomendacion,servicio',
      nivelPlan: 'free'
    },
    {
      partitionKey: 'TEMPLATE',
      rowKey: 'feedback_capacitacion_v1',
      nombre: 'Feedback Capacitación',
      categoria: 'Training',
      descripcion: 'Evaluación post-capacitación para medir efectividad del entrenamiento',
      objetivo: 'Evaluar la utilidad y calidad de las sesiones de capacitación',
      preguntas: JSON.stringify([ // 🔧 FIX: JSON string
        {
          pregunta: '¿Qué tan útil fue esta capacitación para tu trabajo?',
          opciones: ['Extremadamente útil', 'Muy útil', 'Moderadamente útil', 'Poco útil', 'Nada útil']
        },
        {
          pregunta: '¿El contenido fue presentado de manera clara?',
          opciones: ['Muy claro', 'Claro', 'Moderadamente claro', 'Poco claro', 'Confuso']
        },
        {
          pregunta: '¿El instructor demostró conocimiento del tema?',
          opciones: ['Experto', 'Muy conocedor', 'Conocedor', 'Poco conocedor', 'Principiante']
        },
        {
          pregunta: '¿Recomendarías esta capacitación a tus colegas?',
          opciones: ['Definitivamente sí', 'Probablemente sí', 'Tal vez', 'Probablemente no', 'Definitivamente no']
        }
      ]),
      creador: 'TeamPulse System',
      esPublico: true,
      fechaCreacion: new Date().toISOString(),
      vecesUsado: 0,
      tags: 'capacitacion,training,feedback,educacion,curso',
      nivelPlan: 'free'
    },
    {
      partitionKey: 'TEMPLATE',
      rowKey: 'trabajo_remoto_v1',
      nombre: 'Trabajo Remoto',
      categoria: 'HR',
      descripcion: 'Evaluación de la experiencia y productividad en trabajo remoto',
      objetivo: 'Entender los desafíos y beneficios del trabajo remoto',
      preguntas: JSON.stringify([ // 🔧 FIX: JSON string
        {
          pregunta: '¿Qué tan productivo te sientes trabajando desde casa?',
          opciones: ['Más productivo', 'Igual de productivo', 'Menos productivo', 'Mucho menos productivo']
        },
        {
          pregunta: '¿Tienes un espacio adecuado para trabajar desde casa?',
          opciones: ['Sí, muy adecuado', 'Sí, adecuado', 'Parcialmente', 'No muy adecuado', 'No adecuado']
        },
        {
          pregunta: '¿Qué tan efectiva es la comunicación con tu equipo?',
          opciones: ['Muy efectiva', 'Efectiva', 'Moderadamente efectiva', 'Poco efectiva', 'Inefectiva']
        },
        {
          pregunta: '¿Prefieres trabajar remoto, presencial o híbrido?',
          opciones: ['100% remoto', 'Mayormente remoto', 'Híbrido 50/50', 'Mayormente presencial', '100% presencial']
        }
      ]),
      creador: 'TeamPulse System',
      esPublico: true,
      fechaCreacion: new Date().toISOString(),
      vecesUsado: 0,
      tags: 'remoto,home,office,productividad,hibrido',
      nivelPlan: 'professional'
    },
    {
      partitionKey: 'TEMPLATE',
      rowKey: 'evaluacion_360_v1',
      nombre: 'Evaluación 360°',
      categoria: '360',
      descripcion: 'Evaluación integral desde múltiples perspectivas: supervisor, pares y subordinados',
      objetivo: 'Obtener feedback completo para desarrollo profesional',
      preguntas: JSON.stringify([ // 🔧 FIX: JSON string
        {
          pregunta: '¿Cómo calificarías las habilidades de comunicación?',
          opciones: ['Excelente', 'Muy bueno', 'Bueno', 'Necesita mejora', 'Deficiente']
        },
        {
          pregunta: '¿Demuestra liderazgo efectivo en situaciones desafiantes?',
          opciones: ['Siempre', 'Frecuentemente', 'A veces', 'Raramente', 'Nunca']
        },
        {
          pregunta: '¿Qué tan bien colabora con el equipo?',
          opciones: ['Excepcional', 'Muy bien', 'Bien', 'Regular', 'Mal']
        },
        {
          pregunta: '¿Cumple consistentemente con los plazos establecidos?',
          opciones: ['Siempre', 'Casi siempre', 'Generalmente', 'A veces', 'Raramente']
        },
        {
          pregunta: '¿Busca activamente oportunidades de mejora?',
          opciones: ['Muy proactivo', 'Proactivo', 'Moderadamente', 'Poco proactivo', 'Nada proactivo']
        }
      ]),
      creador: 'TeamPulse System',
      esPublico: true,
      fechaCreacion: new Date().toISOString(),
      vecesUsado: 0,
      tags: '360,evaluacion,feedback,desarrollo,liderazgo',
      nivelPlan: 'professional'
    }
  ];

  // Guardar cada template
  for (const templateData of templatesSeed) {
    try {
      await this.guardarTemplate(templateData);
      console.log(`✅ Template seed creado: ${templateData.nombre}`);
    } catch (error) {
      console.log(`⚠️ Template ya existe: ${templateData.nombre}`);
    }
  }

  console.log('🎉 Templates seed completados!');
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
