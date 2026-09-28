# Doblaje de videos de X

Estado: implementación en curso en `feat/x-doblaje`. Sin publicación a producción.

## Medición desde Vercel

Fecha: 2026-09-27, hora de Colombia. Commit de código: `c6749db`.
Vista previa: https://jg-turbo-i381u7eh5-jhoncod24s-projects.vercel.app
Despliegue de vista previa: `dpl_3YaeFFYTaaGzpqzu22fNHFXerdwG`, READY.
Copia creada con `git archive HEAD`; proyecto comprobado: `jg-turbo`.
Consultas mediante `vercel curl`, conservando la protección del despliegue.
Los tiempos corresponden a `curl time_total`, sin incluir el arranque del CLI.

| Post | HTTP | Fuente | Tiempo |
|---|---:|---|---:|
| `BrooklynNets/status/1349794411333394432` | 200 | sindicacion | 0,835495 s |
| `elonmusk/status/1585341984679469056` | 200 | sindicacion | 0,620542 s |
| `jamestalarico/status/2023659473466687994` | 200 | sindicacion | 0,761383 s |

Decisión T3: continuar sin T6b, porque los tres posts respondieron por sindicación.
Salud: HTTP 200 en 0,358405 s, `x_video: true`.
La vista previa reporta `groq_configured: false`, `ia_configured: false`,
`tts_azure: false`. Pendiente resolver la configuración de vista previa para
la prueba real T12. No se modificaron claves ni variables de producción.

## Pruebas

T1: error de importación antes del módulo; después 31 passed.
T2: 4 fallos previstos antes de la ruta; después 35 passed.
Regresión del servidor: 74 passed antes y después.
Línea base YouTube: 139 unitarias, 65 de sincronía y 110 de navegador, sin fallos.
Arranque: 10 comprobaciones, 897 KB, sin fallos en esta ejecución.
PDF/TTS: 1.192 comprobaciones en los 19 archivos, sin fallos.

## Desvíos del plan

- Comandos de archivos adaptados a PowerShell, conservando el código del plan.
- Acceso autenticado a la vista previa mediante `vercel curl`.
- FFmpeg existente comprobado por ruta absoluta, sin instalar dependencias.
- El fallo de arranque descrito en el plan no se reprodujo en la línea base actual.

## Despliegues

Producción pendiente. También están pendientes el doblaje real y el iPhone físico.
