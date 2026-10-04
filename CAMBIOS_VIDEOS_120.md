# Videos: máximo de 120 minutos (v167, 2026-10-04)

Pedido: doblar y producir videos de hasta 2 horas, con 120 minutos como máximo.

## Cambio

- Una constante compartida fija 7.200 segundos en el cliente. X pasa de 60 a
  120 minutos. Archivos del equipo pasan de 3 horas al máximo solicitado de 2.
- YouTube valida la duración antes de pedir transcripción, al recibir la
  respuesta y antes de preparar la sesión, incluida la reapertura desde caché.
- La API de Vercel adopta 120 minutos, con techo de 120 aunque una variable
  antigua configure más. Comprueba metadatos/pista de duración antes de pedir
  subtítulos. El backend local pasa de 90 a 120 minutos, también con ese techo.
- X comprueba también la duración de la lista HLS cuando los metadatos faltan.
- SRT/VTT admiten un final de 120:00 y rechazan 120:00.001: se retira el margen
  global anterior de 120 segundos. La tolerancia de 2 segundos para comparar
  subtítulos con su video sigue siendo independiente de este máximo.
- El formulario muestra 120 minutos (2 horas). `JG_JS_V` y `CACHE_SHELL` pasan
  juntos a v167 para renovar los módulos de la PWA.

El audio sigue viajando por partes pequeñas. No se cambian los algoritmos de
traducción, términos técnicos, síntesis, ritmo, mezcla o presentación de
subtítulos, ni se migran bibliotecas o preferencias.

## Verificación

Línea base antes de editar: archivo 88 y X 70 comprobaciones correctas.
YouTube tuvo un fallo temporal en el intervalo de llamadas (47 ms frente al
mínimo probado de 60 ms); en la batería final la misma prueba pasó.

- Archivo: 96; aceptación exacta de 120 min, 21 partes, inglés fijo, tiempos
  globales después de la primera hora, texto exacto y fronteras SRT/VTT.
- X: 73; recorrido de 2.400 fragmentos HLS de 3 s, audio pequeño, inglés fijo,
  rechazo antes de transcribir si metadatos o lista superan 120 min.
- YouTube: 153; aceptación de 120 min y rechazo antes de llamar a la API.
- Sincronía: 93; simulación de 120 min y 1.800 frases con voz española 1,4 veces
  más larga: 1.800 frases completas en orden, cero cortes y cero saltos internos.
- Servidor: 41 casos en `test_api_youtube_bloqueo.py` y
  `test_youtube_idioma_origen.py`, incluyendo 120:00 y 120:00.001.
- Voz multilingüe: 17; frases continuas: 14.
- Batería unitaria obligatoria y pruebas adicionales: 26 archivos, 1.781
  comprobaciones correctas, cero fallos.
- Navegador de archivos: 78; subtítulos debajo en móvil, tablet, escritorio y
  pantalla completa, selección, transcripción, reproducción, caché y biblioteca.
- Extracción/exportación con Mediabunny real: 26, Chromium y Chrome.

Navegador adicional: YouTube 110 (video de 120 min y voz comprobada al saltar
al minuto 118), X 24, biblioteca de datos 48, biblioteca de videos 52, voz
multilingue 17 y arranque ligero 10. Total local de navegador: 365
comprobaciones correctas. Las tres baterias suman 2.187 comprobaciones, sin
fallos. Se corrigio la prueba de salto para pulsar el boton de doblaje y exigir
que la frase que suena pertenezca al destino; detalle en `TRAMPAS.md`.

## Alcance de la evidencia

Los recorridos de doblaje utilizan API y reproductores simulados. Las pruebas
de códecs usan archivos reales cortos. No se ha escuchado ni exportado un video
real completo de 2 horas ni probado un iPhone físico. Estas pruebas no acreditan
perfección lingüística, pronunciación humana o sincronía labial.

Las cuotas de servicios no aumentan con este cambio. Un video de dos horas más
el audio solapado puede alcanzar una cuota; se conserva el mecanismo para retomar.
El respaldo histórico que descarga audio de YouTube dentro de Vercel conserva
su límite específico de 30 minutos: no es el flujo por partes de archivos/X ni
el de subtítulos/Supadata de YouTube.

## Publicación

Publicado en `https://jg-turbo.vercel.app` desde `git archive` del commit
`73ea335`, enlazado al proyecto `jg-turbo`. Un solo despliegue:
`dpl_8ionughivj1wmsSTPWZ9pE42Sin7`, estado READY, v167.

Verificacion del dominio real:

- SHA-256 identico al commit en HTML, service worker y los seis modulos JS
  modificados/nuevos (ocho archivos).
- `/api/health`: status ok. `/api/session-config`: max_youtube_minutes = 120.
- POST `/api/youtube` con 7200.001 s: HTTP 413, "Maximo: 120 minutos".
- Navegador con `JG_BASE=https://jg-turbo.vercel.app`: archivo 78, YouTube 110
  (incluye 120 min y voz al minuto 118), X 24 y biblioteca 52. Total 264
  comprobaciones correctas, cero fallos. API/YouTube simulados, sin creditos.

Despliegue anterior registrado para reversion:
`dpl_FotRxMbBhFA559XXYBuTSByo9rT4`,
`https://jg-turbo-jbl5ld49p-jhoncod24s-projects.vercel.app`.
Documentacion final guardada en Git; integracion por avance directo a main.
