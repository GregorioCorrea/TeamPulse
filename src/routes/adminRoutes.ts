// src/routes/adminRoutes.ts
import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { AzureTableService } from "../services/azureTableService";
import { localAdminStore } from "../services/localAdminStore";

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
    console.log('🔐 [ADMIN AUTH] Starting validation...');
    
    const authHeader = req.headers.authorization;
    console.log('🔐 [ADMIN AUTH] Auth header present:', !!authHeader);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('🔐 [ADMIN AUTH] Missing or invalid auth header format');
      
      // En desarrollo, permitir acceso sin token
      if (process.env.NODE_ENV === 'development') {
        console.log('🔐 [ADMIN AUTH] Development mode - bypassing auth');
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
    
    // Validar token JWT
    const decodedUser = await validateJWTToken(token);
    console.log('🔐 [ADMIN AUTH] Decoded user:', decodedUser ? 'Success' : 'Failed');
    
    if (!decodedUser) {
      console.log('🔐 [ADMIN AUTH] Token validation failed');
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Teams SSO token is invalid or expired'
      });
    }

    console.log('🔐 [ADMIN AUTH] User decoded:', {
      userId: decodedUser.userId,
      tenantId: decodedUser.tenantId,
      name: decodedUser.userName
    });

    // Verificar permisos de admin
    const isAdmin = await checkAdminPermissions(decodedUser.userId, decodedUser.tenantId);
    console.log('🔐 [ADMIN AUTH] Admin check result:', isAdmin);
    
    if (!isAdmin) {
      console.log('🔐 [ADMIN AUTH] Admin permissions denied');
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'Admin panel access requires administrator privileges'
      });
    }

    req.user = {
      ...decodedUser,
      isAdmin: true
    };

    console.log('🔐 [ADMIN AUTH] Validation successful, proceeding...');
    next();
  } catch (error) {
    console.error('🔐 [ADMIN AUTH] Error during validation:', error);
    res.status(500).json({ 
      error: 'Authentication error',
      message: 'Failed to validate user credentials'
    });
  }
}

// Función auxiliar para validar JWT (implementar según necesidades)
async function validateJWTToken(token: string): Promise<any> {
  try {
    console.log('🔐 [JWT] Starting token validation...');

    if (process.env.NODE_ENV === 'development') {
      console.log('🔐 [JWT] Development mode - returning mock user');
      return {
        userId: 'admin-user-123',
        tenantId: 'tenant-456',
        userName: 'Admin User',
        email: 'admin@company.com'
      };
    }

    // Decodificar payload de JWT sin verificar firma (solo extracción de claims)
    // ⚠️ Nota: Para producción, validar firma con jwks (Entra). Esto es lectura de claims.
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);

    const userData = {
      userId: payload.sub || payload.oid,
      tenantId: payload.tid,
      userName: payload.name || payload.preferred_username || 'Unknown User',
      email: payload.email || payload.upn || `${payload.sub}@${payload.tid}.onmicrosoft.com`
    };

    console.log('🔐 [JWT] Extracted user data:', {
      userId: userData.userId,
      tenantId: userData.tenantId,
      name: userData.userName
    });

    // 🚫 IMPORTANTE: no hacer auto‑promoción acá (se maneja en checkAdminPermissions).
    return userData;

  } catch (error) {
    console.error('🔐 [JWT] Error validating JWT:', error);
    return null;
  }
}


