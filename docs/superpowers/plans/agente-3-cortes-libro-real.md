# Agente 3 · Palabras cortadas: aceptación con un libro real

> **Para el agente que ejecuta:** SUB-SKILL OBLIGATORIA: `superpowers:executing-plans`.
> Ejecuta los pasos en orden, uno por uno. Los pasos usan casillas (`- [ ]`).
> **No trabajes fuera de los archivos listados.** Hay otros agentes trabajando en el mismo proyecto al
> mismo tiempo y salirte de tu carpeta de archivos provoca conflictos.

**Proyecto:** `C:\Users\juanl\Documents\Proyectos\jg-turbo` (JG Turbo, apartado PDF)

**Puedes empezar de inmediato**, en paralelo con el Agente 1: no compartís ni un archivo.

**Objetivo:** que la única prueba capaz de detectar palabras cortadas en un libro de verdad **se pueda
ejecutar y falle cuando debe**, y corregir lo que ese libro revele.

**Arquitectura:** el motor de reconstrucción (átomos → límites → texto canónico, v7) ya existe y sus
13 suites sintéticas pasan. El problema no es el motor: es que **nunca se ha probado contra un libro
real**, porque el script que debía hacerlo no arranca. Este plan arregla el arranque, cambia las
comprobaciones «de cuatro palabras conocidas» por una medida general de indicios de corte, y convierte
en casos de prueba lo que aparezca.

**Stack:** Node 24, PDF.js local (`js/vendor/pdfjs/`), módulos ES nativos. Sin dependencias nuevas.

**Spec:** `MEJORA APARTADO PDF.md` (raíz del repo), secciones 3 «Evitar cortes y uniones incorrectas»
y 5 «Pruebas y criterio de entrega».
**Plan completo del que sale este:** `docs/superpowers/plans/2026-09-04-lector-pdf-legible.md`.

---

## Diagnóstico verificado (por qué existe este plan)

Ejecutado y comprobado antes de escribir este plan:

```
JG_PDF_REAL=tests/private/becoming.pdf node tests/test_pdf_reales.mjs
→ UnknownErrorException: n.toHex is not a function
→ salida = 0
```

Dos fallos encadenados:

1. **PDF.js no arranca en Node.** `tests/test_pdf_reales.mjs:24` importa `pdf.min.mjs`, el build para
   navegador, que usa APIs que en Node no existen. El propio PDF.js lo avisa en la primera línea:
   `Warning: Please use the legacy build in Node.js environments.`
2. **El script termina en 0 aunque explote.** Así que, ejecutado en cualquier cadena de verificación,
   pasaría como bueno sin haber leído ni una página.

Y un tercero, de diseño:

3. **Las comprobaciones solo sirven para un libro.** El script busca cuatro palabras concretas
   (`Boston`, `ARN`, `aluvión`, `esta`) que alguien vio partidas una vez. Con otro libro no detecta
   nada, y el script se omite entero si no se le pasa una ruta.

Resultado: las 13 suites sintéticas están en verde y el usuario sigue viendo palabras partidas por la
mitad entre páginas y entre párrafos. Esa contradicción se explica sola: **lo sintético se prueba, lo
real no**.

Lo que **sí está bien y NO se toca**: `reconstruirDesdeAtomos`, `crearLimites`,
`resolverLimitesDeterministas`, el invariante de letras, la partición sin cortar tokens, la cola de
corrección, y todo el apartado de interfaz (es de los Agentes 1 y 2). Solo cambias `limites.js` o
`lexico.js` **si el libro real demuestra un fallo concreto**, y siempre con una prueba que lo capture
primero.

## Restricciones globales

- **Idioma:** todo en español de Colombia, nombres de función y comentarios incluidos.
- **Sin dependencias nuevas de npm.** El build legacy de PDF.js es un archivo estático que va junto al
  que ya existe en `js/vendor/pdfjs/`, no un paquete.
- **El texto es sagrado.** `invarianteLetras(atomos, texto, limites)` debe seguir pasando en todos los
  casos. Ninguna corrección puede perder ni inventar letras.
