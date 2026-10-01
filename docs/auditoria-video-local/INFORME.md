# Auditoría del doblaje de video local

Fecha: 2026-10-01. Entrega revisada: v163, commit `8e0a1fc`.
Correcciones de esta auditoría: v164.

## Resultado

La integración base cumple los contratos comprobados del plan: extracción local
por rangos, una puerta de transcripción compartida con X, reutilización del motor,
biblioteca sin guardar el video y exportaciones MP3/MP4. La mejora SRT/VTT existe
y las pruebas comprobaron cero peticiones de transcripción cuando se usa.

Se corrigieron problemas verificables: subtítulos que cubrían la imagen,
controles pequeños, tiempos SRT inválidos descartados sin aviso, subtítulos de
otro episodio aceptados, una lectura tardía asociada a otro video y pérdida de
frases cuando la voz local no llegaba a tiempo. Se corrigió además el subtítulo
que reaparecía al refrescar una traducción después de terminar la frase.

Esto acredita las comprobaciones técnicas descritas aquí. No acredita una
escucha humana completa, sincronía labial exacta ni funcionamiento en un iPhone
físico. Esas comprobaciones siguen pendientes.

## Fuentes y método

- [Plan conservado](../video-local/PLAN_REFERENCIA.md), copia sin editar del plan
  que estaba fuera de Git en el proyecto principal.
- [Especificación conservada](../video-local/ESPECIFICACION_REFERENCIA.md).
- [Mediciones originales M1–M15](../video-local/MEDICIONES.md).
- `CAMBIOS_VIDEO_LOCAL.md`, `Agents.md`, `TRAMPAS.md`, `CONFIG_PERSISTENTE.md`.
- Código actual, historial de Git, pruebas con Node, Chromium y Chrome instalado.
- Impeccable: contexto, audit, adapt, craft-floor y polish; capturas de cinco
  tamaños, mediciones de geometría, controles y pantalla completa.
- MCP codebase-memory: grafo y cobertura consultados. Su generación era anterior
  a SRT; se usó lectura directa de fuentes para verificar la entrega actual.
- Context7: documentación vigente de la CLI de Vercel antes de publicar.

El plan original tenía sus casillas sin marcar. Se conservaron intactas:
la evidencia de esta auditoría está en las tablas, no en modificar a posteriori
la lista del otro agente. Plan, especificación y mediciones no estaban en el
checkout de este chat porque no tenían seguimiento. Ahora sus copias están
versionadas y pueden consultarse desde una copia limpia del repositorio.

## Comparación con el plan

| Tarea | Contrato | Evidencia actual |
|---|---|---|
| 1 | Transcripción compartida, primera parte sola, máximo dos en vuelo, retomar | Unitarias de archivo; E2E X |
| 2 | Validación, huella estable ante cambio de nombre, partes con solape | Unitarias de archivo |
| 3 | Servicio local y errores visibles | Unitarias y recorrido local |
| 4 | Biblioteca reconoce `archivo:`, conserva organización | Unitarias biblioteca y E2E de datos |
| 5 | Mediabunny diferido, lectura por rangos, MP3 y copia AC-3 | Audio real en Chromium y Chrome; arranque ligero |
| 6 | MP3/MP4, video copiado, mezcla a 44,1/48 kHz | Exportación real de WebM/AC-3; E2E datos |
| 7 | Reproductor compartido con iframe sin Referer | E2E local y X |
| 8 | Elegir, ficha, quitar, Archivo, móvil | Recorrido local y cinco viewports |
| 9 | Orquestación, biblioteca, idioma, cancelación | Recorrido local completo |
| 10 | Reabrir exige mismo archivo; no ofrece video original | Recorrido local y biblioteca |
| 11 | Pruebas de regresión y contraprueba | Tabla de resultados y mutación controlada |
| 12 | Documentación y versiones | Documento maestro actualizado; marcador/cache v164 |
| 13 | Publicación y prueba física | Cierre de publicación al final; iPhone físico pendiente |

Desviación solicitada por el dueño en esta auditoría: la posición del subtítulo
deja de ser intocable y pasa debajo de la imagen. Los SRT/VTT y el cambio manual
de hablante son extensiones posteriores al plan original, revisadas también.
No se añadieron dependencias, APIs, bases ni servicios de pago.

## Hallazgos corregidos