// Bloque de auto-promoción
async function checkAdminPermissions(userId: string, tenantId: string): Promise<boolean> {
  try {
    // 1. Verificar si ya es admin
    const adminUser = await azureService.obtenerAdminUser(userId, tenantId);
    if (adminUser && adminUser.isActive) {
      return true;
    }
    
    // 2. 🆕 SMART CHECK: ¿Es el usuario que activó la suscripción?
    const subscription = await checkMarketplaceSubscription(userId, tenantId);
    if (subscription && subscription.userOid === userId) {
      console.log(`🚀 Auto-promoting marketplace purchaser: ${userId}`);
      
      await azureService.agregarAdminUser(
        userId,
        tenantId,
        subscription.userEmail,
        subscription.userName,
        'Marketplace Purchaser Auto-Promotion'
      );
      
      return true;
    }
    
    // 3. Fallback para desarrollo
    if (process.env.NODE_ENV === 'development') {
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('❌ Error checking admin permissions:', error);
    return false;
  }
}

// Función auxiliar para verificar suscripción en Marketplace
async function checkMarketplaceSubscription(userId: string, tenantId: string) {
  try {
    const subscription = await azureService.obtenerSuscripcionMarketplace(userId, tenantId);
    
    if (subscription && subscription.userOid === userId) {
      console.log(`✅ Found marketplace subscription for user: ${userId}`);
      return subscription;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error checking marketplace subscription:', error);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// GUARDS DE ROL Y PLAN (locales a adminRoutes)
// ────────────────────────────────────────────────────────────

function requireAdmin(req: AuthenticatedRequest, res: Response, next: any) {
  if (req.user?.isAdmin) return next();
  return res.status(403).json({
    error: 'forbidden_role',
    message: 'Se requieren privilegios de administrador'
  });
}

// Usamos import dinámico para no generar ciclos
function requirePlan(allowed: Array<'free' | 'pro' | 'enterprise'>) {
  // Normalizador de planes: acepta variantes y devuelve el slug estándar
  const normalizePlan = (p: string | undefined | null): 'free' | 'pro' | 'enterprise' => {
    const v = (p || '').toLowerCase().trim();
    if (v === 'enterprise' || v === 'ent' || v === 'enterp' || v === 'enterpriseplan') return 'enterprise';
    if (v === 'pro' || v === 'professional') return 'pro';
    return 'free';
  };

  return async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: 'Tenant ID required' });

      const { getPlan } = await import("../middleware/planLimiter");
      // getPlan puede devolver 'free' | 'pro' | 'enterprise' | 'ent' | etc.
      const rawPlan = await getPlan(tenantId);
      const plan = normalizePlan(rawPlan as unknown as string);

      if (!allowed.includes(plan)) {
        return res.status(402).json({
          error: 'plan_not_allowed',
          message: `Tu plan (${plan}) no habilita esta acción`
        });
      }
      return next();
    } catch (e) {
      console.error('❌ Error en requirePlan:', e);
      return res.status(500).json({ error: 'plan_check_failed' });
    }
  };
}


// ────────────────────────────────────────────────────────────
// RUTAS DEL PANEL DE ADMINISTRACIÓN
// ────────────────────────────────────────────────────────────

// 📊 GET /api/admin/stats - Estadísticas del dashboard
router.get('/stats', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    console.log(`📊 Admin stats requested by: ${req.user?.userName}`);

    // Obtener todas las encuestas
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID required' });
      return;
    }

    const encuestas = await azureService.listarEncuestas(tenantId);

    
    // Calcular estadísticas
    const totalSurveys = encuestas.length;
    const activeSurveys = encuestas.filter(e => e.estado !== 'cerrada').length;
    
    // Obtener total de respuestas de todas las encuestas
    let totalResponses = 0;
    for (const encuesta of encuestas) {
      try {
        const respuestas = await azureService.cargarRespuestasEncuesta(encuesta.id!, tenantId);
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
    return;

  } catch (error) {
    console.error('❌ Error getting admin stats:', error);
    res.status(500).json({
      error: 'Failed to get statistics',
      message: 'Error al obtener estadísticas del dashboard'
    });
    return;
  }
});

