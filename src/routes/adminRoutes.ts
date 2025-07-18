// src/routes/adminRoutes.ts
import { Router, Request, Response } from "express";
import { AzureTableService } from "../services/azureTableService";

const router = Router();
const azureService = new AzureTableService();

// ────────────────────────────────────────────────────────────
// MIDDLEWARE DE AUTENTICACIÓN Y AUTORIZACIÓN
// ────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    userName?: string;
    isAdmin?: boolean;
  };
}

// Middleware para validar token SSO de Teams
async function validateTeamsSSO(req: AuthenticatedRequest, res: Response, next: any) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('⚠️ Admin access attempt without proper authorization');
      // En desarrollo, permitir acceso sin token
      if (process.env.NODE_ENV === 'development') {
        req.user = {
          userId: 'dev-admin',
          tenantId: 'dev-tenant',
          userName: 'Developer Admin',
          isAdmin: true
        };
        return next();
      }
      
      return res.status(401).json({ 
        error: 'Authorization required',
        message: 'Admin panel requires Teams SSO authentication'
      });
    }

    const token = authHeader.substring(7);
    
    // Aquí validarías el token JWT con Microsoft Graph
    // Por ahora, simularemos la validación
    const decodedUser = await validateJWTToken(token);
    
    if (!decodedUser) {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Teams SSO token is invalid or expired'
      });
    }

    // Verificar si el usuario es administrador
    const isAdmin = await checkAdminPermissions(decodedUser.userId, decodedUser.tenantId);
    
    if (!isAdmin) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'Admin panel access requires administrator privileges'
      });
    }

    req.user = {
      ...decodedUser,
      isAdmin: true
    };

    next();
  } catch (error) {
    console.error('❌ Error validating Teams SSO:', error);
    res.status(500).json({ 
      error: 'Authentication error',
      message: 'Failed to validate user credentials'
    });
  }
}

// Función auxiliar para validar JWT (implementar según necesidades)
async function validateJWTToken(token: string): Promise<any> {
  try {
    // Aquí implementarías la validación real del JWT con Microsoft Graph
    // Por ahora retornamos datos mock para desarrollo
    
    if (process.env.NODE_ENV === 'development') {
      return {
        userId: 'admin-user-123',
        tenantId: 'tenant-456',
        userName: 'Admin User',
        email: 'admin@company.com'
      };
    }

    // En producción, usar Microsoft Graph para validar:
    // const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    //   headers: { 'Authorization': `Bearer ${token}` }
    // });
    // return await response.json();

    return null;
  } catch (error) {
    console.error('❌ Error validating JWT:', error);
    return null;
  }
}