| Prioridad | Hallazgo y efecto | Corrección |
|---|---|---|
| P1 | Subtítulos largos cubrían imagen y controles | Franja independiente debajo del video, incluso en pantalla completa |
| P1 | Falta de voz dejaba avanzar el video y podía omitir frases | Espera local antes de perder la frase; reanudación cuando está lista |
| P1 | Español demasiado largo podía acumular retraso | Con ritmo automático, video espera a la voz; también protege la última frase |
| P1 | Botones/selectores/volumen pequeños | Superficie mínima de 48 px en controles del reproductor |
| P1 | Archivo SRT parcialmente inválido perdía frases sin avisar | Rechazo del archivo con mensaje visible |
| P2 | SRT de otro episodio podía reproducirse con tiempos incompatibles | Validación del final contra duración del video antes de traducir/sintetizar |
| P2 | Lectura asíncrona terminaba después de cambiar de video | Revisión de selección y snapshot de subtítulos por sesión |
| P2 | Se podía iniciar Whisper mientras se leía el SRT | Botón bloqueado durante esa lectura |
| P2 | Traducción tardía repintaba un subtítulo terminado | Índice vacío explícito; prueba de refresco |
| P2 | UTF-16 de Windows no se leía correctamente | BOM UTF-16 LE/BE, conservando UTF-8 y Windows-1252 |

La espera por voz es exclusiva de archivos locales. YouTube y X mantienen su
política de reproducción. La preferencia de subtítulos y su tamaño conservan
las claves existentes; la base `jg_youtube` permanece en v2.

Si se agotan los reintentos de una frase, sigue el aviso de voz parcial y puede
sonar el original. La nueva espera no convierte un proveedor caído en una voz
disponible. Con ritmo automático apagado, el usuario conserva esa elección;
se espera a la generación, pero no se activa la espera por longitud de frase.

## Interfaz e Impeccable

Verificación renderizada: 360×800, 800×360, 820×1180, 1180×820 y 1440×900.
Subtítulo grande con frase larga, controles visibles, cambio de tamaño,
pantalla completa y ausencia de desborde horizontal. Capturas en `capturas/`.
La imagen mantiene su proporción en vista normal y usa espacio flexible en
pantalla completa. El subtítulo largo puede desplazarse en pantalla completa
y recibe foco por teclado.

[Inferencia] Juicio de diseño basado en las mediciones y capturas, no certificación WCAG:

| Dimensión | Evaluación del alcance revisado | Evidencia/límite |
|---|---|---|
| Accesibilidad | 3/4 | Etiquetas, foco y superficies medidos; sin prueba de lector de pantalla físico |
| Rendimiento | 3/4 | Carga diferida y audio por rangos comprobados; sin medición de 4 GB en teléfono |
| Responsive | 4/4 | Cinco viewports y pantalla completa sin desborde; hardware físico pendiente |
| Temas | 3/4 | Franja usa tokens; no se certificaron todos los temas de la app |
| Integridad | 3/4 | Contratos y estados cubiertos; límites de proveedores explícitos |
| Total | 16/20 | Evaluación del reproductor y puerta local, no de toda la aplicación |

El detector estático de Impeccable se ejecutó una vez sobre `index.html`.
Su salida completa está en `impeccable.json`. Incluye resultados de toda la SPA:
texto pequeño, halos, tarjetas anidadas y posibles contrastes de otras
superficies. No se presentan como defectos confirmados de este reproductor.
El ejemplo `#9098ac` sobre `#ffefe3` mezcla colores cuya convivencia necesita
verificación en el tema correspondiente; no demuestra por sí solo un fallo
del subtítulo oscuro. Se mantuvo la identidad existente en vez de rediseñar
otras pestañas durante una auditoría de video local.

## Resultados técnicos

| Suite | OK | Fallos | Tipo |
|---|---:|---:|---|
| 26 archivos unitarios | 1.743 | 0 | Node; detalle en `unitarias.json` |
| `test_archivo_doblaje` (incluida arriba) | 88 | 0 | Reglas de archivo y SRT |
| `test_youtube_sincronia` (incluida arriba) | 90 | 0 | Reloj, audio y proveedor virtuales |
| `verificar_archivo_doblaje` | 78 | 0 | Video y reproductor reales, APIs simuladas |
| `verificar_archivo_audio` | 26 | 0 | Mediabunny y exportación reales, Chromium/Chrome |
| `verificar_youtube_doblaje` | 110 | 0 | API y reproductor simulados |
| `verificar_x_doblaje` | 24 | 0 | API simulada, iframe real |
| `verificar_biblioteca_datos` | 48 | 0 | IndexedDB, audio real y exportación |
| `verificar_biblioteca_videos` | 52 | 0 | Recorrido de biblioteca |
| `verificar_movil_pantalla` | 62 | 0 | Geometría y scroll |
| `verificar_pdf_scroll` | 39 | 0 | Regresión del desplazamiento |
| `verificar_arranque_ligero` | 10 | 0 | Carga diferida |
| `verificar_pdf_geometria` | 137 | 0 | Regresión de geometría PDF |

