# Modelo de lectura de Kindle → lector PDF de JG Turbo (v172)

Pedido del dueño (2026-10-13): «usando el MCP REA, modelar Amazon Kindle y
adaptarlo al apartado PDF», con buena lectura en teléfono y tablet, una
configuración que adapte todo, y **las voces de Fish Audio intactas**.

## Qué se observó y cómo

**Fuente:** la muestra pública del lector web de Kindle
(`read.amazon.com/sample/<ASIN>?clientId=share`), sin iniciar sesión, en
390×844 (teléfono) y 1180×820 (tablet). Kindle para PC no estaba instalado.

**Herramienta:** REA (`github.com/morluto/rea`), en modo observación pasiva por
CDP: `list_browser_targets`, `capture_web_screenshot` e `inspect_web_page` con
árbol de accesibilidad. Evidencias: `ev_827b6689…` (captura),
`ev_d5208e55…` (accesibilidad tablet: 643 nodos, 6291 del DOM).

**Lo que no funcionó (para no repetirlo):**

- `capture_browser_scenario` de REA no logra lanzar el navegador en Windows
  (`cleanup_incomplete`, «provider is closing») ni con Chrome ni con el
  Chromium de Playwright.
- Amazon **no carga el lector en Chromium sin ventana** (`--headless`): la
  página queda en blanco o en el indicador de carga. Funcionó con Chromium
  *con* ventana colocada fuera de la pantalla (`--window-position=-4000,0`) y
  `--remote-debugging-port`, y REA se conectó a ese puerto.
- REA no devuelve valores de atributos del DOM (privacidad): para saber qué
  hace cada control hace falta el árbol de accesibilidad.

**Límite ético y legal:** se modeló el **comportamiento** (qué controles hay,
dónde están, qué hacen). No se copió código, tipografías, iconos, textos ni la
marca de Amazon; la app no dice «Kindle» en ninguna parte. Las capturas no se
guardan en el repositorio.

## Lo observado en Kindle

| Elemento | Teléfono | Tablet |
|---|---|---|
| Barra superior | Volver · Índice · Buscar · «Aa» (44×44) | igual, con el título en la misma fila |
| Pasar página | botones invisibles en los bordes (37×82) + flechas ← → | igual |
| Toque en el centro | muestra/oculta todo el cromo (lectura inmersiva) | igual |
| Pie | «Ubicación 89 de 516 • 6 %» | + deslizador para saltar en el libro |
| Hoja «Aa» | hoja inferior con asa: 3 letras (serif, sans, dislexia) y tamaño A− ——●—— A+ con 14 pasos | igual |
| Índice | lista con el capítulo actual resaltado; lo que no está en la muestra, desactivado | igual |
| Buscar | campo «Buscar una palabra o frase» + Cerrar | igual |

Lo que la app completa de Kindle añade (conocido, no observado en la muestra):
colores de página (blanco, sepia, verde, negro), grosor de letra, márgenes,
interlineado, alineación, estilos guardados (Compacto, Estándar, Grande, Baja
visión), brillo, y un pie que cambia de dato al tocarlo (ubicación, tiempo
restante del capítulo y del libro, página).

## Qué se adaptó a JG Turbo (y qué ya existía)

| Kindle | JG Turbo antes | JG Turbo v172 |
|---|---|---|
| Hoja «Aa» | «Apariencia»: 3 temas, tamaño, interlineado, ancho, modo, paso, letra | **Estilos rápidos** (Compacto, Estándar, Grande, Baja visión) |
| Colores de página | Papel, Sepia, Noche | + **Verde** y **Negro** puro, con muestra de color |
| A− / A+ | solo deslizador 16–28 | botones **A− / A+** y deslizador 14–34 |
| Grosor | — | **Normal / Medio / Negrita** |
| Letra para dislexia | serif / sans | + **Legible** (más aire entre letras y palabras, sin descargar otra fuente) |
| Márgenes, interlineado | «Anchura», 1,4–2,0 | «Márgenes», 1,2–2,2 |
| Alineación | automática (justificado solo en el teléfono) | **Automática / Justificada / A la izquierda** |
| Brillo | — | **Brillo de la página** 40–100 % (velo que no recibe toques) |
| Tocar los bordes | solo deslizar | **borde izquierdo atrás, derecho adelante, centro controles** (se puede apagar) |
| Pie que cambia al tocarlo | «N % del libro» | **% del libro → tiempo del capítulo → tiempo del libro → página → nada** |
| Leer de corrido | la última página se quedaba en el capítulo | pasar de la última **entra al siguiente**; volver desde la primera cae en la **última del anterior** |
| Voz | selector en el reproductor | + **«Voz de lectura» en «Aa», solo las voces fijas de Fish** |
| Flechas del teclado, buscar, índice, inmersivo | ya existían | sin cambios |

No se adaptó: el deslizador de ubicación de la tablet (el lector ya tiene
página e índice; un tercer control de posición competiría con la voz que
sigue a la página) ni la tipografía OpenDyslexic (habría que descargar y
alojar otra fuente; «Legible» cubre la necesidad sin peso extra).

## Voces de Fish: por qué no cambian

- La hoja «Aa» usa el **mismo** llenado de selectores (`ttsRellenarLocales`)
  con la marca `data-tts-voice-solo-fish`: **filtra** lo que da el catálogo,
  no añade ni quita voces. Si Fish no está activo, muestra el listado completo
  para no dejar un selector vacío.
- Elegir ahí pasa por `ttsCambiarVozEnVivo`, igual que el reproductor: ambos
  selectores muestran siempre la misma voz.
- `tests/test_voces_fish_intactas.mjs` congela la huella SHA-256 de los cinco
  bloques del catálogo (cliente y servidor). Si falla, alguien cambió una voz.

## Pruebas

`tests/test_pdf_ajustes_lectura.mjs` (reglas puras) ·
`tests/test_voces_fish_intactas.mjs` (catálogo y contrastes) ·
`tests/verificar_pdf_kindle.mjs` (navegador: teléfono táctil, tablet y sin Fish).