// 📋 GET /api/admin/surveys - Listar todas las encuestas con metadata extendida
router.get('/surveys', validateTeamsSSO, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log(`📋 Admin surveys list requested by: ${req.user?.userName}`);

    const { search, status, creator, limit = 50, offset = 0 } = req.query;

    // Obtener todas las encuestas
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID required' });
      return;
    }

    let encuestas: any[] = [];
    let azureError: any = null;

    try {
      encuestas = await azureService.listarEncuestas(tenantId);
    } catch (error) {
      azureError = error;
      console.error('⚠️ No se pudieron obtener encuestas desde Azure, usando almacenamiento local:', error);
      encuestas = [];
    }

    // Enriquecer cada encuesta con datos de respuestas
    const encuestasEnriquecidas = await Promise.all(
      encuestas.map(async (encuesta) => {
        try {
          const respuestas = await azureService.cargarRespuestasEncuesta(encuesta.id!, tenantId);
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
            totalRespuestas: encuesta.totalRespuestas ?? 0,
            ultimaRespuesta: null,
            estado: encuesta.estado || 'activa'
          };
        }
      })
    );

    // Incorporar encuestas locales si existen
    const fallbackSurveys = localAdminStore.listSurveys();
    let combinedSurveys = encuestasEnriquecidas;

    if (fallbackSurveys.length > 0) {
      const azureIds = new Set(encuestasEnriquecidas.map((survey) => survey.id));
      const complement = fallbackSurveys
        .filter((survey) => !azureIds.has(survey.id))
        .map((survey) => ({
          ...survey,
          tenantId: survey.tenantId || tenantId,
          totalRespuestas: survey.totalRespuestas || 0,
          ultimaRespuesta: null,
        }));

      combinedSurveys = [...complement, ...encuestasEnriquecidas];
    }

    // Aplicar filtros
    let filteredSurveys = combinedSurveys;

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
      timestamp: new Date().toISOString(),
      storageSource: azureError ? 'local' : 'azure',
      fallbackCount: fallbackSurveys.length
    });

  } catch (error) {
    console.error('❌ Error getting surveys list:', error);
    res.status(500).json({
      error: 'Failed to get surveys',
      message: 'Error al obtener lista de encuestas'
    });
  }
});