Las suites de video son completas. Los nuevos casos comprueban voz tres veces
más larga, las doce frases completas incluida la última, ocho segundos sin voz,
reanudación, pausa manual, subtítulo oculto durante espera y refresco tardío.
No se usan estos resultados como medición perceptiva de voz natural o de
sincronía labial. Dentro de una unidad compuesta, el avance del subtítulo usa
fracciones del texto; no existe alineación acústica palabra por palabra.

Contraprueba: una copia temporal de la prueba desactivó `esperarVoz`; terminó
con código 1 y seis fallos. La copia temporal se retiró y el código real quedó
intacto. Confirma que los casos nuevos detectan la pérdida que buscan prevenir.

Se intentó además `verificar_pdf_navegador`: llegó a 64 comprobaciones y quedó
sin progreso al entrar en «Casos límite». Se interrumpió. No cuenta como suite
aprobada ni se afirma una causa sin reproducirla. No se editó el lector PDF
para resolver un problema fuera de este alcance.

## Límites y comprobaciones pendientes

- Prueba física en iPhone/Android con archivo grande y suspensión de pantalla.
- Escucha completa del curso del dueño, especialmente conversaciones y la última frase.
- Sincronía labial exacta: la traducción tiene distinta duración; la espera
  protege frases, pero no produce alineación fonética del diálogo original.
- SRT con tiempos dentro de la duración pero correspondiente a otro contenido:
  no puede identificarse solo por sus marcas de tiempo. La persona debe elegirlo.
- Si no hay proveedor de voz disponible tras los reintentos, se informa voz parcial.
- La huella del plan usa tamaño y extremos del video; no es el SHA-256 completo
  de todo el archivo. Se conservó la decisión de lectura ligera.
- La suite adicional de navegador PDF no completó sus casos límite.

## Publicación

Publicada v164 desde `git archive` del commit `5c76660`, despliegue
`dpl_HYorNpiKTYXxrgWmGDPP81vAPPJq`, en https://jg-turbo.vercel.app.
Los ocho archivos comprobados respondieron HTTP 200 y sus SHA-256 coinciden
con el commit publicado. `/api/health` respondió `status=ok`, con Groq e IA
configurados. Evidencia: `produccion.json`.

En el dominio real, el recorrido de archivo completó 78 comprobaciones y X 24,
sin fallos, con API simulada. Las cinco capturas de `capturas/` corresponden a
esa ejecución publicada. Móvil completó 60, sin fallos: dos comprobaciones de
scroll no aplicaron porque Archivo no desbordaba en iPhone 14 y Pixel. Se
recorrieron todos los dispositivos y pestañas; no se confunde este resultado
con el timeout del primer intento, que quedó descartado.

La suite de YouTube espera ahora la inicialización del controlador diferido
antes de interactuar, espera el CSS diferido antes de medir botones y vuelve
a esperar la restauración después de F5. El sondeo usa 100 ms, también en el caso
que deshabilita `requestAnimationFrame`. Los intentos incompletos anteriores
no cuentan como aprobación. La ejecución final completó **110 OK y 0 fallos**,
incluidas frases completas, voz más larga que el original y subtítulo acorde
con la voz. Las APIs y el reproductor de YouTube están simulados: se comprueba
el código servido por producción, no una escucha con proveedores reales.

Respaldo realizado: incorporación mediante avance rápido a `main`, push a
`origin/main` y `git log origin/main..HEAD` vacío tras fetch. El archivo original
de mediciones del proyecto principal se conservó en
`.worktrees/mediciones-originales-antes-merge-v164.md` de este checkout, antes
de incorporar su versión con seguimiento. Ambos SHA-256 coinciden.

El commit v163 y su despliegue previo permiten volver a la entrega anterior.
