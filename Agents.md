# JG Turbo — reglas para agentes

## Persistencia (crítico)

Lee **`CONFIG_PERSISTENTE.md`** antes de tocar configuración o `localStorage`.

- Claves, glosario y preferencias viven en el **navegador** (`jg_*`).
- Un **deploy no las borra**. No renombrar claves sin migración. No sobrescribir con vacío.
- Bundle: `jg_config_bundle`. UI: Exportar / Importar config.
- Deploy: sincronizar a `E:\PROYECTS\Spech to text Pro\vercel_deploy\` → `npx vercel --prod --yes`
- Prod: https://jg-turbo.vercel.app

## Stack

- Frontend: `index.html` (SPA)
- API Vercel: `api/index.py` (Groq + Gemini/OpenRouter + MyMemory)
- Backend local: `backend/app.py` (faster-whisper)
