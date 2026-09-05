# Agente 1 · Lectura y voz: que el libro se lea, se escuche y se retome

> **Para el agente que ejecuta:** SUB-SKILL OBLIGATORIA: `superpowers:executing-plans`.
> Ejecuta los pasos en orden, uno por uno. Los pasos usan casillas (`- [ ]`).
> **No trabajes fuera de los archivos listados en cada tarea.** Hay otros agentes trabajando en el
> mismo proyecto y salirte de tu carpeta de archivos provoca conflictos.

**Proyecto:** `C:\Users\juanl\Documents\Proyectos\jg-turbo` (JG Turbo, apartado PDF)

**Objetivo:** conectar la vista de libro con el motor de voz, para que tocar un párrafo lo lea, la
frase que suena se resalte donde de verdad se ve, y el libro se reabra en el punto donde se quedó.

**Arquitectura:** el motor de texto (átomos → límites → reconstrucción v7) y el motor de voz ya
funcionan, y sus 13 suites pasan. Lo que está roto es **la unión entre ambos**: la vista de lectura
`#pdfLectura` es HTML derivado *sin correspondencia con las posiciones del texto plano*, mientras que
toda la maquinaria de voz, resaltado, desplazamiento y progreso mide sobre el `<textarea>` `#pdfOutput`,
que en modo lectura está oculto. Este plan crea esa correspondencia (un mapa de posiciones) y la usa
para el gesto de leer, el resaltado, el desplazamiento y la reanudación.

**Stack:** JavaScript de navegador con módulos ES nativos (sin framework, sin dependencias nuevas),
CSS con variables `--lec-*`, Node 24 para las pruebas.

**Spec:** `MEJORA APARTADO PDF.md` (raíz del repo), secciones 2 «Navegación y controles» y 3.
**Plan completo del que sale este:** `docs/superpowers/plans/2026-09-04-lector-pdf-legible.md`.

---

## Diagnóstico verificado (por qué existe este plan)

Comprobado en el árbol de trabajo actual (`main` + cambios sin confirmar, PDF v2.38/v2.39):

| Hallazgo | Evidencia | Consecuencia para quien lee |
|---|---|---|
| `js/pdf/libroVista.js:140` llama a `window.jgLeerTextoPdf`, que **no existe en ningún archivo** | `grep -rn "jgLeerTextoPdf" index.html js/` → solo la llamada, nunca la definición | «Leer desde aquí» no hace nada al pulsarlo |
| El botón se inyecta en **cada** párrafo, `li`, cita y título, hasta 150 por capítulo (`libroVista.js:130-144`) | lectura del archivo | El texto queda salpicado de botones; el libro no parece un libro |
| El botón entra **dentro** del párrafo, así que su texto contamina el contenido | `pdfController.js:4424` tiene que hacer `replace(/Leer desde aquí\s*$/, '')` | Señal de que la presentación está ensuciando el dato |
| `resaltarFraseEnLectura` está definida y devuelta, pero **nunca se invoca** | `grep -rn "resaltarFraseEnLectura" js/ index.html` → solo definición y `return` | Escuchando en modo lectura, no se resalta nada |
| El seguimiento de la voz mueve `el.salida.scrollTop` (`pdfController.js:3795`), y el `<textarea>` está oculto en modo lectura (`libroVista.js:111`) | lectura de ambos archivos | La página no acompaña al audio: hay que buscar a mano por dónde va |
| `restaurarPosicionGuardada` e `irAPosicion` miden sobre `#pdfRealce`, la capa gemela del textarea oculto | `pdfController.js:936-991` | Al reabrir un libro, la vista empieza arriba aunque el progreso esté guardado |
| El gesto que sí funciona (doble toque para leer desde ahí) vive en el `<textarea>` | `pdfController.js:3450` | En modo lectura ese gesto no existe |

Lo que **sí está bien y NO se toca**: átomos con procedencia, límites con identificador, reconstrucción
canónica v7, invariante de letras, cola de corrección reanudable, modo `pdf_boundary_decisions`, hoja
«Revisar cortes», vinculación del PDF original por SHA-256, y la biblioteca con orden, vistas y
paginación (`libroVista.js:357-381`). Si una tarea parece pedirte cambiar algo de esto, es que la
estás entendiendo mal: pregunta antes de tocarlo.

## Restricciones globales

- **Idioma:** todo en español de Colombia, nombres de función y comentarios incluidos.
- **Sin dependencias nuevas.** Ni librerías, ni polyfills, ni `npm install`.
- **El texto es sagrado.** Ningún cambio de presentación puede alterar palabras, párrafos ni posiciones
  guardadas. `invarianteLetras` debe seguir pasando.
- **Motor de voz compartido.** `index.html` sirve también a micrófono, archivo, YouTube y traducción:
  todo cambio en el motor TTS debe ser aditivo y no alterar el comportamiento de esos cuatro.
- **Colores solo por tokens** `--lec-bg`, `--lec-texto`, `--lec-suave`, `--lec-linea`, `--lec-acento`,
  `--lec-superficie`, `--lec-superficie-2`. Nunca escribas un color suelto.
- **Toque mínimo 44 × 44 px**, foco visible con `:focus-visible`, navegable con teclado, y
  `prefers-reduced-motion` respetado.
- **Cada tarea termina en verde.** Antes de confirmar: `node tests/test_pdf_continuidad.mjs`,
  `node tests/test_pdf_mejora_apartado.mjs` y `node tests/test_pdf_cola_correccion.mjs`.
- **Git:** `git config user.name "JHONCOD24"` y `git config user.email "juanloras35@gmail.com"`
  (otro autor bloquea el despliegue en Vercel). Confirma **en cada tarea**, nunca todo al final.
- **No despliegues.** El despliegue lo hace el Agente 4, cuando todos hayan terminado.