// Función auxiliar para verificar permisos de admin
async function checkAdminPermissions(userId: string, tenantId: string): Promise<boolean> {
  try {
    // Lista de administradores autorizados
    const adminUserIds = [
      '105af15b-7381-4370-99a0-0cb24dcc6886', // Gregorio Correa
      'admin-user-123', // Development admin
      // Agregar más IDs de administradores según necesidad
    ];

    // Verificar si el usuario está en la lista de admins
    const isInAdminList = adminUserIds.includes(userId);
    
    if (isInAdminList) {
      console.log(`✅ Admin access granted to user: ${userId}`);
      return true;
    }

    // Opcional: También verificar roles en Azure AD
    // const roles = await getUserRoles(userId, tenantId);
    // return roles.includes('TeamPulse.Admin');

    console.log(`🚫 Admin access denied to user: ${userId}`);
    return false;
  } catch (error) {
    console.error('❌ Error checking admin permissions:', error);
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// RUTAS DEL PANEL DE ADMINISTRACIÓN
// ────────────────────────────────────────────────────────────

// 📊 GET /api/admin/stats - Estadísticas del dashboard
router.get('/stats', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log(`📊 Admin stats requested by: ${req.user?.userName}`);

    // Obtener todas las encuestas
    const encuestas = await azureService.listarEncuestas();
    
    // Calcular estadísticas
    const totalSurveys = encuestas.length;
    const activeSurveys = encuestas.filter(e => e.estado !== 'cerrada').length;
    
    // Obtener total de respuestas de todas las encuestas
    let totalResponses = 0;
    for (const encuesta of encuestas) {
      try {
        const respuestas = await azureService.cargarRespuestasEncuesta(encuesta.id!);
        const participantesUnicos = new Set(respuestas.map(r => r.participanteId));
        totalResponses += participantesUnicos.size;
      } catch (error) {
        console.warn(`⚠️ Error al cargar respuestas para encuesta ${encuesta.id}:`, error);
      }
    }
    
    const avgResponseRate = totalSurveys > 0 ? Math.round(totalResponses / totalSurveys) : 0;

    // Estadísticas adicionales
    const stats = {
      totalSurveys,
      activeSurveys,
      totalResponses,
      avgResponseRate,
      inactiveSurveys: totalSurveys - activeSurveys,
      // Estadísticas por período
      surveysThisMonth: encuestas.filter(e => {
        const creationDate = new Date(e.fechaCreacion);
        const now = new Date();
        return creationDate.getMonth() === now.getMonth() && 
               creationDate.getFullYear() === now.getFullYear();
      }).length,
      // Top creadores
      topCreators: getTopCreators(encuestas),
      // Distribución por template
      templateUsage: getTemplateUsage(encuestas)
    };

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
      requestedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error getting admin stats:', error);
    res.status(500).json({
      error: 'Failed to get statistics',
      message: 'Error al obtener estadísticas del dashboard'
    });
  }
});

// 📋 GET /api/admin/surveys - Listar todas las encuestas con metadata extendida
router.get('/surveys', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log(`📋 Admin surveys list requested by: ${req.user?.userName}`);

    const { search, status, creator, limit = 50, offset = 0 } = req.query;

    // Obtener todas las encuestas
    let encuestas = await azureService.listarEncuestas();

    // Enriquecer cada encuesta con datos de respuestas
    const encuestasEnriquecidas = await Promise.all(
      encuestas.map(async (encuesta) => {
        try {
          const respuestas = await azureService.cargarRespuestasEncuesta(encuesta.id!);
          const participantesUnicos = new Set(respuestas.map(r => r.participanteId));
          
          return {
            ...encuesta,
            totalRespuestas: participantesUnicos.size,
            ultimaRespuesta: respuestas.length > 0 
              ? new Date(Math.max(...respuestas.map(r => new Date(r.timestamp).getTime())))
              : null,
            estado: encuesta.estado || 'activa' // Default estado
          };
        } catch (error) {
          console.warn(`⚠️ Error enriching survey ${encuesta.id}:`, error);
          return {
            ...encuesta,
            totalRespuestas: 0,
            ultimaRespuesta: null,
            estado: encuesta.estado || 'activa'
          };
        }
      })
    );

    // Aplicar filtros
    let filteredSurveys = encuestasEnriquecidas;

    if (search) {
      const searchTerm = (search as string).toLowerCase();
      filteredSurveys = filteredSurveys.filter(survey =>
        survey.titulo.toLowerCase().includes(searchTerm) ||
        survey.objetivo.toLowerCase().includes(searchTerm) ||
        survey.id!.toLowerCase().includes(searchTerm) ||
        survey.creador.toLowerCase().includes(searchTerm)
      );
    }

    if (status) {
      filteredSurveys = filteredSurveys.filter(survey => survey.estado === status);
    }

    if (creator) {
      filteredSurveys = filteredSurveys.filter(survey => 
        survey.creador.toLowerCase().includes((creator as string).toLowerCase())
      );
    }

    // Ordenar por fecha de creación (más recientes primero)
    filteredSurveys.sort((a, b) => 
      new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()
    );

    // Aplicar paginación
    const totalCount = filteredSurveys.length;
    const startIndex = parseInt(offset as string);
    const limitCount = parseInt(limit as string);
    const paginatedSurveys = filteredSurveys.slice(startIndex, startIndex + limitCount);

    res.json({
      success: true,
      data: paginatedSurveys,
      pagination: {
        total: totalCount,
        offset: startIndex,
        limit: limitCount,
        hasMore: startIndex + limitCount < totalCount
      },
      filters: { search, status, creator },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting surveys list:', error);
    res.status(500).json({
      error: 'Failed to get surveys',
      message: 'Error al obtener lista de encuestas'
    });
  }
});

