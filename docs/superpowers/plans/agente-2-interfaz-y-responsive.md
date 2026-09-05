# Agente 2 · Interfaz limpia y responsive de verdad

> **Para el agente que ejecuta:** SUB-SKILL OBLIGATORIA: `superpowers:executing-plans`.
> Ejecuta los pasos en orden, uno por uno. Los pasos usan casillas (`- [ ]`).
> **No trabajes fuera de los archivos listados en cada tarea.** Hay otros agentes trabajando en el
> mismo proyecto y salirte de tu carpeta de archivos provoca conflictos.

**Proyecto:** `C:\Users\juanl\Documents\Proyectos\jg-turbo` (JG Turbo, apartado PDF)

**Empieza solo cuando el Agente 1 haya terminado y confirmado.** Este plan asume que ya existen la
vista con posiciones (`data-ini`) y el botón `#pdfVolverLectura` movido bajo el artículo de lectura.
Comprueba antes de empezar:

```bash
git log --oneline -6
grep -c "data-ini" js/pdf/libroVista.js
grep -n "pdf-volver-lectura" index.html
```
Si `data-ini` no aparece en `libroVista.js`, el Agente 1 no ha terminado: **espera, no improvises**.

**Objetivo:** juntar los ajustes de lectura en un solo sitio, quitar de debajo del texto todo lo que
no es lectura, y dejar la interfaz verificada en móvil, tableta y escritorio.

**Arquitectura:** el apartado PDF ya tiene un patrón de «hojas» (paneles que se abren desde la
cabecera: Contenido, Opciones) con `pdf-hoja-cab`, `data-cerrar-hoja` y el fondo `#pdfHojaFondo`. La
Apariencia se convierte en una hoja más de ese mismo patrón, en vez de un desplegable perdido bajo el
texto. No se inventa un sistema nuevo: se usa el que ya existe.

**Stack:** HTML y CSS dentro de `index.html`, módulos ES nativos, Playwright para la verificación
visual. Sin dependencias nuevas.

**Spec:** `MEJORA APARTADO PDF.md` (raíz del repo), secciones 2 «Lector tipo libro» y 2
«Comportamiento responsive».
**Plan completo del que sale este:** `docs/superpowers/plans/2026-09-04-lector-pdf-legible.md`.

---

## Diagnóstico verificado (por qué existe este plan)

| Hallazgo | Evidencia | Consecuencia para quien lee |
|---|---|---|
| Los tres temas están repartidos: Papel/Noche en «Opciones» (`index.html:5462`), Sepia suelto bajo el texto (`index.html:5605`) | lectura del HTML | Nadie encuentra los ajustes de lectura |
| Bajo el texto hay una fila con cuatro botones siempre visibles: Revisar cortes, Pausar, Vincular PDF original, Volver a la lectura (`index.html:5608-5615`) | lectura del HTML | Compiten con el libro; «Vincular PDF» es mantenimiento, no lectura |
| «Revisar cortes» se muestra siempre, solo deshabilitado (`libroVista.js:157`) | lectura del archivo | Un botón apagado permanente que no comunica nada |
| `libroVista.js:335` deja un `setInterval` de 1 s vivo solo para enseñar u ocultar «Pausar» | lectura del archivo | Trabajo constante del navegador para un botón |
| La verificación de geometría solo prueba 768 y 1280 px (`verificar_pdf_geometria.mjs:137-138`) | lectura del archivo | 320, 390, 1024 y 1440 px nunca se han comprobado |

Lo que **sí está bien y NO se toca**: la reconstrucción del texto, la cola de corrección, el motor de
voz, la vista de lectura con posiciones (del Agente 1), la biblioteca con orden, vistas y paginación
(`libroVista.js:357-381`), y las 13 suites de pruebas. Si una tarea parece pedirte cambiar algo de
esto, es que la estás entendiendo mal: pregunta antes de tocarlo.

## Restricciones globales

