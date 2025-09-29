# Internacionalización (i18n)

Este directorio documenta la infraestructura de localización agregada para TeamPulse.

## Estructura

```
src/i18n/
├── catalogs/
│   ├── en.json   # Catálogo en inglés
│   └── es.json   # Catálogo en español
└── index.ts      # Helper de traducciones compartido
```

Cada catálogo contiene namespaces (`common`, `bot`, `admin`, etc.). Para agregar un nuevo idioma:

1. Crear `src/i18n/catalogs/<idioma>.json` siguiendo la misma estructura.
2. Registrar textos nuevos dentro de los namespaces existentes o crear uno nuevo.
3. (Opcional) Si el idioma no existía, podés registrarlo en tiempo de ejecución con `registerCatalog(locale, catalog)`.

## Uso básico

```ts
import { translate, ensureLocale } from "../i18n";

const locale = ensureLocale(context.activity.locale); // ej. "en" o "es"
const welcome = translate("bot.greeting", { locale });
await context.sendActivity(welcome);
```

### Placeholders

Las cadenas admiten placeholders con `{{nombre}}`:

```json
"bot": {
  "surveyAssigned": "You have {{count}} surveys pending"
}
```

```ts
translate("bot.surveyAssigned", {
  locale: "en",
  params: { count: 3 }
});
// => "You have 3 surveys pending"
```

### Fallbacks

La función `translate` intenta en este orden:

1. Locale normalizado (por ejemplo, `en-us` → `en`).
2. Idioma por defecto (`es`).
3. Idioma de respaldo (`en`).
4. Valor por defecto (`defaultValue`) o clave solicitada.

Para registrar idiomas de manera dinámica (por ejemplo, cargados desde almacenamiento):

```ts
import { registerCatalog } from "../i18n";
registerCatalog("pt", ptCatalog);
```

## Próximos pasos

- Reemplazar literales en bot y panel por `translate(...)`.
- Sincronizar este repositorio con la herramienta de traducciones que defina el equipo.
- Añadir pruebas automatizadas que verifiquen que no haya claves faltantes.
