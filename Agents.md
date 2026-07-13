# JG Turbo — reglas para agentes

## Persistencia (crítico)

Lee **`CONFIG_PERSISTENTE.md`** antes de tocar configuración o `localStorage`.

- Claves, glosario y preferencias viven en el **navegador** (`jg_*`).
- Un **deploy no las borra**. No renombrar claves sin migración. No sobrescribir con vacío.
- Bundle: `jg_config_bundle`. UI: Exportar / Importar config.
- Deploy: sincronizar a `B:\PROYECTS\JG Turbo\vercel_deploy\` → `npx vercel --prod --yes`
- Git: repo en `Spech to text App/` → `JHONCOD24/jg-turbo` (author `JHONCOD24 <juanloras35@gmail.com>`)
- Prod: https://jg-turbo.vercel.app

## Stack

- Frontend: `index.html` (SPA)
- API Vercel: `api/index.py` (Groq + Gemini/OpenRouter + MyMemory)
- Backend local: `backend/app.py` (faster-whisper)