// 📝 PUT /api/admin/surveys/:id - Actualizar encuesta completa
router.put('/surveys/:id', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { titulo, objetivo, preguntas } = req.body;

    console.log(`📝 Survey update requested for ${id} by: ${req.user?.userName}`);

    // Validaciones
    if (!titulo || !objetivo || !preguntas || !Array.isArray(preguntas)) {
      res.status(400).json({
        error: 'Invalid data',
        message: 'Título, objetivo y preguntas son requeridos'
      });
      return;
    }

    if (preguntas.length === 0) {
      res.status(400).json({
        error: 'Invalid data',
        message: 'La encuesta debe tener al menos una pregunta'
      });
      return;
    }

    // Verificar que la encuesta existe
    const encuestaExistente = await azureService.cargarEncuesta(id);
    if (!encuestaExistente) {
      res.status(404).json({
        error: 'Survey not found',
        message: `Encuesta con ID ${id} no encontrada`
      });
      return;
    }

    // Validar preguntas
    for (let i = 0; i < preguntas.length; i++) {
      const pregunta = preguntas[i];
      if (!pregunta.pregunta || !Array.isArray(pregunta.opciones) || pregunta.opciones.length < 2) {
        res.status(400).json({
          error: 'Invalid question data',
          message: `La pregunta ${i + 1} debe tener texto y al menos 2 opciones`
        });
        return;
      }
    }

    // Actualizar encuesta
    const encuestaActualizada = {
      ...encuestaExistente,
      titulo: titulo.trim(),
      objetivo: objetivo.trim(),
      preguntas: preguntas.map(p => ({
        pregunta: p.pregunta.trim(),
        opciones: p.opciones.map((opt: string) => opt.trim())
      })),
      ultimaModificacion: new Date(),
      modificadoPor: req.user?.userName || 'Admin'
    };

    // Guardar en Azure
    await azureService.guardarEncuesta(encuestaActualizada);

    console.log(`✅ Survey ${id} updated successfully`);

    res.json({
      success: true,
      message: 'Encuesta actualizada exitosamente',
      data: encuestaActualizada,
      timestamp: new Date().toISOString(),
      updatedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error updating survey:', error);
    res.status(500).json({
      error: 'Failed to update survey',
      message: 'Error al actualizar la encuesta'
    });
  }
});

// ⏸️ PATCH /api/admin/surveys/:id/status - Cambiar estado de encuesta
router.patch('/surveys/:id/status', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log(`⏸️ Survey status change requested for ${id} to ${status} by: ${req.user?.userName}`);

    if (!status || !['activa', 'cerrada', 'pausada'].includes(status)) {
      res.status(400).json({
        error: 'Invalid status',
        message: 'Estado debe ser: activa, cerrada o pausada'
      });
      return;
    }

    // Verificar que la encuesta existe
    const encuesta = await azureService.cargarEncuesta(id);
    if (!encuesta) {
      res.status(404).json({
        error: 'Survey not found',
        message: `Encuesta con ID ${id} no encontrada`
      });
      return;
    }

    // Actualizar estado
    const encuestaActualizada = {
      ...encuesta,
      estado: status,
      ultimaModificacion: new Date(),
      modificadoPor: req.user?.userName || 'Admin'
    };

    await azureService.guardarEncuesta(encuestaActualizada);

    console.log(`✅ Survey ${id} status changed to ${status}`);

    res.json({
      success: true,
      message: `Estado cambiado a: ${status}`,
      data: { id, newStatus: status },
      timestamp: new Date().toISOString(),
      changedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error changing survey status:', error);
    res.status(500).json({
      error: 'Failed to change status',
      message: 'Error al cambiar estado de la encuesta'
    });
  }
});