- **Idioma:** todo en español de Colombia, nombres de función y comentarios incluidos.
- **Sin dependencias nuevas.** Ni librerías, ni polyfills, ni `npm install`.
- **Ningún identificador cambia de nombre.** `btnPdfTemaPapel`, `btnPdfTemaNoche`, `btnPdfTemaSepia`,
  `btnPdfCortes`, `btnPdfVincular`, `btnPdfPausarCorreccion` **se mueven de sitio, no se renombran**:
  hay oyentes ya escritos que los buscan por id.
- **Colores solo por tokens** `--lec-bg`, `--lec-texto`, `--lec-suave`, `--lec-linea`, `--lec-acento`,
  `--lec-superficie`, `--lec-superficie-2`. Los tres temas se definen en `#pdfResultArea[data-tema=...]`.
  Nunca escribas un color suelto.
- **Contraste WCAG:** ≥ 4,5:1 en texto normal y ≥ 3:1 en bordes de control, **en los tres temas**.
- **Toque mínimo 44 × 44 px**, foco visible con `:focus-visible`, navegable con teclado, `Escape`
  cierra las hojas y el foco vuelve al botón que las abrió, y `prefers-reduced-motion` respetado.
- **Móvil primero.** Anchos de verificación: 320, 390, 768, 1024, 1280 y 1440 px. Un solo contenedor
  con desplazamiento durante la lectura; nunca desplazamiento horizontal.
- **No edites `tests/test_pdf_mejora_apartado.mjs`**: es del Agente 1. Tus comprobaciones van en un
  archivo propio, `tests/test_pdf_interfaz_lectura.mjs`.
- **Git:** `git config user.name "JHONCOD24"` y `git config user.email "juanloras35@gmail.com"`
  (otro autor bloquea el despliegue en Vercel). Confirma **en cada tarea**, nunca todo al final.
- **No despliegues.** El despliegue lo hace el Agente 4, cuando todos hayan terminado.

## Tus archivos (no salgas de aquí)

| Archivo | Qué haces en él |
|---|---|
| `index.html` | Cabecera del documento (botón «Aa»), hoja de Apariencia, barra de cortes, panel Opciones, y las media queries de lectura. **No toques** la regla `.pdf-lectura [data-ini]` ni `.pdf-volver-lectura`: son del Agente 1. |
| `js/pdf/libroVista.js` | **Solo** el bloque de temas (línea 232) y el de «Pausar» (líneas 332-337). **No toques** `renderLectura`, `marcarRango`, `desplazarA`, `irACaracter`, `caracterVisible` ni el seguimiento manual: son del Agente 1. |
| `js/pdf/pdfController.js` | **Solo** el mapa `el` (línea 161) y el final de `actualizarEstadoCorreccion`. Nada más. |
| `tests/test_pdf_interfaz_lectura.mjs` | Lo creas entero. |
| `tests/verificar_pdf_geometria.mjs` | Lista de pantallas y comprobación de desplazamiento. |

---

## Tarea 1: Interfaz limpia (quitar lo que sobra)

Los ajustes de lectura están repartidos en tres sitios y bajo el texto hay una fila de cuatro botones
que compiten con el libro. Se agrupa lo que es de lectura y se aparta lo que es de mantenimiento.

**Archivos:**
- Crear: `tests/test_pdf_interfaz_lectura.mjs`
- Modificar: `index.html` (cabecera línea 5306; grupo de temas líneas 5462-5463; bloque
  `.pdf-apariencia` líneas 5585-5607; `.pdf-cortes-barra` líneas 5608-5615; CSS línea 4183)
- Modificar: `js/pdf/libroVista.js` (tema Sepia línea 232; `setInterval` líneas 332-337)
- Modificar: `js/pdf/pdfController.js` (mapa `el` línea 161; `actualizarEstadoCorreccion`)

**Interfaces:**
- Consume: los identificadores existentes `btnPdfTemaPapel`, `btnPdfTemaNoche`, `btnPdfTemaSepia`,
  `btnPdfCortes`, `btnPdfVincular`, `btnPdfPausarCorreccion`, y la función `fijarTema(tema)` que ya
  existe en `libroVista.js` (línea 91).
- Produce, para la Tarea 2: `btnPdfApariencia` (botón de la cabecera), `pdfAparienciaHoja` (la hoja)
  y, en `libroVista`, `refrescarPausa() => void` en el objeto devuelto.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `tests/test_pdf_interfaz_lectura.mjs`:

```js
/* Interfaz del lector: los ajustes de lectura en un solo sitio y nada de
 * mantenimiento debajo del texto.
 * Ejecutar: node tests/test_pdf_interfaz_lectura.mjs */
import { readFileSync } from 'node:fs';

let fallos = 0; let ok = 0;
function comprobar(cond, msg) {
  if (cond) { ok += 1; console.log(`OK: ${msg}`); }
  else { fallos += 1; console.error(`FALLO: ${msg}`); }
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vista = readFileSync(new URL('../js/pdf/libroVista.js', import.meta.url), 'utf8');
const ctrl = readFileSync(new URL('../js/pdf/pdfController.js', import.meta.url), 'utf8');

console.log('--- los ajustes de lectura viven en un solo sitio ---');
{
  comprobar(!/<details class="pdf-apariencia"/.test(html),
    'la apariencia deja de ser un desplegable bajo el texto');
  comprobar(html.includes('id="btnPdfApariencia"'), 'hay un botón de apariencia en la cabecera');
  comprobar(html.includes('id="pdfAparienciaHoja"'), 'existe la hoja de apariencia');
  const i = html.indexOf('id="pdfAparienciaHoja"');
  const hoja = html.slice(i, i + 3000);
  comprobar(hoja.includes('btnPdfTemaPapel') && hoja.includes('btnPdfTemaNoche') && hoja.includes('btnPdfTemaSepia'),
    'los tres temas viven juntos dentro de la hoja');
  comprobar((html.match(/id="btnPdfTemaPapel"/g) || []).length === 1,
    'el tema Papel aparece una sola vez (no hay grupo duplicado)');
  comprobar((html.match(/id="btnPdfTemaNoche"/g) || []).length === 1,
    'el tema Noche aparece una sola vez');
}

console.log('--- debajo del texto solo queda lo que es de lectura ---');
{
  const lector = html.slice(html.indexOf('id="pdfLectura"'), html.indexOf('id="pdfDockNav"'));
  comprobar(!lector.includes('btnPdfVincular'),
    'vincular el PDF original no vive junto al texto: es mantenimiento');
  comprobar(html.includes('id="btnPdfVincular"'), 'pero sigue existiendo, en Opciones');
  comprobar(/id="btnPdfCortes"[^>]*hidden/.test(html),
    'Revisar cortes empieza oculto: solo aparece si hay cortes');
}

console.log('--- accesibilidad de la hoja ---');
{
  comprobar(/id="btnPdfApariencia"[\s\S]{0,300}aria-expanded/.test(html),
    'el botón de apariencia declara si la hoja está abierta');
  comprobar(/id="pdfAparienciaHoja"[\s\S]{0,200}role="dialog"/.test(html),
    'la hoja es un diálogo con nombre');
  comprobar(vista.includes("ev.key === 'Escape'"), 'Escape cierra la hoja');
  comprobar(vista.includes('btnApariencia.focus()'), 'al cerrar, el foco vuelve al botón que abrió');
  const etiquetas = (html.match(/<label for="pdfApar/g) || []).length;
  comprobar(etiquetas >= 4, 'cada control de apariencia tiene su etiqueta asociada');
}

console.log('--- sin trabajo inútil ---');
{
  comprobar(!vista.includes('setInterval'), 'el botón Pausar deja de comprobarse cada segundo');
  comprobar(vista.includes('function refrescarPausa'), 'Pausar se refresca cuando cambia el estado');
  comprobar(ctrl.includes('libroVista.refrescarPausa'), 'el controlador avisa a la vista del cambio');
}

console.log(fallos ? `\n❌ ${fallos} fallos, ${ok} bien.` : `\n✅ Interfaz del lector: ${ok} comprobaciones bien.`);
process.exit(fallos ? 1 : 0);
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
node tests/test_pdf_interfaz_lectura.mjs
```
Esperado: FALLO en la mayoría de las comprobaciones. Anota cuáles pasan ya: esas no las toques.

- [ ] **Paso 3: Botón de apariencia en la cabecera**