- **Una palabra desconocida no es una palabra mal.** No añadas listas de palabras para tapar un caso:
  la evidencia sale del documento (geometría, guiones, formas completas observadas), no de un
  diccionario escrito a mano. Si un caso solo se arregla metiendo una palabra en una lista, es que no
  está entendido.
- **Nunca imprimas el texto completo de un libro** en la salida de las pruebas: son archivos privados
  del usuario. Cifras y ejemplos cortos, nada más.
- **No edites `tests/test_pdf_mejora_apartado.mjs`**: es del Agente 1. Tus casos nuevos van en
  `tests/test_pdf_cortes_reales.mjs`.
- **Git:** `git config user.name "JHONCOD24"` y `git config user.email "juanloras35@gmail.com"`
  (otro autor bloquea el despliegue en Vercel). Confirma **en cada tarea**, nunca todo al final.
- **No despliegues.** El despliegue lo hace el Agente 4, cuando todos hayan terminado.

## Tus archivos (no salgas de aquí)

| Archivo | Qué haces en él |
|---|---|
| `tests/test_pdf_reales.mjs` | Lo arreglas: arranque, medida de indicios y salida de error. |
| `tests/test_pdf_cortes_reales.mjs` | Lo creas: los casos que revele el libro real. |
| `js/vendor/pdfjs/pdf.legacy.min.mjs` y `pdf.worker.legacy.min.mjs` | Los añades solo si faltan. |
| `js/pdf/limites.js`, `js/pdf/lexico.js` | **Solo si el libro real demuestra un fallo.** |
| `CAMBIOS_PDF.md` | Anotas las cifras obtenidas. |

---

## Tarea 1: Que la prueba del libro real se pueda ejecutar

**Archivos:**
- Modificar: `tests/test_pdf_reales.mjs` (bloque de importación, líneas 24-27)
- Añadir si faltan: `js/vendor/pdfjs/pdf.legacy.min.mjs`, `js/vendor/pdfjs/pdf.worker.legacy.min.mjs`

**Interfaces:**
- Consume: `reconstruirDocumento(paginas, { atomos })` y `invarianteLetras(atomos, texto, limites)` de
  `js/pdf/reconstruccion.js`; `extraerAtomosDeTextContent(textContent, { page, viewport })` de
  `js/pdf/atomos.js`. Ya existen y no cambian.
- Produce, para la Tarea 2: un script que devuelve **1** cuando algo va mal y **0** solo cuando el
  libro se reconstruye limpio.

- [ ] **Paso 1: Reproducir el fallo y dejarlo anotado**

```bash
JG_PDF_REAL=tests/private/becoming.pdf node tests/test_pdf_reales.mjs; echo "salida=$?"
```
Esperado: el error `n.toHex is not a function` y, aun así, `salida=0`. Copia esa salida a un lado: es
la prueba de que el problema existía antes de tocar nada.

- [ ] **Paso 2: Ver qué builds de PDF.js hay**

```bash
ls js/vendor/pdfjs/
grep -o "PDFJS_VERSION[^,]*" js/vendor/pdfjs/pdf.min.mjs | head -1
```
Anota la versión exacta. Si ya existe `pdf.legacy.min.mjs`, salta al Paso 4.

- [ ] **Paso 3: Añadir el build legacy (solo si falta)**

Descarga de la **misma versión** que el build moderno los dos archivos `pdf.legacy.min.mjs` y
`pdf.worker.legacy.min.mjs` y déjalos en `js/vendor/pdfjs/`, junto a los que ya están. Son archivos
estáticos: no se instala nada con npm y no cambia lo que sirve el navegador (la app sigue cargando el
build moderno; el legacy es solo para las pruebas en Node).

Comprueba que el proyecto los ignora o los incluye como corresponde:

```bash
grep -n "pdfjs\|vendor" .vercelignore .gitignore
```
Si `.vercelignore` excluye la carpeta, no hay nada que hacer. Si no, añade los dos archivos legacy a
`.vercelignore` para no engordar el despliegue con algo que solo usan las pruebas.

