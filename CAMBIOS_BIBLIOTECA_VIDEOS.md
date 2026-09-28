# Biblioteca de videos

## Medición desde Vercel

Fecha: 2026-09-28.

Vista previa: `dpl_J3LJAZ3TzGPd8E9BBJSbLvCDJvfT` (`https://jg-turbo-kx89hjg3m-jhoncod24s-projects.vercel.app`). Se desplegó desde un `git archive` exacto del commit `be41e1c`.

Se midieron 20 frases con `evitar_azure: true` y 20 con `evitar_azure: false`, con tres solicitudes en paralelo. La vista previa tiene Deployment Protection, por lo que las solicitudes se hicieron con `vercel curl`; `time_total` de curl mide cada petición HTTP sin incluir el arranque del CLI.

| Ruta de voz | Tiempo total | Fallos | p50 | p95 |
|---|---:|---:|---:|---:|
| edge-tts (`evitar_azure: true`) | 32,5 s | 0 | 1.053 ms | 1.783 ms |
| Azure (`evitar_azure: false`) | 31,2 s | 0 | 674 ms | 2.606 ms |

Decisión: continuar con edge-tts como primera ruta para las descargas largas. Cumple la puerta del plan de 0 fallos y p95 menor o igual a 5 s. La referencia estimada es 1,6 s por frase con tres solicitudes en paralelo (`32,5 / 20`), aunque la interfaz seguirá mostrando el avance real.
