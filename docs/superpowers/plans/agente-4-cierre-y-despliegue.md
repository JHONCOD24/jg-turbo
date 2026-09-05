# Agente 4 · Verificación de conjunto, cierre de versión y despliegue

> **Para el agente que ejecuta:** SUB-SKILL OBLIGATORIA: `superpowers:verification-before-completion`.
> Ejecuta los pasos en orden, uno por uno. Los pasos usan casillas (`- [ ]`).
> **Este agente no arregla la interfaz ni el motor de texto.** Verifica, cierra la versión y despliega.
> Si encuentras un fallo, lo documentas y lo devuelves al agente que corresponde: no lo parcheas aquí.

**Proyecto:** `C:\Users\juanl\Documents\Proyectos\jg-turbo` (JG Turbo, apartado PDF)

**Empieza solo cuando los Agentes 1, 2 y 3 hayan terminado y confirmado.** Comprueba antes:

```bash
git log --oneline -15
git status --short
```
Debe haber commits de los tres (mapa de lectura, gesto de leer, resaltado, reanudación, apariencia en
hoja, responsive, libro real). Si falta alguno, **espera**.

**Objetivo:** comprobar que las tres partes funcionan juntas (no solo cada una por su lado), cerrar la
versión, desplegar y verificar en producción.

**Por qué existe este agente:** tres agentes tocaron `js/pdf/libroVista.js`, `js/pdf/pdfController.js`
e `index.html`. Cada uno dejó sus pruebas en verde, pero **nadie ha comprobado el conjunto**: que la
hoja de Apariencia no tape la marca de la voz, que cambiar el tamaño de letra no rompa el
desplazamiento, que un libro con cortes pendientes muestre su botón. Eso se comprueba aquí.

**Spec:** `MEJORA APARTADO PDF.md` (raíz del repo), sección 5.
**Plan completo del que sale este:** `docs/superpowers/plans/2026-09-04-lector-pdf-legible.md`.

---

## Restricciones globales

- **Idioma:** todo en español de Colombia.
- **Evidencia antes que afirmaciones.** No escribas «funciona» sin pegar la salida del comando que lo
  demuestra. Si una prueba falla, se dice con su salida; no se da por buena «porque el resto pasa».
- **Git:** `git config user.name "JHONCOD24"` y `git config user.email "juanloras35@gmail.com"`.
  Con cualquier otro autor, **Vercel bloquea el despliegue** (`Deployment Blocked`). En particular,
  nunca `186778938+JHONCOD24@users.noreply.github.com`.
- **Despliegue:** `npx vercel --prod --yes --scope jhoncod24s-projects`, desde la raíz del proyecto.
  **No uses `--cwd`** (con Vercel CLI 59.x publica en el proyecto equivocado). Detalle completo en
  `DOCUMENTACION_DESPLIEGUE.md`.
- **Antes de desplegar, pide confirmación al usuario.** El despliegue es público e irreversible en el
  sentido de que reemplaza lo que la gente está usando ahora mismo.
- **Una sola prueba roja detiene el despliegue.** Sin excepciones ni «es un detalle menor».

## Tus archivos

| Archivo | Qué haces en él |
|---|---|
| `sw.js` | Subes el número de versión de la caché. |
| `CAMBIOS_PDF.md` | Anotas la entrada de la versión. |
| `FICHA_TECNICA.md` | Actualizas la versión del apartado PDF. |
| `DOCUMENTACION_DESPLIEGUE.md` | Anotas el identificador del despliegue. |
| `TRAMPAS.md` | Anotas cualquier trampa nueva que hayas descubierto verificando. |

---

## Tarea 1: Verificación de conjunto

**Archivos:** ninguno (solo ejecutas y observas).

**Interfaces:**
- Consume: todo lo que dejaron los Agentes 1, 2 y 3.
- Produce, para la Tarea 2: una lista de fallos de integración, o la certeza de que no los hay.