- [ ] **Paso 4: Arreglar el arranque y la salida de error**

En `tests/test_pdf_reales.mjs`, sustituir el bloque de importación (líneas 24-27) por:

```js
/* En Node hace falta el build «legacy»: el moderno usa APIs que solo existen
 * en el navegador y fallaba con «n.toHex is not a function». Si no está el
 * legacy, se dice claramente en vez de morir a medias. */
const legacy = resolve(AQUI, '../js/vendor/pdfjs/pdf.legacy.min.mjs');
if (!existsSync(legacy)) {
  console.error('FALLO: falta js/vendor/pdfjs/pdf.legacy.min.mjs (build de PDF.js para Node).');
  process.exit(1);
}
const pdfjs = await import(pathToFileURL(legacy).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolve(AQUI, '../js/vendor/pdfjs/pdf.worker.legacy.min.mjs')
).href;
/* Un fallo dentro de una promesa no puede seguir devolviendo «todo bien». */
process.on('unhandledRejection', (e) => { console.error('FALLO: ' + (e?.message || e)); process.exit(1); });
```

- [ ] **Paso 5: Comprobar que ahora sí lee el libro**

```bash
JG_PDF_REAL=tests/private/cortes-sintetico.pdf node tests/test_pdf_reales.mjs; echo "salida=$?"
```
Esperado: una línea con `páginas=… atomos=… pendientes=… chars=…` y un número de caracteres mayor que
cero. Si sigue fallando, el problema es la versión del build legacy: vuelve al Paso 3.

- [ ] **Paso 6: Confirmar**

```bash
git add tests/test_pdf_reales.mjs js/vendor/pdfjs/ .vercelignore
git commit -m "test(pdf): la prueba con libro real arranca en Node y falla cuando debe"
```

---

## Tarea 2: Medir los cortes de verdad, no cuatro palabras conocidas

**Archivos:**
- Modificar: `tests/test_pdf_reales.mjs` (bloque de detección y cierre del script)

**Interfaces:**
- Consume de la Tarea 1: el script que ya arranca.
- Produce, para la Tarea 3: un informe con el número de indicios por tipo, reproducible con cualquier
  PDF que se le pase.

- [ ] **Paso 1: Sustituir la detección**

En `tests/test_pdf_reales.mjs`, sustituir el bloque de detección (las cuatro búsquedas de `Boston`,
`ARN`, `aluvión`, `esta`) y el cierre del script por:

```js
/* Las cuatro palabras de antes solo servían para un libro. Aquí se mide lo que
 * de verdad importa: cuántos indicios de corte quedan en TODO el texto.
 *
 * - Un guion con espacio detrás es una partición que no se resolvió.
 * - Una minúscula pegada a una mayúscula en medio de palabra son dos palabras
 *   que se unieron sin espacio.
 * - Dos trozos cortos separados justo antes de un signo suelen ser una palabra
 *   partida por la mitad. */
const patrones = [
  [/\w+-\s+\w+/g, 'guion de partición sin resolver'],
  [/[a-záéíóúñ]{2,}[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/g, 'dos palabras pegadas sin espacio'],
  [/\b[a-záéíóúñ]{1,3}\s+[a-záéíóúñ]{1,3}\b(?=[,.;])/g, 'posible palabra partida antes de puntuación'],
];
console.log(`páginas=${totalPaginas} atomos=${atomos.length} pendientes=${r.pendientes} chars=${r.texto.length}`);
for (const [patron, motivo] of patrones) {
  const hallados = r.texto.match(patron) || [];
  /* Solo un ejemplo corto: el libro es privado y no se vuelca en la consola. */
  if (hallados.length) console.log(`  · ${motivo}: ${hallados.length} (ej. «${hallados[0].slice(0, 40)}»)`);
}

const fallos = [];
if (!invarianteLetras(atomos, r.texto, r.limites)) fallos.push('el invariante de letras no se cumple');
if (/\w+-\s+\w+/.test(r.texto)) fallos.push('quedan guiones de partición sin resolver');
console.log(fallos.length
  ? `\n❌ ${fallos.join('; ')}`
  : '\n✅ Libro real reconstruido sin cortes sin resolver.');
process.exit(fallos.length ? 1 : 0);
```