// 📄 POST /api/admin/surveys/:id/duplicate - Duplicar encuesta
router.post('/surveys/:id/duplicate', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { newTitle } = req.body;

    console.log(`📄 Survey duplication requested for ${id} by: ${req.user?.userName}`);

    // Verificar que la encuesta existe
    const encuestaOriginal = await azureService.cargarEncuesta(id);
    if (!encuestaOriginal) {
      res.status(404).json({
        error: 'Survey not found',
        message: `Encuesta con ID ${id} no encontrada`
      });
      return;
    }

    // Generar nuevo ID y título
    const nuevoId = `${id}_copy_${Date.now()}`;
    const nuevoTitulo = newTitle || `${encuestaOriginal.titulo} (Copia)`;

    // Crear encuesta duplicada
    const encuestaDuplicada = {
      ...encuestaOriginal,
      id: nuevoId,
      titulo: nuevoTitulo,
      fechaCreacion: new Date(),
      creador: req.user?.userName || 'Admin',
      estado: 'activa',
      basadoEn: id // Referencia a la encuesta original
    };

    // Guardar nueva encuesta
    await azureService.guardarEncuesta(encuestaDuplicada);

    // Crear resultados iniciales
    const resultadosIniciales = {
      encuestaId: nuevoId,
      titulo: nuevoTitulo,
      fechaCreacion: new Date(),
      estado: 'activa',
      totalParticipantes: 0,
      respuestas: [],
      resumen: {}
    };

    await azureService.guardarResultados(resultadosIniciales);

    console.log(`✅ Survey duplicated: ${id} -> ${nuevoId}`);

    res.json({
      success: true,
      message: 'Encuesta duplicada exitosamente',
      data: encuestaDuplicada,
      timestamp: new Date().toISOString(),
      duplicatedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error duplicating survey:', error);
    res.status(500).json({
      error: 'Failed to duplicate survey',
      message: 'Error al duplicar la encuesta'
    });
  }
});

// 🗑️ DELETE /api/admin/surveys/:id - Eliminar encuesta
router.delete('/surveys/:id', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { confirm } = req.query;

    console.log(`🗑️ Survey deletion requested for ${id} by: ${req.user?.userName}`);

    if (confirm !== 'true') {
      res.status(400).json({
        error: 'Confirmation required',
        message: 'Para eliminar, incluir ?confirm=true en la URL'
      });
      return;
    }

    // Verificar que la encuesta existe
    const encuesta = await azureService.cargarEncuesta(id);
    if (!encuesta) {
      res.status(404).json({
        error: 'Survey not found',
        message: `Encuesta con ID ${id} no encontrada`
      });
      return;
    }

    // Verificar si tiene respuestas (opcional: prevenir eliminación)
    const respuestas = await azureService.cargarRespuestasEncuesta(id);
    if (respuestas.length > 0) {
      console.log(`⚠️ Deleting survey ${id} with ${respuestas.length} responses`);
    }

    // TODO: Implementar eliminación real en Azure Tables
    // Por ahora, solo marcar como eliminada
    const encuestaEliminada = {
      ...encuesta,
      estado: 'eliminada',
      fechaEliminacion: new Date(),
      eliminadaPor: req.user?.userName || 'Admin'
    };

    await azureService.guardarEncuesta(encuestaEliminada);

    console.log(`✅ Survey ${id} marked as deleted`);

    res.json({
      success: true,
      message: 'Encuesta eliminada exitosamente',
      data: { id, deletedAt: new Date().toISOString() },
      timestamp: new Date().toISOString(),
      deletedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error deleting survey:', error);
    res.status(500).json({
      error: 'Failed to delete survey',
      message: 'Error al eliminar la encuesta'
    });
  }
});