- [ ] **Paso 1: Todas las suites automáticas**

```bash
for f in tests/test_pdf_*.mjs tests/test_tts_*.mjs; do
  echo "### $f"
  node "$f" >/tmp/o.txt 2>&1 && echo "  verde" || { echo "  ROJA"; tail -20 /tmp/o.txt; }
done
python -m pytest backend/tests -q
```
Esperado: **todas verdes**. Anota cuáles fallan, si alguna.

- [ ] **Paso 2: La prueba del libro real**

```bash
JG_PDF_REAL=tests/private/becoming.pdf node tests/test_pdf_reales.mjs; echo "salida=$?"
```
Esperado: se ejecuta de verdad (no `n.toHex is not a function`) y su salida refleja el estado. Si el
Agente 3 dejó cortes pendientes documentados, `salida=1` es un resultado conocido: compruébalo contra
lo que ese agente escribió en `CAMBIOS_PDF.md` y en su informe.

- [ ] **Paso 3: La geometría en las seis pantallas**

```bash
node tests/verificar_pdf_geometria.mjs; echo "salida=$?"
node tests/verificar_pdf_navegador.mjs
```
Esperado: `salida=0` y sin FALLO.

- [ ] **Paso 4: Las siete comprobaciones a mano (esto no lo cubre ninguna prueba)**

```bash
python -m http.server 8000
```
Con `http://localhost:8000` abierto y un libro cargado (`tests/private/cortes-sintetico.pdf`),
comprueba **una por una** y anota el resultado de cada una:

1. **Tocar un párrafo lo lee desde ahí.** Y no hay ningún botón dentro del texto.
2. **La frase que suena está resaltada** y la página baja sola mientras avanza el audio.
3. **Cambiar el tamaño de letra mientras suena** (hoja «Aa») no descoloca la marca ni la pierde.
4. **Abrir la hoja de Apariencia no tapa la marca** ni deja el fondo con doble desplazamiento.
5. **Desplazarse a mano** hace aparecer «Volver a la lectura»; al pulsarlo, vuelve a la frase que suena.
6. **Cerrar el libro y reabrirlo** devuelve al punto exacto, con el tema y el tamaño elegidos.
7. **Con el móvil emulado a 390 px:** nada se sale de la pantalla, todos los botones se pueden tocar
   con el dedo, y el reproductor sigue accesible con el teclado abierto.

Si alguna falla, **para aquí**: escribe qué falla, en qué paso, y devuélveselo al agente responsable
(1: lectura y voz; 2: interfaz y responsive; 3: cortes). No lo arregles tú: no conoces el contexto con
el que se escribió ese código.

- [ ] **Paso 5: Comprobar que no quedó código muerto de la versión anterior**

```bash
grep -rn "jgLeerTextoPdf\|parteAHtml\|resaltarFraseEnLectura\|pdf-leer-desde" js/ index.html tests/
grep -rn "setInterval" js/pdf/libroVista.js
```
Esperado: **ninguna coincidencia**. Si aparece alguna, es un resto de la implementación vieja: anótalo
y devuélvelo al agente que corresponda.

---

## Tarea 2: Cerrar la versión

**Archivos:**
- Modificar: `sw.js`, `CAMBIOS_PDF.md`, `FICHA_TECNICA.md`, `TRAMPAS.md`

- [ ] **Paso 1: Subir la versión de la caché**

```bash
grep -n "CACHE\|VERSION\|v[0-9]\+" sw.js | head -10
```
Incrementa el número de versión de la caché (la línea que ya cambia en cada entrega). **Sin esto, quien
tenga la app instalada seguirá viendo la versión vieja** aunque el despliegue salga bien: es la trampa
que ya está anotada en `TRAMPAS.md`.

- [ ] **Paso 2: Anotar los cambios**

En `CAMBIOS_PDF.md`, añade la entrada de la versión con:

- **Qué se arregló:** el botón «Leer desde aquí» llamaba a una función inexistente y no hacía nada; la
  vista de lectura no resaltaba ni seguía a la voz; al reabrir un libro la vista empezaba arriba
  aunque el progreso estuviera guardado; la prueba con libro real no podía ejecutarse.
- **Qué se quitó:** hasta 150 botones inyectados en el texto, el `replace` que limpiaba su rastro, el
  desplegable de Apariencia bajo el texto, el `setInterval` de un segundo, el grupo de temas duplicado.
- **Qué se añadió:** `js/pdf/mapaLectura.js`, el gesto de tocar el párrafo, el botón «Desde aquí» para
  teclado, la hoja de Apariencia con los tres temas, la verificación en seis pantallas.
- **Las cifras del libro real** que dejó el Agente 3.

En `FICHA_TECNICA.md`, actualiza la versión del apartado PDF.

En `TRAMPAS.md`, anota cualquier trampa nueva que hayas descubierto verificando (por ejemplo: «medir
un elemento con `hidden` devuelve ceros, y eso hacía que la lectura no siguiera a la voz»).

- [ ] **Paso 3: Confirmar**

```bash
git config user.name "JHONCOD24"
git config user.email "juanloras35@gmail.com"
git add sw.js CAMBIOS_PDF.md FICHA_TECNICA.md TRAMPAS.md
git commit -m "docs(pdf): version del lector legible, escuchable y retomable"
```

---

## Tarea 3: Desplegar y verificar en producción

**Archivos:**
- Modificar: `DOCUMENTACION_DESPLIEGUE.md`

- [ ] **Paso 1: Pedir permiso**

Resume al usuario, en tres líneas: qué cambia, qué se verificó y qué queda pendiente (si algo).
**Espera su confirmación antes de continuar.** Si no responde, no despliegues.

- [ ] **Paso 2: Desplegar**

```bash
npx vercel --prod --yes --scope jhoncod24s-projects
```
Anota el identificador del despliegue (`dpl_…`) que devuelve el comando.

- [ ] **Paso 3: Verificar en el dominio real, no en local**

Abre el dominio de producción (el que figura en `DOCUMENTACION_DESPLIEGUE.md`) **en el teléfono**,
fuerza la recarga de la PWA, abre un libro y repite las cuatro comprobaciones clave:

1. Tocar un párrafo lo lee desde ahí.
2. La frase que suena está resaltada y la página baja sola.
3. Desplazarse a mano ofrece «Volver a la lectura».
4. Cerrar y reabrir mantiene el punto.

Si algo funciona en local pero no en producción, mira primero la caché del navegador y la versión del
`sw.js`: está documentado en `TRAMPAS.md` que la caché del CDN puede mentir en la primera comprobación.

- [ ] **Paso 4: Anotar el despliegue**

En `DOCUMENTACION_DESPLIEGUE.md`, añade el identificador `dpl_…`, la fecha y la versión, siguiendo el
formato de las entradas anteriores.

```bash
git add DOCUMENTACION_DESPLIEGUE.md
git commit -m "docs(pdf): anotar despliegue del lector"
```

---

## Criterio de entrega de este agente

1. Las 13 suites, las de TTS y las de backend en verde, con su salida pegada en el informe.
2. `verificar_pdf_geometria` con `salida=0` en las seis pantallas.
3. Las siete comprobaciones a mano hechas **una por una**, con su resultado anotado.
4. Sin restos de código muerto (`jgLeerTextoPdf`, `parteAHtml`, `resaltarFraseEnLectura`,
   `pdf-leer-desde`, `setInterval` en `libroVista.js`).
5. Versión anotada, `sw.js` subido, despliegue hecho con el autor correcto y verificado en el
   teléfono, con el `dpl_…` documentado.

**Si algo no se cumple, no cierres la versión.** Informa de qué falta y a quién le corresponde
arreglarlo. Cerrar en falso cuesta mucho más que un día más de trabajo.