- [ ] **Paso 2: Ejecutar con los dos PDF disponibles**

```bash
JG_PDF_REAL=tests/private/cortes-sintetico.pdf node tests/test_pdf_reales.mjs; echo "salida=$?"
JG_PDF_REAL=tests/private/becoming.pdf node tests/test_pdf_reales.mjs; echo "salida=$?"
```
Anota las cifras de los dos: páginas, átomos, pendientes, caracteres y el número de indicios por tipo.
**Esas cifras son el resultado principal de tu trabajo**, pasen o fallen.

- [ ] **Paso 3: Confirmar el medidor**

```bash
git add tests/test_pdf_reales.mjs
git commit -m "test(pdf): medida general de indicios de corte en cualquier libro"
```

---

## Tarea 3: Corregir lo que el libro real revele

Esta tarea **solo tiene trabajo si la Tarea 2 terminó con `salida=1` o con indicios altos**. Si el
libro sale limpio, salta al Paso 4 y déjalo documentado.

**Archivos:**
- Crear: `tests/test_pdf_cortes_reales.mjs`
- Modificar (solo lo que haga falta): `js/pdf/limites.js`, `js/pdf/lexico.js`

**Interfaces:**
- Consume: `crearAtomo(campos)` de `js/pdf/atomos.js`; `reconstruirDesdeAtomos(atomos, opciones)` e
  `invarianteLetras(atomos, texto, limites)` de `js/pdf/reconstruccion.js`.
- Produce: casos que fallan antes del arreglo y pasan después.

- [ ] **Paso 1: Convertir cada indicio en un caso que falla**

Crear `tests/test_pdf_cortes_reales.mjs` con esta estructura, y **añadir un bloque por cada indicio
distinto** que hayas encontrado en la Tarea 2, con los átomos que lo reproducen:

```js
/* Cortes encontrados en libros reales, convertidos en casos reproducibles.
 * Cada bloque nace de un indicio medido por tests/test_pdf_reales.mjs.
 * Ejecutar: node tests/test_pdf_cortes_reales.mjs */
import { crearAtomo } from '../js/pdf/atomos.js';
import { reconstruirDesdeAtomos, invarianteLetras } from '../js/pdf/reconstruccion.js';

let fallos = 0; let ok = 0;
function comprobar(cond, msg) {
  if (cond) { ok += 1; console.log(`OK: ${msg}`); }
  else { fallos += 1; console.error(`FALLO: ${msg}`); }
}
function atomosDe(items, page = 1) {
  return items.map((it, i) => crearAtomo({ page, itemIndex: i, ...it }));
}
function reconstruir(items, extra = {}) {
  const atomos = [];
  if (Array.isArray(items[0])) items.forEach((pag, p) => atomos.push(...atomosDe(pag, p + 1)));
  else atomos.push(...atomosDe(items, 1));
  return reconstruirDesdeAtomos(atomos, extra);
}

/* PLANTILLA — copia este bloque por cada indicio real y rellena los átomos con
 * la geometría del caso (x, y, width, height, hasEOL) tal como aparecía en el
 * libro. El texto esperado se escribe a mano, leyendo la página original. */
console.log('--- palabra partida entre el final de una página y el principio de la siguiente ---');
{
  const r = reconstruir([
    [{ str: 'una palabra extraor-', x: 70, y: 90, width: 180, height: 11, hasEOL: true }],
    [{ str: 'dinaria abre el capítulo', x: 70, y: 700, width: 200, height: 11 }],
  ]);
  comprobar(/extraordinaria/.test(r.texto), 'la palabra partida entre páginas se vuelve a unir');
  comprobar(!/extraor-\s/.test(r.texto), 'no queda el guion de partición');
  comprobar(invarianteLetras(r.atomos, r.texto, r.limites), 'no se pierde ni se inventa ninguna letra');
}

console.log(fallos ? `\n❌ ${fallos} fallos, ${ok} bien.` : `\n✅ Cortes reales: ${ok} comprobaciones bien.`);
process.exit(fallos ? 1 : 0);
```

