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
| Voz TTS (femenina/masculina) | `jg_tts_gender` | **Sí** |
| Nombres de las voces Fish | Catálogo del servidor (`FISH_CATALOGO_BASE`); `FISH_VOICE_*_NAME` solo pisa Nico Robin / Locutor K | **Sí** (servidor; no viven en el navegador) |
| Acento TTS | `jg_tts_locale` | **Sí** |
| Pronunciación bilingüe TTS | `jg_tts_bilingual` | **Sí** |
| Tono TTS | `jg_tts_tone` | **Sí** |
| Velocidad TTS | `jg_tts_rate` | **Sí** |
| Motor TTS (neural/browser) | `jg_tts_engine` | **Sí** |
| Modelo Whisper local | `jg_whisper_model` | **Sí** (solo aplica en PC) |
| Bundle de respaldo | `jg_config_bundle` (JSON) | **Sí** |
| `GROQ_API_KEY` en servidor | Variables de entorno de Vercel | **Sí**, si se configura en el dashboard |

**Estado verificado (2026-09-05):** `/api/health` en producción informa
`groq_configured: true` e `ia_configured: true`. El teléfono puede usar la clave
del servidor sin guardar otra en el navegador. La interfaz no debe confundir un
timeout o una comprobación pendiente con una clave ausente.

**Grok ≠ Groq:**
- **Groq** (`gsk_…`, console.groq.com) → transcripción de audio (mic/archivo).
- **Grok / xAI** (`xai-…`, console.x.ai) → solo IA de texto (pulir/traducir), no Whisper.

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
- `jg_output_lang` (idioma del texto: same / es / en / fr / pt / de)
- `jg_tts_gender` (female / male)
- `jg_tts_locale` (auto / es-CO / es-MX / es-AR / es-CL / es-PE / es-US; el selector visible se limita a español latino)
- `jg_tts_voice` (`neural:es-CO:female`, `fish:female` histórico, `fish:colombiana` o `fish:sarah`; si no existe, se arma con gender+locale). Los valores `fish:female` y `fish:male` siguen valiendo: se leen como Nico Robin y Locutor K.
- `jg_tts_bilingual` (regional / unified / off — por defecto `regional`; el valor antiguo `auto` migra a `regional`)
- `jg_tts_tone` (neutral / warm / energetic)
- `jg_tts_rate` (0.75–2.0)
- `jg_tts_engine` (neural / browser)
- `jg_pdf_unir` (`normal` | `documento`): cuanto unir palabras partidas. Por
  defecto `normal`; `documento` ignora los diccionarios y solo usa el libro.
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
6. Deploy de producción: sincronizar `index.html`, toda la carpeta `api/` y `vercel.json` hacia `vercel_deploy/`.
7. No commitear claves reales ni meter secretos en el HTML.

## Exportar / importar (UI)

En **Configuración** hay:

- **Exportar config** → descarga `jg-turbo-config-YYYY-MM-DD.json` (incluye claves; uso personal).
- **Importar config** → restaura claves y glosario en el navegador.

Útil al cambiar de PC o tras limpiar datos del sitio.

## Biblioteca PDF (IndexedDB, no localStorage)

PDF v2.41.0 **no cambia ninguna clave ni versión**: el rediseño del teléfono es
presentación, y «Unir palabras» guarda sus decisiones en los almacenes que ya
existían (las mismas que ya usaba «Revisar cortes»). Las listas de palabras de
`js/vendor/lexico/` no son configuración: viven en la caché del navegador y se
vuelven a bajar solas si se limpian.

PDF v2.40.0 conserva la versión de IndexedDB y añade al registro de contenido
la reconstrucción local (átomos, decisiones y posiciones). No se cambian claves
de configuración ni almacenes. La preferencia de páginas se guarda dentro de
`jg_pdf_lectura`; las decisiones se recuperan al reabrir el documento.

Los libros viven en `jg-turbo-pdf` (versión de base **5**, sin subirla en v2.37). Desde
`VERSION_RECONSTRUCCION = 6` cada documento puede guardar en los almacenes **ya existentes**:

- `versionReconstruccion`, `versionTroceo`, `pendientesLimites`, `needsSource`, `listoParaLectura`
- manifiesto compacto de límites y anclas de cada parte

No se renombran almacenes ni índices. Un deploy no borra la biblioteca. Un libro v5 con PDF se
reextrae al abrirlo; uno sin PDF ni manifiesto se marca `needsSource` y no se finge corregido.

## Qué NO es persistente (normal)

- Texto de la última transcripción (no se guarda en el servidor).
- Historial de deshacer ↩ (solo en memoria de la pestaña).
- Token de sesión del backend local (se regenera al reiniciar el servidor local).


## Despliegue obligatorio

**Siempre desplegar en Vercel** al cerrar mejoras de código de la app (no dejar solo local). Tras editar:

1. Sync a `vercel_deploy/`
2. `npx vercel --prod --yes --scope jhoncod24s-projects` **desde** `G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy\` (nunca desde la raíz del monorepo ni con `--cwd`)
3. Comprobar https://jg-turbo.vercel.app

Los deploys **no borran** `localStorage`. Historial TTS: `CAMBIOS_TTS.md`. En **v2.9.0** no se renombra ninguna clave `jg_tts_*`: `jg_tts_bilingual` acepta `regional | unified | off`; el valor histórico `auto` se interpreta como `regional` para que la voz nativa seleccionada se aplique realmente.

## Checklist antes de un deploy

- [ ] ¿Cambié nombres de `localStorage`? → migración obligatoria.
- [ ] ¿El servidor devuelve glosario vacío en la nube? → no pisar el del cliente.
- [ ] ¿Probé abrir Configuración y ver “IA ✓ · Groq ✓ · Glosario ✓”?
- [ ] ¿Sincronicé `index.html`, `api/index.py`, `api/calidad_linguistica.py`, `api/requirements.txt` y `vercel.json`?

## Proyecto y producción

- Workspace: `G:\Mi unidad\PROYECTS\JG Turbo\`
- App local + git: `G:\Mi unidad\PROYECTS\JG Turbo\Spech to text App\`
- Deploy CLI: `G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy\`
- GitHub: `JHONCOD24/jg-turbo` (raíz del repo = esta carpeta app)
- URL: https://jg-turbo.vercel.app
- Cuenta Vercel: `jhoncod24` / email `juanloras35@gmail.com`