## Tus archivos (no salgas de aquí)

| Archivo | Qué haces en él |
|---|---|
| `js/pdf/mapaLectura.js` | Lo creas entero. |
| `js/pdf/libroVista.js` | `renderLectura`, el resaltado, el seguimiento manual. **No toques** el bloque de temas (línea 232), el de «Pausar» (332-337) ni el de biblioteca (357-381): son del Agente 2. |
| `js/pdf/pdfController.js` | Objeto `guia`, `leerDesdeCaracter`, `caracterVisible`, `irAPosicion`, oyente `jg-tts-avance`, mapa `el` (solo `btnDesdeAqui`). |
| `index.html` | **Solo** la regla CSS de la línea 4178, el botón `#pdfVolverLectura` y el botón nuevo `#btnPdfDesdeAqui`. Nada más. |
| `tests/test_pdf_mapa_lectura.mjs` | Lo creas entero. |
| `tests/test_pdf_mejora_apartado.mjs` | Añades bloques al final. Es tuyo: ningún otro agente lo edita. |

---

## Tarea 1: Mapa de lectura (posiciones reales para el HTML)

Sin esto no hay forma de saber qué carácter del texto corresponde a un párrafo de la pantalla, y todo
lo demás (leer desde aquí, resaltar, retomar) seguiría siendo adivinanza.

**Archivos:**
- Crear: `js/pdf/mapaLectura.js`
- Crear: `tests/test_pdf_mapa_lectura.mjs`

**Interfaces:**
- Consume: nada (módulo puro).
- Produce, para las tareas 2, 3 y 4:
  - `bloquesDeTexto(texto: string) => Array<{ ini: number, fin: number, texto: string, tipo: string }>`,
    donde `tipo ∈ 'p' | 'h3' | 'ul' | 'ol' | 'blockquote' | 'table'` y siempre se cumple
    `texto === textoOriginal.slice(ini, fin)`.
  - `construirLectura(texto: string) => string` (HTML; cada bloque y cada `<li>` llevan `data-ini` y
    `data-fin`).
  - `tipoDeBloque(cuerpo: string) => string`
  - `escapar(texto: string) => string`

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `tests/test_pdf_mapa_lectura.mjs`:

```js
/* Mapa de lectura: el HTML de la vista tiene que saber de qué parte del texto
 * viene cada bloque. Ejecutar: node tests/test_pdf_mapa_lectura.mjs */
import { bloquesDeTexto, construirLectura, escapar } from '../js/pdf/mapaLectura.js';

let fallos = 0; let ok = 0;
function comprobar(cond, msg) {
  if (cond) { ok += 1; console.log(`OK: ${msg}`); }
  else { fallos += 1; console.error(`FALLO: ${msg}`); }
}

const TEXTO = 'Capítulo 1\n\nEra una tarde larga. Nadie dijo nada.\n\n- primero\n- segundo\n\n'
  + 'Un párrafo final con "comillas" y <etiquetas> peligrosas.';

console.log('--- posiciones exactas ---');
{
  const bloques = bloquesDeTexto(TEXTO);
  comprobar(bloques.length === 4, 'se detectan los cuatro bloques');
  comprobar(bloques.every((b) => TEXTO.slice(b.ini, b.fin) === b.texto),
    'cada bloque se corresponde con su recorte del texto original');
  comprobar(bloques.every((b, i) => i === 0 || b.ini >= bloques[i - 1].fin),
    'los bloques van en orden y no se solapan');
  comprobar(bloques.every((b) => b.fin > b.ini), 'ningún bloque queda vacío');
}

console.log('--- cobertura: fuera de los bloques solo hay separadores ---');
{
  const bloques = bloquesDeTexto(TEXTO);
  let sobrante = TEXTO.slice(0, bloques[0].ini);
  for (let i = 1; i < bloques.length; i += 1) sobrante += TEXTO.slice(bloques[i - 1].fin, bloques[i].ini);
  sobrante += TEXTO.slice(bloques[bloques.length - 1].fin);
  comprobar(/^\s*$/.test(sobrante), 'lo que queda fuera de los bloques son solo espacios y saltos');
}

console.log('--- el HTML lleva las posiciones y escapa el contenido ---');
{
  const html = construirLectura(TEXTO);
  comprobar(/data-ini="\d+"/.test(html) && /data-fin="\d+"/.test(html), 'el HTML trae data-ini y data-fin');
  comprobar(!html.includes('<etiquetas>'), 'el contenido del PDF no se convierte en marcado');
  comprobar(html.includes('&lt;etiquetas&gt;'), 'las etiquetas del texto se muestran escapadas');
  comprobar(!html.includes('Leer desde aquí'), 'la vista no inventa botones dentro del texto');
  const items = html.match(/<li data-ini="\d+" data-fin="\d+">/g) || [];
  comprobar(items.length === 2, 'cada punto de una lista trae su propia posición');
}

console.log('--- casos límite ---');
{
  comprobar(bloquesDeTexto('').length === 0, 'texto vacío: sin bloques');
  comprobar(bloquesDeTexto('   \n\n  \n').length === 0, 'solo espacios: sin bloques');
  comprobar(construirLectura('') === '<p></p>', 'texto vacío: HTML mínimo válido');
  comprobar(escapar('a & b') === 'a &amp; b', 'el ampersand se escapa');
  const largo = 'palabra '.repeat(5000);
  comprobar(bloquesDeTexto(largo)[0].fin === largo.trimEnd().length, 'un bloque enorme conserva su fin');
}

console.log(fallos ? `\n❌ ${fallos} fallos, ${ok} bien.` : `\n✅ Mapa de lectura: ${ok} comprobaciones bien.`);
process.exit(fallos ? 1 : 0);
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
node tests/test_pdf_mapa_lectura.mjs
```
Esperado: `ERR_MODULE_NOT_FOUND` para `../js/pdf/mapaLectura.js`.