- [ ] **Paso 2: Ejecutar y ver qué casos fallan**

```bash
node tests/test_pdf_cortes_reales.mjs
```
Esperado: fallan los casos que reprodujiste. Si **todos pasan**, tus átomos no reproducen el caso real:
vuelve al PDF, mira la geometría de esa página con `pdfjs` y ajusta los valores hasta que falle. Un
caso que pasa desde el principio no demuestra nada.

- [ ] **Paso 3: Corregir en `limites.js` o `lexico.js`, un caso a la vez**

Reglas para no romper lo que ya funciona:

- Empieza por `resolverLimitesDeterministas` (`js/pdf/limites.js:174`): ahí se decide `join`, `space`,
  `paragraph` o `pending` para cada límite. Lo que no se pueda decidir con evidencia **debe quedar en
  `pending`**, no adivinarse: la interfaz ya tiene «Revisar cortes» para eso.
- `clasificarGuion` (`limites.js:124`) distingue guion de partición, guion léxico, guion de diálogo y
  guion no separable. Si tu caso es de guiones, empieza ahí.
- En `js/pdf/lexico.js`, `decidirPorLexico` (línea 217) solo debe apoyar una decisión con evidencia del
  propio documento (`vocabularioDelDocumento`, línea 164). **No añadas palabras a mano.**
- Después de **cada** cambio, ejecuta las suites que protegen lo que ya funcionaba:

```bash
node tests/test_pdf_cortes_reales.mjs && node tests/test_pdf_continuidad.mjs && node tests/test_pdf_limpieza.mjs && node tests/test_pdf_mejora_apartado.mjs
```
Si una de las tres últimas se pone roja, tu arreglo rompió un caso ya resuelto: deshazlo y busca otra
vía. **No relajes una prueba existente para que pase la tuya.**

- [ ] **Paso 4: Volver a medir el libro real**

```bash
JG_PDF_REAL=tests/private/becoming.pdf node tests/test_pdf_reales.mjs; echo "salida=$?"
```
Compara con las cifras que anotaste en la Tarea 2. Si los indicios no bajaron, dilo claramente: es un
resultado válido y hay que saberlo, no maquillarlo.

- [ ] **Paso 5: Dejar constancia y confirmar**

En `CAMBIOS_PDF.md`, añade una entrada con la tabla de cifras **antes y después**:

```
| Libro | páginas | átomos | pendientes | guiones sin resolver | palabras pegadas | partidas ante signo |
```

Sin esa cifra nadie podrá saber si la próxima versión mejora o empeora.

```bash
git add tests/test_pdf_cortes_reales.mjs js/pdf/limites.js js/pdf/lexico.js CAMBIOS_PDF.md
git commit -m "fix(pdf): cortes hallados en libro real, con sus casos de prueba"
```

---

## Criterio de entrega de este agente

Tu parte está terminada cuando:

1. `JG_PDF_REAL=tests/private/becoming.pdf node tests/test_pdf_reales.mjs` **se ejecuta de verdad** y
   su código de salida refleja el resultado (1 si hay cortes sin resolver, 0 si no).
2. Existen las cifras del libro real anotadas en `CAMBIOS_PDF.md`, antes y después.
3. Cada corrección que hiciste tiene un caso en `tests/test_pdf_cortes_reales.mjs` que fallaba antes.
4. `test_pdf_continuidad`, `test_pdf_limpieza`, `test_pdf_mejora_apartado` y `test_pdf_cola_correccion`
   siguen en verde.

**Si el libro real revela cortes que no supiste arreglar, no los escondas.** Termina el resto, deja el
caso escrito en `tests/test_pdf_cortes_reales.mjs` marcado con un comentario `/* PENDIENTE: … */`, y
dilo en tu informe final. Un problema conocido y medido vale mucho más que uno tapado.

Al terminar, avisa qué quedó hecho y qué te encontraste distinto de lo que dice este plan. **No
despliegues.**
