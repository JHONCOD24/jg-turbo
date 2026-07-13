# Persistencia de configuración — JG Turbo

Documento para **humanos y agentes de IA**. Objetivo: que las actualizaciones de código **nunca borren** las preferencias del usuario (claves, glosario, proveedor, etc.).

## Dónde vive cada cosa

| Dato | Dónde se guarda | ¿Sobrevive un deploy en Vercel? |
|---|---|---|
| Clave Gemini / OpenRouter / etc. | `localStorage` → `jg_api_key` | **Sí** (mismo dominio del navegador) |
| Clave Groq | `localStorage` → `jg_groq_api_key` | **Sí** |
| Glosario técnico | `localStorage` → `jg_glossary` | **Sí** |
| Proveedor de IA | `jg_ai_provider` | **Sí** |
| Modelo OpenRouter | `jg_openrouter_model` | **Sí** |
| Calidad micrófono | `jg_mic_quality` | **Sí** |
| Idioma del texto transcrito | `jg_output_lang` | **Sí** |
| Modelo Whisper local | `jg_whisper_model` | **Sí** (solo aplica en PC) |
| Bundle de respaldo | `jg_config_bundle` (JSON) | **Sí** |
| `GROQ_API_KEY` en servidor | Variables de entorno de Vercel | **Sí**, si se configura en el dashboard |

**Importante:** Vercel **no** tiene hoy variables de entorno configuradas en el proyecto. La transcripción en la nube depende de la clave Groq en el **navegador** del usuario, salvo que alguien agregue `GROQ_API_KEY` en Vercel → Settings → Environment Variables.

## Claves de `localStorage` (NO renombrar sin migración)

Definidas en `index.html` como `JG_CONFIG_KEYS`:

- `jg_server`
- `jg_ai_provider`
- `jg_api_key`
- `jg_groq_api_key`
- `jg_openrouter_model`
- `jg_glossary`
- `jg_whisper_model`
- `jg_mic_quality`
- `jg_output_lang` (idioma del texto transcrito: mismo / en / es)
- `jg_config_bundle` (snapshot JSON versionado)
- `jg_glossary_seeded` (flag: ya se sembró glosario por defecto)

## Reglas obligatorias para agentes / futuros LLM

1. **No borrar** `localStorage` del usuario (`clear()`, `removeItem` masivo, etc.).
2. **No renombrar** claves `jg_*` sin:
   - leer la clave antigua,
   - copiar al nombre nuevo,
   - dejar la antigua un tiempo (migración).
3. **No sobrescribir** glosario o claves con cadena vacía que venga del servidor (en Vercel `/api/glossary` es stub vacío).
4. Al **Guardar** ajustes: si el campo de API key viene vacío, **conservar** la clave ya guardada (no borrarla).
5. Tras cualquier cambio de preferencias: llamar `jgCfgSnapshot()` (o el equivalente) para actualizar `jg_config_bundle`.
6. Deploy de producción: carpeta `vercel_deploy/` (sincronizar `index.html` + `api/` desde `Spech to text App/`).
7. No commitear claves reales ni meter secretos en el HTML.

## Exportar / importar (UI)

En **Configuración** hay:

- **Exportar config** → descarga `jg-turbo-config-YYYY-MM-DD.json` (incluye claves; uso personal).
- **Importar config** → restaura claves y glosario en el navegador.

Útil al cambiar de PC o tras limpiar datos del sitio.

## Qué NO es persistente (normal)

- Texto de la última transcripción (no se guarda en el servidor).
- Historial de deshacer ↩ (solo en memoria de la pestaña).
- Token de sesión del backend local (se regenera al reiniciar el servidor local).

## Checklist antes de un deploy

- [ ] ¿Cambié nombres de `localStorage`? → migración obligatoria.
- [ ] ¿El servidor devuelve glosario vacío en la nube? → no pisar el del cliente.
- [ ] ¿Probé abrir Configuración y ver “IA ✓ · Groq ✓ · Glosario ✓”?
- [ ] ¿Sincronicé `Spech to text App/index.html` → `vercel_deploy/index.html`?

## Proyecto y producción

- Workspace: `B:\PROYECTS\JG Turbo\`
- App local + git: `B:\PROYECTS\JG Turbo\Spech to text App\`
- Deploy CLI: `B:\PROYECTS\JG Turbo\vercel_deploy\`
- GitHub: `JHONCOD24/jg-turbo` (raíz del repo = esta carpeta app)
- URL: https://jg-turbo.vercel.app
- Cuenta Vercel: `jhoncod24` / email `juanloras35@gmail.com`