- [ ] **Paso 3: Escribir `js/pdf/mapaLectura.js`**

```js
/* JG Turbo · Mapa de lectura (apartado PDF)
 *
 * El texto del libro vive en un único string. La vista de lectura lo enseña
 * como HTML, y hasta ahora ese HTML no sabía de dónde salía cada párrafo: por
 * eso «leer desde aquí», el resaltado de la voz y la reanudación no podían
 * funcionar. Aquí cada bloque viaja con su posición exacta (`ini`/`fin`) en el
 * texto original, y esas posiciones llegan al HTML como `data-ini`/`data-fin`.
 *
 * Módulo puro: no toca el DOM ni el almacenamiento, así se prueba en Node.
 */

export function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Recorta los espacios de los bordes SIN perder la posición real. */
function recortar(texto, ini, fin) {
  let a = ini;
  let b = fin;
  while (a < b && /\s/.test(texto[a])) a += 1;
  while (b > a && /\s/.test(texto[b - 1])) b -= 1;
  return { ini: a, fin: b, texto: texto.slice(a, b) };
}

/** Qué es este bloque. Mismas reglas que la vista anterior, en un solo sitio. */
export function tipoDeBloque(cuerpo) {
  const lineas = cuerpo.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (/^#{1,3}\s+\S/.test(cuerpo)) return 'h3';
  if (lineas.length > 1 && lineas.every((l) => /^[-•●]\s+\S/.test(l))) return 'ul';
  if (lineas.length > 1 && lineas.every((l) => /^\d+\.\s+\S/.test(l))) return 'ol';
  if (/^>/.test(cuerpo) || (lineas.length > 1 && lineas.every((l) => /^["“«]/.test(l)))) return 'blockquote';
  if (/\|.*\|/.test(cuerpo) && lineas.length > 1) {
    const filas = lineas.map((l) => l.split('|').map((c) => c.trim()).filter(Boolean));
    if (filas.length > 1 && filas.every((f) => f.length === filas[0].length)) return 'table';
  }
  const esTitulo = cuerpo.length <= 90 && !/[.!?…:]$/.test(cuerpo)
    && ((cuerpo === cuerpo.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{2,}/.test(cuerpo))
      || /^(capítulo|capitulo|parte|prólogo|prologo|epílogo|anexo|introducción)/i.test(cuerpo));
  return esTitulo ? 'h3' : 'p';
}

/** El texto partido en bloques, cada uno con su posición en el original. */
export function bloquesDeTexto(texto) {
  const t = String(texto || '');
  if (!t.trim()) return [];
  const bloques = [];
  const separador = /\n{2,}/g;
  let desde = 0;
  let hallazgo;
  const anotar = (ini, fin) => {
    const r = recortar(t, ini, fin);
    if (r.fin > r.ini) bloques.push({ ...r, tipo: tipoDeBloque(r.texto) });
  };
  while ((hallazgo = separador.exec(t))) {
    anotar(desde, hallazgo.index);
    desde = hallazgo.index + hallazgo[0].length;
  }
  anotar(desde, t.length);
  return bloques;
}

/** Las líneas de un bloque, con posición propia (para los puntos de una lista). */
function lineasConPosicion(bloque) {
  const salida = [];
  let cursor = 0;
  for (const linea of bloque.texto.split('\n')) {
    const r = recortar(bloque.texto, cursor, cursor + linea.length);
    if (r.fin > r.ini) {
      salida.push({ ini: bloque.ini + r.ini, fin: bloque.ini + r.fin, texto: r.texto });
    }
    cursor += linea.length + 1;
  }
  return salida;
}

function atributos(b) {
  return ` data-ini="${b.ini}" data-fin="${b.fin}"`;
}

/** El HTML de la vista de lectura, con las posiciones puestas. */
export function construirLectura(texto) {
  const bloques = bloquesDeTexto(texto);
  if (!bloques.length) return '<p></p>';
  const html = [];
  for (const b of bloques) {
    if (b.tipo === 'h3') {
      html.push(`<h3${atributos(b)}>${escapar(b.texto.replace(/^#{1,3}\s+/, ''))}</h3>`);
      continue;
    }
    if (b.tipo === 'ul' || b.tipo === 'ol') {
      const marca = b.tipo === 'ul' ? /^[-•●]\s+/ : /^\d+\.\s+/;
      const items = lineasConPosicion(b)
        .map((l) => `<li${atributos(l)}>${escapar(l.texto.replace(marca, ''))}</li>`).join('');
      html.push(`<${b.tipo}${atributos(b)}>${items}</${b.tipo}>`);
      continue;
    }
    if (b.tipo === 'blockquote') {
      html.push(`<blockquote${atributos(b)}>${escapar(b.texto.replace(/^>\s?/gm, ''))}</blockquote>`);
      continue;
    }
    if (b.tipo === 'table') {
      const filas = lineasConPosicion(b).map((l, i) => {
        const celdas = l.texto.split('|').map((c) => c.trim()).filter(Boolean)
          .map((c) => (i === 0 ? `<th>${escapar(c)}</th>` : `<td>${escapar(c)}</td>`)).join('');
        return `<tr${atributos(l)}>${celdas}</tr>`;
      }).join('');
      html.push(`<table${atributos(b)}>${filas}</table>`);
      continue;
    }
    html.push(`<p${atributos(b)}>${escapar(b.texto).replace(/\n/g, '<br>')}</p>`);
  }
  return html.join('');
}
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
node tests/test_pdf_mapa_lectura.mjs
```
Esperado: `✅ Mapa de lectura: N comprobaciones bien.` y salida 0.

- [ ] **Paso 5: Confirmar**

```bash
git add js/pdf/mapaLectura.js tests/test_pdf_mapa_lectura.mjs
git commit -m "feat(pdf): mapa de lectura con posiciones reales del texto"
```

---

## Tarea 2: Un solo gesto para leer desde un punto

Quita los hasta 150 botones que ensucian el libro y hace que leer desde un punto funcione de verdad,
con la maquinaria que ya existe (`bloqueDeCaracter` + `window.ttsIrABloque`).

**Archivos:**
- Modificar: `js/pdf/libroVista.js` (importaciones línea 8-9; `renderLectura` líneas 124-158; objeto
  devuelto línea 386-394; función `parteAHtml` líneas 27-65)
- Modificar: `js/pdf/pdfController.js` (objeto `guia` línea 3507; `leerDesdeNodo` líneas 4422-4428;
  objeto `api` línea 4373; `limpiarGuia`; mapa `el` línea 161)
- Modificar: `index.html` (regla CSS línea 4178; consola TTS del PDF, línea 5652 aprox.)
- Modificar: `tests/test_pdf_mejora_apartado.mjs`

**Interfaces:**
- Consume de la Tarea 1: `construirLectura(texto)`.
- Produce, para las tareas 3 y 4:
  - En `pdfController`: `leerDesdeCaracter(caracter: number) => void`, expuesta a la vista como
    `api.leerDesdeCaracter`.
  - En `guia`: el campo nuevo `desdeCaracter: number` (−1 cuando la lectura empezó por el principio).

- [ ] **Paso 1: Escribir la prueba que falla**

Añadir `import { readFileSync } from 'node:fs';` junto a los demás `import` de
`tests/test_pdf_mejora_apartado.mjs`, y este bloque antes del resumen final:

```js
console.log('--- vista de lectura: sin botones inyectados y con posiciones ---');
{
  const vista = readFileSync(new URL('../js/pdf/libroVista.js', import.meta.url), 'utf8');
  comprobar(!vista.includes('Leer desde aquí'),
    'la vista ya no inyecta un botón «Leer desde aquí» en cada párrafo');
  comprobar(vista.includes('leerDesdeCaracter'),
    'la vista pide leer por posición del texto, no por nodo');
  const ctrl = readFileSync(new URL('../js/pdf/pdfController.js', import.meta.url), 'utf8');
  comprobar(!ctrl.includes('jgLeerTextoPdf'),
    'se retira la llamada a una función que no existe');
  comprobar(!/replace\(\/Leer desde aquí/.test(ctrl),
    'ya no hace falta limpiar el texto del botón: la presentación no ensucia el dato');
  comprobar(ctrl.includes('function leerDesdeCaracter'),
    'el controlador expone leerDesdeCaracter');
}
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
node tests/test_pdf_mejora_apartado.mjs
```
Esperado: FALLO en «la vista ya no inyecta un botón…» y en las cuatro siguientes.

- [ ] **Paso 3: Reemplazar `renderLectura` en `js/pdf/libroVista.js`**

Cambiar las importaciones de la cabecera (líneas 8-9) por:

```js
import { aplicarDecisionUsuario } from './limites.js';
import { sha256Hex } from './huella.js';
import { construirLectura } from './mapaLectura.js';
```

Sustituir el bloque de las líneas 124-158 (desde `function renderLectura() {` hasta su llave de
cierre) por:

```js
  function renderLectura() {
    if (!el.lectura) return;
    const texto = api.textoDeParte ? api.textoDeParte(estado.parteActual) : (el.salida ? el.salida.value : '');
    /* El HTML trae las posiciones puestas: no hace falta añadir nada al texto. */
    el.lectura.innerHTML = construirLectura(texto);
    // Capítulo y página física son referencias distintas: las partes internas
    // de procesamiento no se presentan como páginas del libro.
    if (el.docRef) {
      const parte = (estado.partes || [])[estado.parteActual];
      const cap = Number(estado.parteActual) + 1;
      const total = (estado.partes || []).length || 1;
      const pag = parte?.pagina || parte?.pageStart || '';
      el.docRef.textContent = pag
        ? 'Capítulo ' + cap + ' de ' + total + ' · Página ' + pag
        : 'Capítulo ' + cap + ' de ' + total;
    }
    // «Revisar cortes» solo aparece cuando hay algo que revisar.
    const pend = (estado.limites || []).filter((l) => l && l.decision === 'pending').length;
    if (el.cortesCuenta) el.cortesCuenta.textContent = pend ? '(' + pend + ')' : '';
    if (el.btnCortes) el.btnCortes.hidden = pend === 0;
  }

  /* Tocar un párrafo lo lee en voz alta desde ahí.
   *
   * En modo lectura el texto no es editable, así que el toque simple está
   * libre: es el gesto más corto posible y el que ya usan los lectores con
   * voz. Se ignora si la persona estaba seleccionando texto, para no
   * secuestrar el copiar y pegar. */
  if (el.lectura) {
    el.lectura.addEventListener('click', (ev) => {
      const bloque = ev.target.closest('[data-ini]');
      if (!bloque || !el.lectura.contains(bloque)) return;
      const seleccion = document.getSelection();
      if (seleccion && String(seleccion).trim().length > 1) return;
      const ini = Number(bloque.dataset.ini);
      if (!Number.isFinite(ini)) return;
      if (api.leerDesdeCaracter) api.leerDesdeCaracter(ini);
    });
  }
```

En el objeto devuelto por `initLibroVista` (líneas 386-394), sustituir `parteAHtml,` por
`construirLectura,`. Antes de borrar la función `parteAHtml` (líneas 27-65), comprobar quién la usa:

```bash
grep -rn "parteAHtml" js/ tests/ index.html
```
Aparece en `tests/test_pdf_mejora_apartado.mjs`: cambia allí el `import` a `construirLectura` y ajusta
esas comprobaciones para que busquen `data-ini` en lugar de comparar HTML plano. Después, borra
`parteAHtml` y su `export`.

- [ ] **Paso 4: Conectar el controlador**

En `js/pdf/pdfController.js`, añadir al objeto `guia` (línea 3507), después de `saltar: false,`:

```js
    /* Carácter desde el que arrancó esta lectura (−1 = desde el principio).
     * Sirve para saber que un audio más corto que el capítulo NO es una
     * selección suelta, sino este capítulo empezado más abajo. */
    desdeCaracter: -1,
```

Sustituir la función `leerDesdeNodo` (líneas 4422-4428) por:

```js
  /**
   * Lee en voz alta desde un punto exacto del texto.
   *
   * Es el mismo camino que ya usaba el doble toque en el textarea, ahora
   * disponible desde la vista de libro: se ancla al comienzo de la frase
   * (empezar a media frase suena a error), se anota el progreso y, si ya hay
   * voz sonando, se salta al bloque de audio correspondiente. Si no había voz,
   * se selecciona del punto al final y se pulsa Escuchar: el motor lee la
   * selección, y `guia.desdeCaracter` permite seguir resaltando.
   */
  function leerDesdeCaracter(caracter) {
    if (!hayDocumento()) return;
    const texto = el.salida.value || '';
    if (!texto) return;
    const frases = partirEnFrases(texto);
    const punto = Math.max(0, Math.min(texto.length - 1, Math.floor(Number(caracter) || 0)));
    const rango = frases.length ? fraseEn(frases, punto) : null;
    const desde = rango ? rango[0] : punto;

    anotarPosicion({ caracter: desde });
    guia.saltar = true;               /* salto pedido por la persona */

    const destino = bloqueDeCaracter(desde);
    if (destino && ttsSonandoAqui() && typeof window.ttsIrABloque === 'function') {
      window.ttsIrABloque(destino.bloque, destino.dentro);
      avisar('Leyendo desde aquí.', 'info', { efimero: true });
      return;
    }
    guia.desdeCaracter = desde;
    try { el.salida.setSelectionRange(desde, texto.length); } catch (_) { /* textarea oculto */ }
    const boton = document.querySelector('[data-tts-console="pdf"] [data-tts-action="toggle"]');
    if (boton) boton.click();
    else avisar('Pulsa Escuchar para leer desde aquí.', 'info', { efimero: true });
  }
```

En el objeto `api` de `initLibroVista` (línea 4373), sustituir la línea de `leerDesdeParrafo` por:

```js
        leerDesdeCaracter: (caracter) => { try { leerDesdeCaracter(caracter); } catch (_) {} },
```

En `limpiarGuia()` (la función que empieza con `guia.desde = -1;`), añadir al final del cuerpo:

```js
    guia.desdeCaracter = -1;
```

- [ ] **Paso 5: El mismo gesto, con el teclado**

Tocar un párrafo es el atajo rápido, pero quien navega con teclado necesita llegar igual. En vez de
hacer focusable cada párrafo (que convertiría el libro en una lista de controles y estorbaría a los
lectores de pantalla), se añade **un solo botón** al reproductor, que lee desde el primer bloque
visible. En `index.html`, dentro de `.tts-console-row.tts-console-play` de la consola `pdf`
(línea 5652 aprox.), después del botón de detener:

```html
                    <button type="button" class="mini-btn" id="btnPdfDesdeAqui"
                            title="Leer desde el párrafo que estoy viendo">Desde aquí</button>
```

Registrarlo en el mapa `el` de `pdfController.js` (junto a la línea 161):

```js
    btnDesdeAqui: $('btnPdfDesdeAqui'),
```

Y conectarlo justo después de la definición de `leerDesdeCaracter`:

```js
  /* Mismo gesto, para quien usa teclado o lector de pantalla: lee desde el
   * primer párrafo visible, sin tener que apuntar con el dedo. */
  if (el.btnDesdeAqui) {
    el.btnDesdeAqui.addEventListener('click', () => {
      try { leerDesdeCaracter(caracterVisible()); } catch (_) {}
    });
  }
```

**Nota:** hasta que termines la Tarea 4, `caracterVisible()` mide sobre el textarea oculto y devolverá
0, así que este botón leerá desde el principio del capítulo. Es esperado y se resuelve en la Tarea 4;
no lo «arregles» aquí duplicando lógica.

- [ ] **Paso 6: Cambiar el CSS huérfano por la señal de que el texto responde**

En `index.html`, sustituir la línea 4178:

```css
.pdf-lectura .pdf-leer-desde{font-size:.8em;margin-left:.6em}
```

por:

```css
.pdf-lectura [data-ini]{cursor:pointer;border-radius:6px;transition:background .18s ease}
.pdf-lectura [data-ini]:hover{background:color-mix(in srgb,var(--lec-acento) 8%,transparent)}
.pdf-lectura [data-ini]:active{background:color-mix(in srgb,var(--lec-acento) 14%,transparent)}
@media (hover:none){.pdf-lectura [data-ini]:hover{background:none}}
@media (prefers-reduced-motion:reduce){.pdf-lectura [data-ini]{transition:none}}
```

- [ ] **Paso 7: Ejecutar las pruebas**

```bash
node tests/test_pdf_mapa_lectura.mjs && node tests/test_pdf_mejora_apartado.mjs && node tests/test_pdf_continuidad.mjs
```
Esperado: las tres en verde.

- [ ] **Paso 8: Confirmar**

```bash
git add js/pdf/libroVista.js js/pdf/pdfController.js index.html tests/test_pdf_mejora_apartado.mjs
git commit -m "fix(pdf): tocar un parrafo lee desde ahi y se retiran los botones inyectados"
```

---

## Tarea 3: El texto sigue a la voz en la vista de lectura

Hoy, escuchando en modo lectura, no se resalta nada y la página no acompaña al audio. Aquí se conecta
el resaltado y el desplazamiento al contenedor que de verdad se ve.

**Archivos:**
- Modificar: `js/pdf/libroVista.js` (`resaltarFraseEnLectura`, líneas 160-189, y el objeto devuelto)
- Modificar: `js/pdf/pdfController.js` (`hayDocumento` línea 229; oyente de `jg-tts-avance`,
  líneas 3755-3800)
- Modificar: `tests/test_pdf_mejora_apartado.mjs`

**Interfaces:**
- Consume de la Tarea 1: los atributos `data-ini`/`data-fin` del HTML.
- Consume de la Tarea 2: `guia.desdeCaracter`.
- Produce, para la Tarea 4:
  - En `libroVista`: `marcarRango(ini: number, fin: number) => HTMLElement | null` (devuelve la marca
    pintada) y `desplazarA(elemento: HTMLElement) => void`, ambas en el objeto devuelto por
    `initLibroVista`.
  - En `pdfController`: `const enModoLectura = () => !!el.lectura && !el.lectura.hidden;`

- [ ] **Paso 1: Escribir la prueba que falla**

Añadir a `tests/test_pdf_mejora_apartado.mjs`:

```js
console.log('--- la vista de lectura sigue a la voz ---');
{
  const vista = readFileSync(new URL('../js/pdf/libroVista.js', import.meta.url), 'utf8');
  comprobar(vista.includes('marcarRango'), 'la vista sabe marcar un rango de caracteres');
  comprobar(!vista.includes('indexOf(texto)'),
    'el resaltado ya no busca el texto a ciegas: usa las posiciones');
  const ctrl = readFileSync(new URL('../js/pdf/pdfController.js', import.meta.url), 'utf8');
  comprobar(ctrl.includes('enModoLectura'),
    'el controlador distingue qué contenedor se está viendo');
  comprobar(/libroVista(\s*&&\s*libroVista|\?)\.marcarRango/.test(ctrl),
    'el avance de la voz pinta la frase en la vista de lectura');
  comprobar(ctrl.includes('guia.desdeCaracter'),
    'una lectura empezada más abajo sigue resaltándose');
}
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
node tests/test_pdf_mejora_apartado.mjs
```
Esperado: FALLO en «la vista sabe marcar un rango…» y en las cuatro siguientes.

- [ ] **Paso 3: Reemplazar el resaltado en `js/pdf/libroVista.js`**

Sustituir `resaltarFraseEnLectura` (líneas 160-189) por:

```js
  /* Marca el tramo [ini, fin) del texto dentro de la vista.
   *
   * Antes se buscaba el fragmento con `indexOf`, que marcaba la primera
   * aparición de la frase aunque la voz fuera por la quinta. Con las
   * posiciones del mapa se marca exactamente lo que suena. */
  function marcarRango(ini, fin) {
    if (!el.lectura || !(fin > ini)) return null;
    const previa = el.lectura.querySelector('mark');
    if (previa) previa.replaceWith(document.createTextNode(previa.textContent));

    const bloque = [...el.lectura.querySelectorAll('[data-ini]')].reverse()
      .find((b) => Number(b.dataset.ini) <= ini && Number(b.dataset.fin) > ini);
    if (!bloque) return null;

    const base = Number(bloque.dataset.ini);
    const desde = ini - base;
    const hasta = Math.min(fin - base, bloque.textContent.length);
    if (!(hasta > desde)) return null;

    const recorrido = document.createTreeWalker(bloque, NodeFilter.SHOW_TEXT);
    let visto = 0;
    let marca = null;
    while (recorrido.nextNode()) {
      const nodo = recorrido.currentNode;
      const largo = nodo.textContent.length;
      if (visto + largo > desde) {
        const a = Math.max(0, desde - visto);
        const b = Math.min(largo, hasta - visto);
        const trozos = document.createDocumentFragment();
        if (a > 0) trozos.appendChild(document.createTextNode(nodo.textContent.slice(0, a)));
        marca = document.createElement('mark');
        marca.textContent = nodo.textContent.slice(a, b);
        trozos.appendChild(marca);
        if (b < largo) trozos.appendChild(document.createTextNode(nodo.textContent.slice(b)));
        nodo.replaceWith(trozos);
        break;
      }
      visto += largo;
    }
    return marca;
  }

  function prefiereMenosMovimiento() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  }

  /* Lleva la marca a la zona cómoda de lectura (algo por encima del centro,
   * que es donde el ojo la espera) y solo cuando hace falta: si la frase ya se
   * ve, mover la página sería un tirón gratuito. */
  function desplazarA(elemento) {
    if (!elemento || !seguimiento) return;
    const caja = elemento.getBoundingClientRect();
    const alto = window.innerHeight || 800;
    if (caja.top > alto * 0.20 && caja.bottom < alto * 0.80) return;
    elemento.scrollIntoView({ block: 'center', behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth' });
  }
```

`seguimiento` se declara más abajo (línea 192) con `let`, así que **mueve esa declaración por encima
de `marcarRango`**: `let seguimiento = true;` justo antes de `function marcarRango`.

En el objeto devuelto, sustituir `resaltarFraseEnLectura,` por:

```js
    marcarRango,
    desplazarA,
```

- [ ] **Paso 4: Conectar el avance de la voz en `js/pdf/pdfController.js`**

Añadir junto a `hayDocumento` (línea 229):

```js
  /* Qué se está viendo: la vista de libro o el textarea de edición. Todo lo
   * que mida, marque o desplace tiene que preguntar por aquí, porque medir un
   * elemento oculto devuelve ceros: ese era el motivo de que la lectura no
   * siguiera a la voz. */
  const enModoLectura = () => !!el.lectura && !el.lectura.hidden;
```

En el oyente de `jg-tts-avance`, sustituir desde `const largo = el.salida.value.length;` hasta el
final de ese oyente por:

```js
    /* Si lo que suena es una selección suelta, la posición relativa no
     * corresponde con el texto de la pantalla. Pero una lectura pedida con
     * «leer desde aquí» también es más corta que el capítulo y SÍ corresponde:
     * `guia.desdeCaracter` las distingue. */
    const largo = el.salida.value.length;
    const empezadaMasAbajo = guia.desdeCaracter >= 0;
    const parcial = !empezadaMasAbajo && datos.caracteres > 0 && largo > 0 && datos.caracteres < largo * 0.7;
    const marca = parcial ? null : marcarFrase(datos);
    if (parcial) { limpiarGuia(); return; }

    if (Date.now() - voz.pausaManual < ESPERA_TRAS_TOCAR_MS) return;

    /* En modo lectura se marca y se desplaza sobre el artículo visible; en
     * modo edición, sobre el textarea y su capa gemela, como siempre. */
    if (enModoLectura()) {
      if (libroVista && libroVista.marcarRango && guia.desde >= 0) {
        const rango = fraseEn(guia.frases, guia.desde);
        const pintada = rango ? libroVista.marcarRango(rango[0], rango[1]) : null;
        if (pintada) libroVista.desplazarA(pintada);
      }
      return;
    }

    const alto = el.salida.scrollHeight - el.salida.clientHeight;
    if (alto <= 0) return;
    const destino = marca
      ? marca.offsetTop - el.salida.clientHeight * 0.38
      : alto * datos.fraccion;
    const acotado = Math.max(0, Math.min(alto, destino));
    /* Un salto de menos de 4 px no se ve y sí interrumpe la selección. */
    if (Math.abs(el.salida.scrollTop - acotado) < 4) return;
    voz.desplazando = true;
    el.salida.scrollTop = acotado;
    sincronizarRealce();
    requestAnimationFrame(() => { voz.desplazando = false; });
```

`libroVista` se declara en la línea 4358 con `let`, muy por debajo de este oyente. La declaración se
eleva y el oyente solo se ejecuta con un documento abierto, así que funciona; se comprueba en el paso
siguiente, no se da por hecho.

- [ ] **Paso 5: Comprobar en el navegador (no basta con las pruebas)**

```bash
python -m http.server 8000
```
Abrir `http://localhost:8000`, cargar `tests/private/cortes-sintetico.pdf`, pulsar Escuchar y
comprobar: la frase que suena queda resaltada **dentro del texto** y la página baja sola. Luego tocar
un párrafo de más abajo: la voz salta ahí. Revisar la consola: sin errores.

```bash
node tests/verificar_pdf_navegador.mjs
```
Esperado: sin FALLO.

- [ ] **Paso 6: Ejecutar las pruebas y confirmar**

```bash
node tests/test_pdf_mejora_apartado.mjs && node tests/test_pdf_continuidad.mjs && node tests/test_pdf_voz.mjs
git add js/pdf/libroVista.js js/pdf/pdfController.js tests/test_pdf_mejora_apartado.mjs
git commit -m "fix(pdf): la vista de lectura resalta y sigue la frase que suena"
```

---

## Tarea 4: Retomar la lectura donde se quedó

Al reabrir un libro, o al volver de desplazarse a mano, la vista debe volver al punto exacto.

**Archivos:**
- Modificar: `js/pdf/libroVista.js` (bloque de seguimiento manual, líneas 191-202)
- Modificar: `js/pdf/pdfController.js` (`caracterVisible` líneas 918-926; `irAPosicion` líneas 936-961)
- Modificar: `index.html` (posición y estilo del botón `#pdfVolverLectura`)
- Modificar: `tests/test_pdf_mejora_apartado.mjs`

**Interfaces:**
- Consume de la Tarea 3: `enModoLectura()` y `libroVista.desplazarA`.
- Produce: en `libroVista`, `irACaracter(caracter: number) => void` y
  `caracterVisible() => number` (el `ini` del primer bloque cuyo borde inferior sigue en pantalla;
  `0` si no hay ninguno).

- [ ] **Paso 1: Escribir la prueba que falla**

Añadir a `tests/test_pdf_mejora_apartado.mjs`:

```js
console.log('--- retomar la lectura ---');
{
  const vista = readFileSync(new URL('../js/pdf/libroVista.js', import.meta.url), 'utf8');
  comprobar(vista.includes('irACaracter'), 'la vista sabe ir a un carácter guardado');
  comprobar(vista.includes('function caracterVisible'), 'la vista sabe por dónde va quien lee con los ojos');
  comprobar(vista.includes("addEventListener('touchmove'"),
    'el desplazamiento con el dedo también suspende el seguimiento (no solo la rueda del ratón)');
  const ctrl = readFileSync(new URL('../js/pdf/pdfController.js', import.meta.url), 'utf8');
  const trozo = ctrl.slice(ctrl.indexOf('function irAPosicion'), ctrl.indexOf('function irAPosicion') + 1400);
  comprobar(/enModoLectura\(\)/.test(trozo), 'irAPosicion respeta el contenedor visible');
}
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
node tests/test_pdf_mejora_apartado.mjs
```
Esperado: FALLO en las cuatro comprobaciones nuevas.

- [ ] **Paso 3: Añadir la navegación por posición a `js/pdf/libroVista.js`**

Sustituir el bloque de seguimiento manual (líneas 191-202) por:

```js
  /* Seguimiento del audio: se suspende en cuanto la persona se desplaza a
   * mano (rueda, dedo o barra) y se recupera con «Volver a la lectura».
   * Antes solo escuchaba la rueda del ratón, así que en el teléfono —donde
   * más se lee— nunca se suspendía. */
  function onDesplazarManual() {
    if (!seguimiento) return;
    seguimiento = false;
    if (el.volverLectura) el.volverLectura.hidden = false;
  }
  const zona = el.area || el.lectura;
  if (zona) {
    zona.addEventListener('wheel', onDesplazarManual, { passive: true });
    zona.addEventListener('touchmove', onDesplazarManual, { passive: true });
    zona.addEventListener('scroll', onDesplazarManual, { passive: true });
  }
  if (el.volverLectura) el.volverLectura.addEventListener('click', () => {
    seguimiento = true;
    el.volverLectura.hidden = true;
    const marca = el.lectura && el.lectura.querySelector('mark');
    if (marca) marca.scrollIntoView({ block: 'center' });
  });

  /* Lleva la vista al carácter guardado: así un libro se reabre donde se dejó. */
  function irACaracter(caracter) {
    if (!el.lectura) return;
    const bloques = [...el.lectura.querySelectorAll('[data-ini]')];
    if (!bloques.length) return;
    const destino = bloques.reverse().find((b) => Number(b.dataset.ini) <= caracter) || bloques[bloques.length - 1];
    if (destino) destino.scrollIntoView({ block: 'start' });
  }

  /* Por dónde va quien lee con los ojos: el primer bloque todavía visible. */
  function caracterVisible() {
    if (!el.lectura) return 0;
    for (const b of el.lectura.querySelectorAll('[data-ini]')) {
      if (b.getBoundingClientRect().bottom > 0) return Number(b.dataset.ini) || 0;
    }
    return 0;
  }
```

**Ojo:** la declaración `let seguimiento = true;` ya la moviste arriba en la Tarea 3. No la declares
otra vez aquí o el archivo dejará de cargar.

Añadir `irACaracter,` y `caracterVisible,` al objeto devuelto por `initLibroVista`.

- [ ] **Paso 4: Hacer que el controlador use la vista visible**

En `js/pdf/pdfController.js`, dentro de `caracterVisible` (línea 918), como primera línea del cuerpo:

```js
    if (enModoLectura() && libroVista && libroVista.caracterVisible) return libroVista.caracterVisible();
```

Y dentro de `irAPosicion` (línea 936), justo después de `const texto = el.salida.value || '';`:

```js
    /* En modo lectura el textarea está oculto: medirlo devuelve ceros y la
     * vista se quedaba arriba. Se desplaza el contenedor que de verdad se ve. */
    if (enModoLectura() && libroVista && libroVista.irACaracter) {
      libroVista.irACaracter(Math.max(0, Math.floor(Number(caracter) || 0)));
      return;
    }
```

- [ ] **Paso 5: Mover «Volver a la lectura» donde se ve**

En `index.html`, quitar el botón `#pdfVolverLectura` de `.pdf-cortes-barra` (línea 5614) y ponerlo
justo después del cierre de `<article ... id="pdfLectura"></article>` (línea 5581):

```html
              <button type="button" class="pdf-volver-lectura" id="pdfVolverLectura" hidden>
                ↓ Volver a la lectura
              </button>
```

Añadir su CSS junto a las reglas de `.pdf-lectura`:

```css
.pdf-volver-lectura{position:sticky;bottom:12px;margin:0 auto;display:block;min-height:44px;
  padding:0 18px;border-radius:22px;border:1px solid var(--lec-linea);
  background:var(--lec-superficie);color:var(--lec-texto);font:inherit;font-size:14px;
  box-shadow:0 6px 20px -10px rgba(0,0,0,.45);cursor:pointer;z-index:3}
.pdf-volver-lectura:hover{background:var(--lec-superficie-2)}
.pdf-volver-lectura:focus-visible{outline:2px solid var(--lec-acento);outline-offset:2px}
```

- [ ] **Paso 6: Comprobar en el navegador**

Abrir un libro, bajar hasta la mitad, cerrarlo y volver a abrirlo: tiene que aparecer donde se dejó.
Con la voz sonando, desplazarse a mano: aparece «Volver a la lectura»; al pulsarlo, vuelve a la frase
que suena. Comprobar también que el botón «Desde aquí» del reproductor ya lee desde el párrafo visible
(en la Tarea 2 leía desde el principio: aquí queda arreglado).

- [ ] **Paso 7: Ejecutar las pruebas y confirmar**

```bash
node tests/test_pdf_mejora_apartado.mjs && node tests/test_pdf_progreso.mjs && node tests/test_pdf_ancla.mjs
git add js/pdf/libroVista.js js/pdf/pdfController.js index.html tests/test_pdf_mejora_apartado.mjs
git commit -m "fix(pdf): la lectura se retoma en el punto guardado y el seguimiento se suspende con el dedo"
```

---

## Criterio de entrega de este agente

No basta con que las pruebas pasen. Tu parte está terminada cuando, con un libro abierto en el
navegador:

1. Tocar un párrafo empieza a leerlo en voz alta desde ahí, y **no hay ningún botón dentro del texto**.
2. Mientras suena, la frase que se oye está resaltada y la página baja sola.
3. Al desplazarse a mano aparece «Volver a la lectura», y funciona (con dedo y con rueda).
4. Cerrar el libro y volver a abrirlo devuelve al punto exacto.
5. El botón «Desde aquí» del reproductor lee desde el párrafo visible.
6. Estas suites pasan: `test_pdf_mapa_lectura`, `test_pdf_mejora_apartado`, `test_pdf_continuidad`,
   `test_pdf_voz`, `test_pdf_progreso`, `test_pdf_ancla`, `test_pdf_cola_correccion`.

Al terminar, avisa qué quedó hecho y qué te encontraste distinto de lo que dice este plan. **No
despliegues.**