// ➕ POST /api/admin/surveys - Crear una nueva encuesta desde el panel
router.post(
  '/surveys',
  validateTeamsSSO,
  requireAdmin,
  requirePlan(['free', 'pro', 'enterprise']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(400).json({
          error: 'tenant_required',
          message: 'Tenant ID es requerido para crear encuestas'
        });
        return;
      }

      const { titulo, objetivo, preguntas, basadoEnTemplate, tags } = req.body || {};

      if (!titulo || !objetivo) {
        res.status(400).json({
          error: 'missing_fields',
          message: 'Título y objetivo son obligatorios'
        });
        return;
      }

      if (!preguntas || !Array.isArray(preguntas) || preguntas.length === 0) {
        res.status(400).json({
          error: 'invalid_questions',
          message: 'Debes incluir al menos una pregunta con opciones'
        });
        return;
      }

      const preguntasSanitizadas = [] as Array<{ pregunta: string; opciones: string[] }>;
      for (let i = 0; i < preguntas.length; i++) {
        const pregunta = preguntas[i];
        const textoPregunta = (pregunta?.pregunta || '').toString().trim();
        const opciones = Array.isArray(pregunta?.opciones)
          ? pregunta.opciones.map((opt: string) => (opt || '').toString().trim()).filter(Boolean)
          : [];

        if (!textoPregunta) {
          res.status(400).json({
            error: 'invalid_question_text',
            message: `La pregunta ${i + 1} necesita un texto descriptivo`
          });
          return;
        }

        if (opciones.length < 2) {
          res.status(400).json({
            error: 'invalid_question_options',
            message: `La pregunta ${i + 1} requiere al menos dos opciones`
          });
          return;
        }

        preguntasSanitizadas.push({ pregunta: textoPregunta, opciones });
      }

      const baseSlug = titulo
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      const uniqueSuffix = randomUUID().split('-')[0];
      const encuestaId = `${baseSlug || 'encuesta'}-${uniqueSuffix}`;

      const ahora = new Date();
      const creador = req.user?.userName || req.user?.userId || 'Administrador';

      const nuevaEncuesta = {
        id: encuestaId,
        titulo: titulo.trim(),
        objetivo: objetivo.trim(),
        preguntas: preguntasSanitizadas,
        tenantId,
        creador,
        estado: 'activa',
        fechaCreacion: ahora.toISOString(),
        ultimaModificacion: ahora.toISOString(),
        totalRespuestas: 0,
        basadoEnTemplate: basadoEnTemplate || null,
        tags: Array.isArray(tags) ? tags : []
      };

      try {
        await azureService.guardarEncuesta(nuevaEncuesta);

        try {
          await azureService.guardarResultados({
            encuestaId,
            titulo: nuevaEncuesta.titulo,
            fechaCreacion: ahora,
            estado: 'activa',
            totalParticipantes: 0,
            respuestas: [],
            resumen: {}
          });
        } catch (error) {
          console.warn('⚠️ No se pudieron guardar resultados iniciales en Azure:', error);
        }

        try {
          await (await import("../middleware/planLimiter")).registerSurveyCreation(tenantId);
        } catch (error) {
          console.warn('⚠️ No se pudo registrar el consumo de plan en Azure:', error);
        }

        console.log(`✅ Nueva encuesta creada en Azure: ${encuestaId} por ${creador}`);

        res.status(201).json({
          success: true,
          message: 'Encuesta creada exitosamente',
          data: nuevaEncuesta,
          timestamp: ahora.toISOString(),
          createdBy: creador,
          storageSource: 'azure'
        });
        return;

      } catch (azureError) {
        console.error('❌ No se pudo guardar la encuesta en Azure, usando almacenamiento local:', azureError);

        const localSurvey = localAdminStore.addSurvey({
          ...nuevaEncuesta,
          tenantId,
          estado: 'activa',
          fechaCreacion: ahora.toISOString(),
          totalRespuestas: 0
        });

        localAdminStore.saveResults({
          encuestaId,
          titulo: nuevaEncuesta.titulo,
          fechaCreacion: ahora.toISOString(),
          estado: 'activa',
          totalParticipantes: 0,
          respuestas: [],
          resumen: {}
        });

        res.status(201).json({
          success: true,
          message: 'Encuesta creada en modo sin conexión (Azure no disponible)',
          data: localSurvey,
          timestamp: ahora.toISOString(),
          createdBy: creador,
          storageSource: 'local'
        });
        return;
      }

    } catch (error) {
      console.error('❌ Error creating survey from admin panel:', error);
      res.status(500).json({
        error: 'failed_to_create_survey',
        message: 'Error al crear la encuesta'
      });
    }
  }
);

