# JG Turbo — reglas para agentes

## Coordinación multi-agente

Si hay agentes de **diseño/UX** en paralelo: **no editar** `index.html` ni copiar un frontend viejo a `vercel_deploy/`. Ver `../COORDINACION_AGENTES.md` e inventario en `../auditoria-ux-2026-07-29/INVENTARIO_TECNICO.md`.

## Persistencia (crítico)

Lee **`CONFIG_PERSISTENTE.md`** antes de tocar configuración o `localStorage`.

- Claves, glosario y preferencias viven en el **navegador** (`jg_*`).
- Un **deploy no las borra**. No renombrar claves sin migración. No sobrescribir con vacío.
- Bundle: `jg_config_bundle`. UI: Exportar / Importar config.
- Deploy: sincronizar a `G:\Mi unidad\PROYECTS\JG Turbo\vercel_deploy\` → `npx vercel --prod --yes`
- Git: repo en `Spech to text App/` → `JHONCOD24/jg-turbo` (author `JHONCOD24 <juanloras35@gmail.com>`)
- Prod: https://jg-turbo.vercel.app


## Despliegue (obligatorio al cerrar mejoras)

**Siempre desplegar en Vercel** cuando se termine una mejora o feature de esta app. No dejar solo cambios locales.

1. Editar en `Spech to text App/`
2. **Documentar todo** en el MD del feature (TTS → `CAMBIOS_TTS.md`: versión, dpl_, cambios, pruebas, proceso)
3. Alinear satélites si aplica (`DOCUMENTACION_DESPLIEGUE.md`, `FICHA_TECNICA.md`, `CONFIG_PERSISTENTE.md`, este `Agents.md`)
4. Sync a `../vercel_deploy/` (`index.html`, `api/*`, docs tocados, `vercel.json`)
5. `cd ../vercel_deploy` → `npx vercel --prod --yes` (**nunca** la raíz del monorepo)
6. Verificar prod (API + Ctrl+F5 en el navegador)
7. Anotar `dpl_…` en la documentación

Detalle TTS completo: **`CAMBIOS_TTS.md`**. Persistencia: `CONFIG_PERSISTENTE.md`. Deploy: `DOCUMENTACION_DESPLIEGUE.md`.


## Stack

- Frontend: `index.html` (SPA)
- API Vercel: `api/index.py` (Groq + Gemini/OpenRouter + MyMemory)
- Backend local: `backend/app.py` (faster-whisper)

## Causa del 404 (2026-07-23) y prevención

El 404 `NOT_FOUND` ocurrió porque un deploy se lanzó desde la **raíz del monorepo** (`JG Turbo/`), donde **no hay** `index.html`. Vercel subió miles de archivos y la producción quedó sin frontend.

**Siempre** ejecutar el deploy desde `vercel_deploy/`:

```bash
cd vercel_deploy
npx vercel --prod --yes
```

Nunca desde la raíz del workspace. Tras el fix: ~17 archivos, alias https://jg-turbo.vercel.app OK con TTS.

## TTS (lectura en voz alta)

Consola compacta + voces neurales bilingües (**v2.6.3**).

| Rol | Voz |
|---|---|
| Mujer ES (auto) | `es-MX-DaliaNeural` |
| Hombre ES (auto / zona CO) | `es-CO-GonzaloNeural` (+ prosodia calmada) |
| Mujer EN | `en-US-AriaNeural` |
| Hombre EN | `en-US-AndrewNeural` (paridad con Aria; prep de pronunciación idéntica) |

Acentos manuales: CO, MX, AR, es-US. Segmentación agresiva EN + force-EN en cliente/servidor + `ttsPrepararTextoIngles`.

- Historial + arquitectura + deploys + pruebas: **`CAMBIOS_TTS.md`** (maestro)
- Prod actual (UX 2026-07-29): `dpl_Wv8aTd1YwcaMcEwJHimqushPmqBv` · TTS **v2.6.3** · https://jg-turbo.vercel.app
- UX: `CAMBIOS_UX.md` · capturas `../auditoria-ux-2026-07-29/`
- **Nunca** `npx vercel --prod` desde la raíz del monorepo (causa 404).