En `index.html`, dentro de `.pdf-doc-acciones`, justo antes del botón `btnPdfIndice` (línea 5306):

```html
                <button class="mini-btn pdf-btn-solo-icono" id="btnPdfApariencia" type="button"
                        aria-expanded="false" aria-controls="pdfAparienciaHoja"
                        title="Tamaño, letra y tema" aria-label="Apariencia de lectura">
                  <span aria-hidden="true" style="font-size:15px;font-weight:600">Aa</span>
                </button>
```

- [ ] **Paso 4: Convertir la apariencia en hoja y juntar los tres temas**

Sustituir el bloque `<details class="pdf-apariencia" id="pdfApariencia"> … </details>`
(líneas 5585-5607) por:

```html
              <div class="pdf-apariencia-hoja" id="pdfAparienciaHoja" hidden role="dialog"
                   aria-labelledby="pdfAparienciaTitulo">
                <div class="pdf-hoja-cab">
                  <h4 class="pdf-hoja-titulo" id="pdfAparienciaTitulo">Apariencia</h4>
                  <button type="button" class="pdf-hoja-cerrar" data-cerrar-hoja="pdfAparienciaHoja"
                          aria-label="Cerrar apariencia">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div class="pdf-apariencia-cuerpo">
                  <div class="pdf-apariencia-temas" role="group" aria-label="Tema de lectura">
                    <button type="button" class="pdf-tema-opcion" id="btnPdfTemaPapel" data-tema="papel">☀ Papel</button>
                    <button type="button" class="pdf-tema-opcion" id="btnPdfTemaSepia" data-tema="sepia">◐ Sepia</button>
                    <button type="button" class="pdf-tema-opcion is-on" id="btnPdfTemaNoche" data-tema="noche">☾ Noche</button>
                  </div>
                  <label for="pdfAparTam">Tamaño de letra
                    <input type="range" id="pdfAparTam" min="16" max="28" step="1" value="19">
                  </label>
                  <label for="pdfAparInter">Espacio entre líneas
                    <input type="range" id="pdfAparInter" min="1.4" max="2" step="0.1" value="1.7">
                  </label>
                  <label for="pdfAparAncho">Anchura del texto
                    <select id="pdfAparAncho">
                      <option value="52">Estrecha</option>
                      <option value="64" selected>Normal</option>
                      <option value="76">Ancha</option>
                    </select>
                  </label>
                  <label for="pdfAparFuente">Letra
                    <select id="pdfAparFuente">
                      <option value="serif">Serif (como un libro)</option>
                      <option value="sans" selected>Sans (como la app)</option>
                    </select>
                  </label>
                </div>
              </div>
```

Borrar del panel «Opciones» las dos líneas del grupo de temas duplicado (5462-5463, `btnPdfTemaPapel`
y `btnPdfTemaNoche`), dejando el contenedor si tiene otros hijos. Comprobar antes quién los usa:

```bash
grep -n "btnPdfTemaPapel\|btnPdfTemaNoche" index.html js/pdf/*.js
```
Los ids no cambian, así que los oyentes existentes siguen funcionando.

- [ ] **Paso 5: Barra de lectura mínima**

Sustituir el bloque `.pdf-cortes-barra` (líneas 5608-5615) por:

```html
              <div class="pdf-cortes-barra">
                <button type="button" class="mini-btn" id="btnPdfCortes" hidden>Revisar cortes <span id="pdfCortesCuenta"></span></button>
                <button type="button" class="mini-btn" id="btnPdfPausarCorreccion" hidden>Pausar corrección</button>
              </div>
```

**Ojo:** si `#pdfVolverLectura` sigue dentro de ese bloque, es que el Agente 1 no terminó su Tarea 4.
Para y avisa; **no lo borres**, porque su sitio nuevo lo decide ese agente.

Mover `btnPdfVincular` y su `input` al panel «Opciones del documento», dentro de la sección `Texto`:

```html
                        <button type="button" class="mini-btn" id="btnPdfVincular">Vincular PDF original</button>
                        <input type="file" id="pdfVincularInput" accept="application/pdf" hidden>
```