// 📝 PUT /api/admin/surveys/:id - Actualizar encuesta completa
router.put('/surveys/:id', validateTeamsSSO, requireAdmin, requirePlan(['pro','enterprise']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { titulo, objetivo, preguntas } = req.body;

    console.log(`📝 Survey update requested for ${id} by: ${req.user?.userName}`);

    // Validaciones
    
    // 🆕 Verificar ownership antes de actualizar
    const tenantId = req.user?.tenantId;
    const hasAccess = await azureService.verificarOwnershipEncuesta(id, tenantId);

    if (!hasAccess) {
      res.status(403).json({ 
        error: 'Access denied',
        message: 'No tienes permisos para editar esta encuesta'
      });
      return;
    }

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
    fechaCreacion: (() => {
        // 🔧 FIX: Mantener fechaCreacion original como string
        if (!encuestaExistente.fechaCreacion) return new Date().toISOString();
        if (encuestaExistente.fechaCreacion instanceof Date) return encuestaExistente.fechaCreacion.toISOString();
        if (typeof encuestaExistente.fechaCreacion === 'string') return encuestaExistente.fechaCreacion;
        return new Date().toISOString();
    })(),
    ultimaModificacion: new Date(), // Date object OK aquí
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
router.patch('/surveys/:id/status', validateTeamsSSO, requireAdmin, requirePlan(['pro','enterprise']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
    res.status(400).json({ error: 'Tenant ID required' });
    return;
    }

    const hasAccess = await azureService.verificarOwnershipEncuesta(id, tenantId);
    if (!hasAccess) {
    res.status(403).json({ 
        error: 'Access denied',
        message: 'No tienes permisos para modificar esta encuesta'
    });
    return;
    }

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
router.post('/surveys/:id/duplicate', validateTeamsSSO, requireAdmin, requirePlan(['pro','enterprise']), async (req: AuthenticatedRequest, res: Response) => {
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
router.delete('/surveys/:id', validateTeamsSSO, requireAdmin, requirePlan(['pro','enterprise']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { confirm } = req.query;

    console.log(`🗑️ Survey deletion requested for ${id} by: ${req.user?.userName}`);

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
    res.status(400).json({ error: 'Tenant ID required' });
    return;
    }

    const hasAccess = await azureService.verificarOwnershipEncuesta(id, tenantId);
    if (!hasAccess) {
    res.status(403).json({ 
        error: 'Access denied',
        message: 'No tienes permisos para eliminar esta encuesta'
    });
    return;
    }
    
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
    const respuestas = await azureService.cargarRespuestasEncuesta(id, tenantId);
    if (respuestas.length > 0) {
      console.log(`⚠️ Deleting survey ${id} with ${respuestas.length} responses`);
    }

    // 🔧 FIX: Manejar fechaCreacion correctamente
    const fechaCreacion = (() => {
      if (!encuesta.fechaCreacion) return new Date().toISOString();
      if (encuesta.fechaCreacion instanceof Date) return encuesta.fechaCreacion;
      if (typeof encuesta.fechaCreacion === 'string') return encuesta.fechaCreacion;
      return new Date().toISOString();
    })();

    
    // Marcar como eliminada
    const encuestaEliminada = {
      ...encuesta,
      fechaCreacion: fechaCreacion, // 🔧 FIX: Asegurar que sea string
      estado: 'eliminada',
      fechaEliminacion: new Date(), // Date object está OK aquí
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
router.get('/surveys/:id/responses', validateTeamsSSO, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
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
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
    res.status(400).json({ error: 'Tenant ID required' });
    return;
    }

    const hasAccess = await azureService.verificarOwnershipEncuesta(id, tenantId);
    if (!hasAccess) {
    res.status(403).json({ 
        error: 'Access denied',
        message: 'No tienes permisos para ver las respuestas de esta encuesta'
    });
    return;
    }

    const respuestas = await azureService.cargarRespuestasEncuesta(id, tenantId);
    const resultados = await azureService.cargarResultados(id, tenantId);

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

// 📊 DASHBOARD EJECUTIVO - Agregar estas rutas al final de adminRoutes.ts

// 📈 GET /api/admin/dashboard/metrics - Métricas KPI en tiempo real
router.get('/dashboard/metrics', validateTeamsSSO, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log(`📈 Dashboard metrics requested by: ${req.user?.userName}`);

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID required' });
      return;
    }

    // 1. Obtener todas las encuestas del tenant
    const encuestas = await azureService.listarEncuestas(tenantId);
    
    // 2. Calcular métricas de tiempo real
    const ahora = new Date();
    const hace30dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const hace7dias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    let totalResponses = 0;
    let responsesLast7Days = 0;
    let responsesLast30Days = 0;
    let avgSatisfactionScore = 0;
    let satisfactionScores: number[] = [];

    // 3. Procesar cada encuesta
    for (const encuesta of encuestas) {
      try {
        const respuestas = await azureService.cargarRespuestasEncuesta(encuesta.id!, tenantId);
        const participantesUnicos = new Set(respuestas.map(r => r.participanteId));
        totalResponses += participantesUnicos.size;
        
        // Respuestas por período
        respuestas.forEach(resp => {
          const fechaResp = new Date(resp.timestamp);
          if (fechaResp >= hace7dias) responsesLast7Days++;
          if (fechaResp >= hace30dias) responsesLast30Days++;
        });

        // Calcular satisfaction score básico (% respuestas positivas)
        if (respuestas.length > 0) {
          const respuestasPositivas = respuestas.filter(r => 
            r.respuesta.toLowerCase().includes('excelente') ||
            r.respuesta.toLowerCase().includes('bueno') ||
            r.respuesta.toLowerCase().includes('sí') ||
            r.respuesta.toLowerCase().includes('siempre')
          ).length;
          
          const score = (respuestasPositivas / respuestas.length) * 100;
          satisfactionScores.push(score);
        }
      } catch (error) {
        console.warn(`⚠️ Error procesando encuesta ${encuesta.id}:`, error);
      }
    }

    // 4. Calcular promedios
    avgSatisfactionScore = satisfactionScores.length > 0 
      ? Math.round(satisfactionScores.reduce((a, b) => a + b, 0) / satisfactionScores.length)
      : 0;

    const activeSurveys = encuestas.filter(e => e.estado === 'activa').length;
    const engagementRate = encuestas.length > 0 
      ? Math.round((totalResponses / encuestas.length) * 10) // Factor de escala
      : 0;

    // 5. Calcular trends (comparación con períodos anteriores)
    const responseGrowth = responsesLast7Days > 0 ? 
      Math.round(((responsesLast7Days - (responsesLast30Days - responsesLast7Days)) / (responsesLast30Days - responsesLast7Days || 1)) * 100) : 0;

    const metrics = {
      kpis: {
        totalSurveys: {
          value: encuestas.length,
          trend: '+5%', // Calcular dinámicamente después
          icon: '📋'
        },
        activeSurveys: {
          value: activeSurveys,
          trend: activeSurveys > (encuestas.length * 0.7) ? '+12%' : '-3%',
          icon: '🟢'
        },
        totalResponses: {
          value: totalResponses,
          trend: responseGrowth > 0 ? `+${responseGrowth}%` : `${responseGrowth}%`,
          icon: '👥'
        },
        avgSatisfaction: {
          value: avgSatisfactionScore,
          trend: avgSatisfactionScore > 75 ? '+8%' : avgSatisfactionScore > 50 ? '+2%' : '-5%',
          icon: '😊'
        },
        engagementRate: {
          value: engagementRate,
          trend: engagementRate > 70 ? '+15%' : '+3%',
          icon: '⚡'
        },
        responsesThisWeek: {
          value: responsesLast7Days,
          trend: responsesLast7Days > (responsesLast30Days / 4) ? '+25%' : '-10%',
          icon: '📈'
        }
      },
      realTimeActivity: {
        responsesToday: Math.round(responsesLast7Days / 7), // Aproximación
        surveysCreatedThisWeek: encuestas.filter(e => {
          const fechaCreacion = new Date(e.fechaCreacion);
          return fechaCreacion >= hace7dias;
        }).length,
        activeUsers: Math.round(totalResponses * 0.8), // Estimación
        alertsCount: satisfactionScores.filter(s => s < 40).length
      }
    };

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
      requestedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error getting dashboard metrics:', error);
    res.status(500).json({
      error: 'Failed to get metrics',
      message: 'Error al obtener métricas del dashboard'
    });
  }
});

// 📊 GET /api/admin/dashboard/charts - Datos para gráficos
router.get('/dashboard/charts', validateTeamsSSO, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log(`📊 Dashboard charts requested by: ${req.user?.userName}`);

    const tenantId = req.user?.tenantId;
    const { period = '30d', chartType = 'all' } = req.query;

    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID required' });
      return;
    }

    const encuestas = await azureService.listarEncuestas(tenantId);
    
    // Calcular período
    const ahora = new Date();
    let diasAtras = 30;
    if (period === '7d') diasAtras = 7;
    else if (period === '90d') diasAtras = 90;
    
    const fechaInicio = new Date(ahora.getTime() - diasAtras * 24 * 60 * 60 * 1000);

    // 1. Datos para gráfico de respuestas por día
    const responsesByDay: { [key: string]: number } = {};
    
    // 2. Datos para gráfico de satisfacción por encuesta
    const satisfactionBySurvey: { name: string; score: number; responses: number }[] = [];
    
    // 3. Datos para distribución de respuestas
    const responseDistribution: { label: string; value: number; color: string }[] = [];

    for (const encuesta of encuestas) {
      try {
        const respuestas = await azureService.cargarRespuestasEncuesta(encuesta.id!, tenantId);
        
        // Agrupar respuestas por día
        respuestas.forEach(resp => {
          const fecha = new Date(resp.timestamp);
          if (fecha >= fechaInicio) {
            const key = fecha.toISOString().split('T')[0]; // YYYY-MM-DD
            responsesByDay[key] = (responsesByDay[key] || 0) + 1;
          }
        });

        // Calcular satisfaction score por encuesta
        if (respuestas.length > 0) {
          const respuestasPositivas = respuestas.filter(r => 
            r.respuesta.toLowerCase().includes('excelente') ||
            r.respuesta.toLowerCase().includes('bueno') ||
            r.respuesta.toLowerCase().includes('sí') ||
            r.respuesta.toLowerCase().includes('siempre')
          ).length;
          
          const score = Math.round((respuestasPositivas / respuestas.length) * 100);
          const participantes = new Set(respuestas.map(r => r.participanteId)).size;
          
          satisfactionBySurvey.push({
            name: encuesta.titulo.length > 20 ? encuesta.titulo.substring(0, 20) + '...' : encuesta.titulo,
            score,
            responses: participantes
          });
        }
      } catch (error) {
        console.warn(`⚠️ Error procesando encuesta ${encuesta.id}:`, error);
      }
    }

    // Llenar días faltantes con 0
    for (let i = 0; i < diasAtras; i++) {
      const fecha = new Date(fechaInicio.getTime() + i * 24 * 60 * 60 * 1000);
      const key = fecha.toISOString().split('T')[0];
      if (!responsesByDay[key]) {
        responsesByDay[key] = 0;
      }
    }

    // Preparar datos para Chart.js
    const chartData = {
      responsesTrend: {
        labels: Object.keys(responsesByDay).sort().map(date => {
          const d = new Date(date);
          return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
        }),
        datasets: [{
          label: 'Respuestas por día',
          data: Object.keys(responsesByDay).sort().map(date => responsesByDay[date]),
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      
      satisfactionScores: {
        labels: satisfactionBySurvey.map(s => s.name),
        datasets: [{
          label: 'Score de Satisfacción (%)',
          data: satisfactionBySurvey.map(s => s.score),
          backgroundColor: satisfactionBySurvey.map(s => 
            s.score >= 80 ? '#48bb78' : 
            s.score >= 60 ? '#ed8936' : '#f56565'
          ),
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },

      surveyPerformance: {
        labels: satisfactionBySurvey.map(s => s.name),
        datasets: [
          {
            label: 'Satisfacción (%)',
            data: satisfactionBySurvey.map(s => s.score),
            backgroundColor: '#667eea',
            yAxisID: 'y'
          },
          {
            label: 'Respuestas',
            data: satisfactionBySurvey.map(s => s.responses),
            backgroundColor: '#764ba2',
            yAxisID: 'y1'
          }
        ]
      }
    };

    res.json({
      success: true,
      data: chartData,
      period,
      timestamp: new Date().toISOString(),
      requestedBy: req.user?.userName
    });

  } catch (error) {
    console.error('❌ Error getting chart data:', error);
    res.status(500).json({
      error: 'Failed to get chart data',
      message: 'Error al obtener datos de gráficos'
    });
  }
});

// 📊 GET /api/admin/plan-info - Información del plan actual
router.get('/plan-info', validateTeamsSSO, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID required' });
      return;
    }
    
    // Importar función de plan
    const { getPlan, getUsageSummary } = await import("../middleware/planLimiter");
    
    const planType = await getPlan(tenantId);
    const usageInfo = await getUsageSummary(tenantId);
    
    res.json({
      success: true,
      data: {
        plan: planType,
        usage: usageInfo,
        tenant: tenantId
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting plan info:', error);
    res.status(500).json({
      error: 'Failed to get plan info',
      message: 'Error al obtener información del plan'
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
