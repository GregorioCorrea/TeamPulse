# Guía rápida de validación TeamPulse

## Acceso de administrador para QA
- Ejecutar `make_me_admin` desde el chat del bot apenas se instala la app en un tenant limpio.
- Si ya existe un administrador en el tenant, el bot listará sus datos y pedirá usar `force_make_me_admin`.
- `force_make_me_admin` vuelve a promocionar al usuario actual (o actualiza sus datos) manteniendo el registro en Azure Table.
- Cada comando muestra el Object ID, UPN y tenant detectado; verificá que coincidan con el usuario de prueba antes de continuar.

## Registro de suscripciones Marketplace
1. Realizar la prueba de onboarding/compra desde el landing o desde el portal comercial.
2. Confirmar en Azure Table Storage (`MarketplaceSubscriptions`) que el registro del `subscriptionId` tenga:
   - `userTenant`, `userName`, `planId`, `status` y `lastModified` recientes.
   - `status` = `Activated` para tenants con permisos completos. Estados `Suspended` o `Unsubscribed` degradan al plan free.
3. Probar un cambio de plan o suspensión para comprobar que el webhook actualiza la misma fila (verificar `operationAction`, `operationState` y la nueva `lastModified`).
4. Ejecutar el comando `admin_diagnose` en el bot para ver el plan detectado por `getPlan` y contrastar con los datos de la tabla.

## Checklist final antes de entregar a validación
- Acceso al portal de administración confirmado con el usuario que instaló la app.
- Búsqueda de usuarios para asignar roles funcionando en el tenant correspondiente.
- Acciones de encuesta (crear, pausar, editar, borrar) habilitadas para administradores/gestores según el rol.
- Tabla `MarketplaceSubscriptions` y cálculo de plan consistentes después de realizar las operaciones de marketplace que quieras que QA pruebe.