- [ ] **Paso 6: CSS de la hoja**

Añadir junto a las reglas `.pdf-apariencia*` (línea 4183) y **borrar** las reglas del `<details>` que
ya no existe (`.pdf-apariencia`, `.pdf-apariencia summary`):

```css
.pdf-apariencia-hoja{position:fixed;left:0;right:0;bottom:0;z-index:40;max-height:80vh;overflow:auto;
  padding:0 16px calc(16px + env(safe-area-inset-bottom));border-radius:18px 18px 0 0;
  background:var(--lec-superficie);border-top:1px solid var(--lec-linea);color:var(--lec-texto);
  box-shadow:0 -12px 32px -18px rgba(0,0,0,.6)}
.pdf-apariencia-hoja .pdf-apariencia-cuerpo{display:flex;flex-direction:column;gap:14px;padding:8px 0 4px}
.pdf-apariencia-hoja label{display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--lec-suave)}
.pdf-apariencia-hoja select{min-height:44px;background:var(--lec-superficie-2);color:var(--lec-texto);
  border:1px solid var(--lec-linea);border-radius:10px;padding:0 12px}
.pdf-apariencia-hoja input[type=range]{width:100%;min-height:44px;accent-color:var(--lec-acento)}
.pdf-apariencia-temas{display:flex;gap:8px;flex-wrap:wrap}
.pdf-apariencia-temas .pdf-tema-opcion{flex:1 1 30%;min-height:44px;border-radius:12px;
  border:1px solid var(--lec-linea);background:var(--lec-superficie-2);color:var(--lec-texto);
  font:inherit;font-size:14px;cursor:pointer}
.pdf-apariencia-temas .pdf-tema-opcion.is-on{border-color:var(--lec-acento);color:var(--lec-acento);
  background:color-mix(in srgb,var(--lec-acento) 12%,transparent)}
.pdf-apariencia-temas .pdf-tema-opcion:focus-visible{outline:2px solid var(--lec-acento);outline-offset:2px}
@media (min-width:768px){
  .pdf-apariencia-hoja{left:auto;right:16px;bottom:auto;top:64px;width:320px;border-radius:16px;
    border:1px solid var(--lec-linea);max-height:70vh}
}
```

- [ ] **Paso 7: Abrir y cerrar la hoja, tres temas, y fuera el `setInterval`**

En `js/pdf/libroVista.js`, sustituir la línea 232 (`if (el.temaSepia) …`) por:

```js
  // Los tres temas, en un solo sitio y con su estado a la vista.
  function pintarTemas(activo) {
    for (const b of [el.temaPapel, el.temaSepia, el.temaNoche]) {
      if (!b) continue;
      const suyo = b.dataset.tema;
      b.classList.toggle('is-on', suyo === activo);
      b.setAttribute('aria-pressed', String(suyo === activo));
    }
  }
  for (const b of [el.temaPapel, el.temaSepia, el.temaNoche]) {
    if (!b) continue;
    b.addEventListener('click', () => { fijarTema(b.dataset.tema); pintarTemas(b.dataset.tema); });
  }
  try { pintarTemas(localStorage.getItem('jg_pdf_tema') || 'noche'); } catch (_) { pintarTemas('noche'); }

  // Hoja de apariencia: se abre desde la cabecera, se cierra con Escape o con
  // su botón, y devuelve el foco al botón que la abrió.
  if (el.btnApariencia && el.aparienciaHoja) {
    const cerrarApariencia = () => {
      el.aparienciaHoja.hidden = true;
      el.btnApariencia.setAttribute('aria-expanded', 'false');
      el.btnApariencia.focus();
    };
    el.btnApariencia.addEventListener('click', () => {
      if (!el.aparienciaHoja.hidden) { cerrarApariencia(); return; }
      el.aparienciaHoja.hidden = false;
      el.btnApariencia.setAttribute('aria-expanded', 'true');
      const primero = el.aparienciaHoja.querySelector('button, select, input');
      if (primero) primero.focus();
    });
    el.aparienciaHoja.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarApariencia(); });
    const cerrarBoton = el.aparienciaHoja.querySelector('[data-cerrar-hoja="pdfAparienciaHoja"]');
    if (cerrarBoton) cerrarBoton.addEventListener('click', cerrarApariencia);
  }
```