// 📊 GET /api/admin/surveys/:id/responses - Ver respuestas detalladas
router.get('/surveys/:id/responses', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.query;

    console.log(`📊 Survey responses requested for ${id} by: ${req.user?.userName}`);

    // Verificar que la encuesta existe
    const encuesta = await azureService.cargarEncuesta(id);
    if (!encuesta) {
      res.status(404).json({
        error: 'Survey not found',
        message: `Encuesta con ID ${id} no encontrada`
      });
      return;
    }

    // Obtener respuestas
    const respuestas = await azureService.cargarRespuestasEncuesta(id);
    const resultados = await azureService.cargarResultados(id);

    // Calcular estadísticas
    const participantesUnicos = new Set(respuestas.map(r => r.participanteId));
    const estadisticas = {
      totalRespuestas: respuestas.length,
      totalParticipantes: participantesUnicos.size,
      respuestasPorPregunta: {},
      distribucionTemporal: {}
    };

    // Calcular distribución por pregunta
    encuesta.preguntas.forEach((pregunta: any, index: number) => {
      const respuestasPregunta = respuestas.filter(r => r.preguntaIndex === index);
      const distribucion: any = {};
      
      pregunta.opciones.forEach((opcion: string) => {
        distribucion[opcion] = respuestasPregunta.filter(r => r.respuesta === opcion).length;
      });

      estadisticas.respuestasPorPregunta[index] = {
        pregunta: pregunta.pregunta,
        total: respuestasPregunta.length,
        distribucion
      };
    });

    if (format === 'csv') {
      // Generar CSV para exportación
      const csvData = generateResponsesCSV(encuesta, respuestas);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="respuestas_${id}.csv"`);
      res.send(csvData);
      return;
    }

    res.json({
      success: true,
      data: {
        encuesta: {
          id: encuesta.id,
          titulo: encuesta.titulo,
          objetivo: encuesta.objetivo,
          fechaCreacion: encuesta.fechaCreacion
        },
        estadisticas,
        respuestas: respuestas.map(r => ({
          ...r,
          participanteId: `***${r.participanteId.slice(-4)}` // Anonimizar parcialmente
        })),
        resultados
      },
      timestamp: new Date().toISOString(),
      requestedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error getting survey responses:', error);
    res.status(500).json({
      error: 'Failed to get responses',
      message: 'Error al obtener respuestas de la encuesta'
    });
  }
});

// ────────────────────────────────────────────────────────────
// FUNCIONES AUXILIARES
// ────────────────────────────────────────────────────────────

function getTopCreators(encuestas: any[]): any[] {
  const creators: { [key: string]: number } = {};
  
  encuestas.forEach(encuesta => {
    creators[encuesta.creador] = (creators[encuesta.creador] || 0) + 1;
  });

  return Object.entries(creators)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function getTemplateUsage(encuestas: any[]): any[] {
  const templates: { [key: string]: number } = {};
  
  encuestas.forEach(encuesta => {
    if (encuesta.basadoEnTemplate) {
      templates[encuesta.basadoEnTemplate] = (templates[encuesta.basadoEnTemplate] || 0) + 1;
    }
  });

  return Object.entries(templates)
    .map(([template, count]) => ({ template, count }))
    .sort((a, b) => b.count - a.count);
}

function generateResponsesCSV(encuesta: any, respuestas: any[]): string {
  let csv = `"Encuesta","${encuesta.titulo}"\n`;
  csv += `"Fecha Creación","${new Date(encuesta.fechaCreacion).toLocaleString()}"\n`;
  csv += `"Total Respuestas","${respuestas.length}"\n\n`;
  
  csv += `"Participante","Pregunta","Respuesta","Fecha Respuesta"\n`;
  
  respuestas.forEach(respuesta => {
    const preguntaTexto = encuesta.preguntas[respuesta.preguntaIndex]?.pregunta || 'N/A';
    csv += `"***${respuesta.participanteId.slice(-4)}","${preguntaTexto}","${respuesta.respuesta}","${new Date(respuesta.timestamp).toLocaleString()}"\n`;
  });

  return csv;
}

export { router as adminRouter };