Sustituir el bloque del `setInterval` (líneas 332-337) por:

```js
  /* «Pausar» aparece cuando hay corrección en marcha. El controlador avisa al
   * cambiar el estado: no hace falta preguntar cada segundo. */
  function refrescarPausa() {
    if (el.btnPausar) el.btnPausar.hidden = !estado.correccionProgreso?.ejecutando;
  }
  if (el.btnPausar) el.btnPausar.addEventListener('click', () => api.pausar && api.pausar());
  refrescarPausa();
```

Añadir `refrescarPausa,` al objeto devuelto por `initLibroVista`.

En `js/pdf/pdfController.js`, registrar los elementos nuevos en el mapa `el` (junto a la línea 161):

```js
    temaPapel: $('btnPdfTemaPapel'), temaNoche: $('btnPdfTemaNoche'),
    btnApariencia: $('btnPdfApariencia'), aparienciaHoja: $('pdfAparienciaHoja'),
```

Y al final del cuerpo de `actualizarEstadoCorreccion()`:

```js
    try { if (libroVista && libroVista.refrescarPausa) libroVista.refrescarPausa(); } catch (_) {}
```

- [ ] **Paso 8: Comprobar en el navegador**

```bash
python -m http.server 8000
```
Abrir un libro y comprobar: el botón «Aa» abre la hoja; los tres temas cambian el color y el activo se
ve marcado; cerrar con `Escape` devuelve el foco al «Aa»; el tamaño y la anchura elegidos siguen ahí
al recargar; «Vincular PDF original» está en Opciones; «Revisar cortes» solo aparece si hay cortes.

- [ ] **Paso 9: Ejecutar las pruebas y confirmar**

```bash
node tests/test_pdf_interfaz_lectura.mjs && node tests/test_pdf_auditoria_p0.mjs && node tests/test_pdf_cola_correccion.mjs
git add index.html js/pdf/libroVista.js js/pdf/pdfController.js tests/test_pdf_interfaz_lectura.mjs
git commit -m "refactor(pdf): apariencia en una hoja, tres temas juntos y barra de lectura sin ruido"
```

---

## Tarea 2: Responsive verificado de 320 a 1440 px

**Archivos:**
- Modificar: `tests/verificar_pdf_geometria.mjs` (lista de dispositivos, líneas 136-139)
- Modificar: `index.html` (media queries de lectura, líneas 4208-4211)

**Interfaces:**
- Consume: la interfaz ya reorganizada por la Tarea 1.
- Produce: verificación reproducible con `node tests/verificar_pdf_geometria.mjs`, que devuelve 1 si
  algo falla.

- [ ] **Paso 1: Comprobar que Playwright está disponible**

```bash
node tests/verificar_pdf_geometria.mjs
```
Si dice «no se encontró Playwright», instálalo como dependencia de desarrollo (`npm i -D playwright`)
**solo si el usuario lo autoriza**; si no, avisa y salta a la comprobación manual del Paso 5.

- [ ] **Paso 2: Ampliar la verificación para que falle donde debe**

En `tests/verificar_pdf_geometria.mjs`, sustituir la lista de dispositivos (líneas 136-139) por:

```js
const PANTALLAS = [
  ['móvil pequeño', { viewport: { width: 320, height: 640 } }],
  ['móvil', { viewport: { width: 390, height: 844 } }],
  ['tablet', { viewport: { width: 768, height: 1024 } }],
  ['tablet ancha', { viewport: { width: 1024, height: 768 } }],
  ['escritorio', { viewport: { width: 1280, height: 860 } }],
  ['escritorio ancho', { viewport: { width: 1440, height: 900 } }],
];
```

Añadir, dentro de las comprobaciones del estado «lector», la de un solo eje de desplazamiento:

```js
  const desplazables = await pagina.evaluate(() => {
    const zona = document.getElementById('pdfResultArea');
    if (!zona) return 0;
    return [...zona.querySelectorAll('*')].filter((n) => {
      const e = getComputedStyle(n);
      return /(auto|scroll)/.test(e.overflowY) && n.scrollHeight > n.clientHeight + 4;
    }).length;
  });
  comprobar(desplazables <= 1,
    `${nombre}: un solo contenedor se desplaza durante la lectura (hay ${desplazables})`);
```

Verificar que el script termina con `process.exit(fallos ? 1 : 0)` y que la comprobación de 44 px suma
a `fallos` (hoy la geometría podía informar sin romper la ejecución).

- [ ] **Paso 3: Ejecutar y anotar qué falla**

```bash
node tests/verificar_pdf_geometria.mjs; echo "salida=$?"
```
Esperado: FALLO en al menos un ancho nuevo (320 px y 1024 px son los candidatos). **Anota cuáles antes
de tocar el CSS**: se corrige lo que falla, no lo que se supone.

- [ ] **Paso 4: Corregir el CSS según lo anotado**

Sustituir las media queries de lectura (líneas 4208-4211) por:

```css
@media (max-width:767px){
  .pdf-lectura{font-size:clamp(17px,4.4vw,19px)}
  .pdf-texto-col{max-width:100%;padding-inline:14px}
  .pdf-cortes-barra{justify-content:center}
}
@media (min-width:768px) and (max-width:1023px){
  .pdf-lectura{max-width:62ch}
  .pdf-texto-col{padding-inline:20px}
}
@media (min-width:1024px){
  .pdf-lectura{max-width:var(--pdf-lectura-ancho,64ch)}
  #pdfIndice{position:sticky;top:12px;max-height:70vh;overflow:auto}
}
@media (prefers-reduced-motion:reduce){
  .pdf-lectura *,.pdf-realce mark{transition:none!important;animation:none!important;scroll-behavior:auto!important}
}
```

Si falla la comprobación de doble desplazamiento, deja el desplazamiento en el contenedor exterior
(`.pdf-lector-cuerpo`) y quítalo de `.pdf-texto-col`; el `<article>` no debe tener `overflow` propio.

Vuelve a ejecutar hasta que quede en verde:

```bash
node tests/verificar_pdf_geometria.mjs; echo "salida=$?"
```
Esperado: `salida=0` y sin FALLO en las seis pantallas.

- [ ] **Paso 5: Comprobar contraste en los tres temas**

Con un libro abierto, en Papel, Sepia y Noche, comprobar con las herramientas del navegador que el
texto del cuerpo alcanza ≥ 4,5:1 contra su fondo y el borde de los botones ≥ 3:1. Sepia es el caso
justo (`--lec-acento:#8A5A17` sobre `#F3E9D2`, definido en `index.html:4167`): si no llega, oscurece
el acento hasta cumplir y anota el valor nuevo en el mensaje del commit.

- [ ] **Paso 6: Confirmar**

```bash
git add index.html tests/verificar_pdf_geometria.mjs
git commit -m "fix(pdf): lectura responsive verificada de 320 a 1440 y un solo eje de desplazamiento"
```

---

## Criterio de entrega de este agente

No basta con que las pruebas pasen. Tu parte está terminada cuando, con un libro abierto:

1. Los ajustes de lectura (tamaño, letra, anchura, tema) están **en un solo sitio**, se abren desde la
   cabecera con «Aa» y se recuerdan al recargar.
2. Los tres temas están juntos, el activo se ve marcado, y los tres pasan contraste.
3. Debajo del texto no queda nada de mantenimiento: «Vincular PDF original» está en Opciones y
   «Revisar cortes» solo aparece cuando hay cortes.
4. La hoja se cierra con `Escape` y el foco vuelve al botón que la abrió.
5. `node tests/verificar_pdf_geometria.mjs` termina con `salida=0` en las seis pantallas.
6. Estas suites pasan: `test_pdf_interfaz_lectura`, `test_pdf_auditoria_p0`, `test_pdf_cola_correccion`,
   y las del Agente 1 siguen en verde (`test_pdf_mejora_apartado`, `test_pdf_mapa_lectura`).

Al terminar, avisa qué quedó hecho y qué te encontraste distinto de lo que dice este plan. **No
despliegues.**
