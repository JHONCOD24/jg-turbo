# Plan de mejoramiento — Apartado PDF (móvil)

> **Este documento es un encargo cerrado para un agente ejecutor.**
> Quien lo recibe implementa el plan completo; no necesita conocimiento previo del proyecto.
> Todo lo que hay que leer, correr, evitar y entregar está aquí o enlazado desde aquí.

**Fecha:** 2026-09-06
**Proyecto:** JG Turbo — `C:\Users\juanl\Documents\Proyectos\jg-turbo`
**Alcance:** todo el apartado PDF en teléfono — biblioteca, subir documento, lector, voz y hojas de ajustes.
**Tipo de intervención:** refinamiento. Se conserva identidad, textos y funciones; se corrige la base y se sube el acabado.
**Origen del diagnóstico:** skill `impeccable` (playbook `adapt` + detector mecánico) y skill `superpowers` (brainstorming).

---

# 0. Arranque obligatorio del agente

**Lee esta sección entera antes de abrir un solo archivo.**

## 0.1 Dónde se trabaja

| | Ruta | Estado |
|---|---|---|
| **Tu área de trabajo** | `jg-turbo\.claude\worktrees\pdf-movil` | rama `worktree-pdf-movil` — **aquí trabajas** |
| **Carpeta del usuario** | `jg-turbo` | rama `main`, commit `d684dec` — **no se toca** |

Es un `git worktree`: una carpeta independiente con su propia rama, que comparte historial con el proyecto. Ya está creada, con el `.env` copiado (git no lo versiona) y este plan dentro.

**Verifica que estás en el sitio correcto antes de editar:**

```bash
git branch --show-current      # debe decir: worktree-pdf-movil
```

Si dice `main`, **detente**: estás en la carpeta del usuario.

## 0.2 Reglas absolutas

1. **No despliegues. Nunca.** Ni `vercel`, ni `npx vercel --prod`, ni push a `origin`. Este trabajo se evalúa **en local**. El usuario decide después si se publica; esa decisión no es tuya.
2. **No toques la rama `main`** ni la carpeta principal del proyecto.
3. **No borres ni sobrescribas trabajo existente** sin preguntar.
4. **Commitea en tu rama** a medida que avanzas, para que cada paso sea reversible.
5. **Si algo del plan resulta imposible o equivocado al verlo de cerca, dilo** — no lo implementes a medias ni lo silencies. Este plan se escribió leyendo el código, no ejecutándolo (ver sección 12).

## 0.3 Lectura obligatoria antes de tocar código

Por orden. No es opcional: casi todo error posible en este proyecto ya está documentado.

| Archivo | Por qué |
|---|---|
| `Agents.md` | Reglas del proyecto: stack, despliegue, verificación, coordinación |
| `TRAMPAS.md` | **El más importante.** Errores ya cometidos, con su causa y su regla. La sección 3 de este plan resume los que te afectan, pero léelo completo |
| `CAMBIOS_PDF.md` | Documento maestro del apartado PDF |
| `INFORME_2026-09-05.md` | Estado general si vienes nuevo |
| `CONFIG_PERSISTENTE.md` | Antes de tocar `localStorage` o configuración |

**Decisión que no se revierte:** el texto se extrae **en el navegador** con pdf.js, nunca en el servidor. Vercel rechaza peticiones de más de ~4,5 MB, así que un libro de 30 MB no se puede subir. No es preferencia, es límite de plataforma. El motor vive en `js/vendor/pdfjs/` (v6.3.289), **no en un CDN**, porque la app es PWA y debe abrir un PDF sin conexión.

## 0.4 Cómo mostrar el resultado: local, en móvil

El objetivo de todo este encargo es que **el usuario vea el resultado en su teléfono y decida si se queda o se descarta**. Ofrécele estas tres vías; la 1 es la que de verdad responde la pregunta.

### Vía 1 — Su teléfono real, por la red local (recomendada)

Desde la raíz de tu worktree:

```bash
python -m http.server 8080 --bind 0.0.0.0
```

Y en el teléfono, **conectado al mismo WiFi**, abrir: `http://192.168.80.42:8080`

*(La IP `192.168.80.42` es la de esta máquina al 2026-09-06. Confírmala con `ipconfig`; si cambió, usa la nueva.)*

**Qué funciona así:** toda la interfaz, la biblioteca, subir un PDF, la lectura completa. El PDF se procesa en el navegador, así que el lector funciona de verdad.

**Qué NO funciona sin backend:** lectura en voz alta del servidor, funciones de IA (corregir, pulir, preguntar al documento), transcripción. El service worker tampoco se registra (necesita HTTPS o localhost). **Para juzgar diseño, responsive y comodidad de lectura es suficiente** — que es exactamente lo que se está evaluando.

> ⚠️ **Seguridad:** ese comando publica la carpeta entera en la red local, **incluido el `.env` con las claves API**. Úsalo solo el tiempo de la revisión, en una red de confianza, y **deténlo con Ctrl+C al terminar**. Nunca lo dejes corriendo.

### Vía 2 — App completa en el PC, emulando teléfono

```bash
iniciar_server.bat
```

Levanta uvicorn en `http://localhost:8000` (o 8001 si está ocupado) y abre el navegador. Luego, DevTools → modo dispositivo → iPhone/Android.

**Importante:** nunca abras `index.html` como archivo suelto (`file://`); el proyecto lo prohíbe expresamente. Tiene que ser por `http://localhost`.

Ventaja: todo funciona, backend incluido. Límite: es emulación, no un teléfono.

### Vía 3 — Capturas automáticas

Las suites de Playwright del proyecto ya miden en tamaños de teléfono. Genera capturas antes/después en 360, 390 y 430 px, en los tres temas (Papel, Sepia, Noche), y entrégaselas al usuario junto con la vía 1.

**El emulador no reemplaza al teléfono.** El propio `TRAMPAS.md` lo advierte: quién desplaza la pantalla, el teclado abierto y la barra del navegador que aparece y desaparece **no se reproducen en un emulador**.

## 0.5 Pruebas obligatorias

Este proyecto tiene 47 suites. Estas son las que **debes** correr, por lo que toca este plan:

| Cuándo | Comando | Referencia |
|---|---|---|
| Siempre, al final | las 16 unitarias de PDF (lista en `Agents.md`) | ~1.120 comprobaciones OK, 0 fallos |
| Al tocar el lector en móvil | `node tests/verificar_pdf_movil.mjs` | 27 |
| Al tocar tamaños o toques | `node tests/verificar_pdf_geometria.mjs` | 54 — **falla si un control mide menos de 44 px** |
| Al tocar alturas o scroll | `node tests/verificar_pdf_scroll.mjs` | 39 |
| Al tocar alturas, scroll o zona segura | `node tests/verificar_movil_pantalla.mjs` | 62 |
| Al tocar lo que se carga al arrancar | `node tests/verificar_arranque_ligero.mjs` | 7 |
| Recorrido funcional del lector | `node tests/verificar_pdf_navegador.mjs` | 116 |

> **Regla del proyecto que no puedes saltarte:** no basta con que no aparezca `FALLO:`. **Cuenta las comprobaciones.** Si salen menos que la referencia, la prueba se cortó y no probó nada. Está documentado en `TRAMPAS.md` §1.2 y ya pasó.

Añade también el detector de diseño, antes y después de cada fase:

```bash
"C:/Users/juanl/Documents/Proyectos/Skills/impeccable/scripts/impeccable" detect --json index.html
```

Línea base al 2026-09-06: **143 hallazgos**. Debe bajar, nunca subir.

## 0.6 Cómo entregar para la decisión

Al terminar cada fase:

1. Commit en `worktree-pdf-movil` con mensaje claro.
2. Pruebas obligatorias de esa fase, **con el número de comprobaciones**.
3. Detector: hallazgos antes → después.
4. Capturas móviles antes/después.
5. Avisar al usuario para que mire en su teléfono por la vía 1.

Al terminar todo, presenta las **dos salidas** de forma explícita:

- **Se queda:** integrar `worktree-pdf-movil` en `main`. El despliegue lo decide y lo ordena el usuario, en otro momento.
- **Se descarta:** borrar la copia. La carpeta principal nunca se movió, así que no hay nada que deshacer.

---

# 1. Qué reportó el usuario

1. Los botones son difíciles de tocar.
2. Se ve apretado y desordenado.
3. Se pierde entre tantas opciones.
4. Se ve simple, sin gracia.
5. **Se bloquea al entrar a la pestaña PDF y al traer un documento; se demora cargando.**
6. **Al recargar la ventana (F5), la aplicación lo expulsa de la pestaña y lo devuelve al inicio.**

## Decisiones ya tomadas con el usuario (no volver a preguntarlas)

| Decisión | Elección |
|---|---|
| Alcance | Todo el apartado PDF |
| Ambición | Refinar, **no** rediseñar desde cero |
| Escena de uso | Leer y escuchar por igual |
| Enfoque | Cimientos primero, luego zona por zona |
| Controles del lector | Barra inferior al alcance del pulgar |
| Limpieza visual | Quitar efectismo, recuperar presencia con jerarquía real |
| Dirección visual | Estilo Kindle / apps de lectura profesionales |

---

# 2. Diagnóstico medido

Todas las cifras salen de medir el código, no de estimaciones.

## 2.1 El sistema de diseño existe, pero está desconectado

Hay 52 variables de diseño definidas, incluida una escala de texto fluida (`--fs-xs` … `--fs-2xl`, con `clamp()`) y una de espaciado (`--space-1` … `--space-5`). Casi nadie las usa:

| Token definido | Usos reales |
|---|---|
| `--fs-md`, `--fs-lg` | 1 uso cada uno |
| `--h-ctrl` (altura de control) | 1 uso — y su valor es `40px` |
| `--space-2`, `--space-3` | 0 usos |
| `font-size` en píxeles sueltos | **290** |
| `font-size` usando token | 29 |

**Conclusión:** el 91% del CSS escribe medidas a mano; por eso se contradicen. **No inventes un sistema nuevo: conecta el que ya está y súbele los pisos.**

## 2.2 Veinte breakpoints peleando

99 media queries en ~20 puntos de corte: 380, 400, 480, 520, 559, 560, 640, 641, 700, 701, 767, 768, 900, 960, 1023, 1024 px…

Sobre las **761 reglas CSS** del apartado PDF, `.btn` y `.mini-btn` se redefinen con alturas que se pisan: 48 / 44 / 42 / 40 / 38 / 36 / 34 px.

**Causa de fondo:** cada corrección móvil anterior añadió un breakpoint nuevo en vez de arreglar el que fallaba.

## 2.3 Controles bajo el mínimo táctil

**17 controles del PDF miden menos de 44 px de alto.**

| Control | Alto |
|---|---|
| `.pdf-reanudar .mini-btn` | 34 px |
| `.pdf-libro-menu-pop .mini-btn`, `.pdf-unir-aviso .mini-btn`, `.pdf-vm-ajustes`, `.pdf-pulido-opcion`, `.pdf-trad-opcion`, `.pdf-tema-opcion` | 36 px |
| `#pdfDrop .drop-action` | 38 px |
| `.pdf-filtro`, `.pdf-doc-acciones .mini-btn`, `.pdf-nube-pase-acciones .mini-btn`, `.pdf-dock-nav .tts-rate-control` | 40 px |
| `.pdf-biblioteca-buscar input`, `.pdf-dock-nav .tts-console .tts-voice-select` | 42 px |

## 2.4 Texto diminuto

**73 reglas por debajo de 14 px** solo en el PDF: 3 de 10 px, 5 de 11 px, 5 de 11,5 px, 25 de 12 px, 12 de 12,5 px, 18 de 13 px, 5 de 13,5 px.

El token `--fs-xs` es `clamp(10.5px, …, 11.5px)`: **el piso de la escala ya es ilegible**.

Detector: 28 casos de `tiny-text`, 26 de `undersized-ui-text` (etiquetas de 9 y 10 px).

## 2.5 Demasiadas opciones a la vez

**135 controles interactivos** (108 botones, 11 campos, 11 desplegables) con solo **5 bloques plegables**.

## 2.6 Efectismo en lugar de jerarquía

Detector, 143 hallazgos totales:

| Hallazgo | Cantidad |
|---|---|
| Halos de color (`dark-glow`) | 31 |
| Relleno insuficiente | 14 |
| Tarjetas dentro de tarjetas | 8 |
| Contenedores que recortan hijos posicionados | 6 |
| Contraste bajo 4,5:1 | 6 (uno de 1,0:1 — invisible) |
| Texto con degradado | 2 |
| Punto parpadeante (error) | 2 |
| Jerarquía tipográfica plana | 1 |

Los 6 que recortan son `html`, `body`, `main.wrap`, `section.panel` y `div.card`. **Crítico en móvil**: recortan justo lo que necesita salirse — hojas, barra flotante, menús.

## 2.7 Por qué se bloquea

**a)** `index.html` pesa **812 KB**, con 226 KB de CSS incrustado. Se descarga y analiza entero antes de pintar.

**b)** Entrar a la pestaña PDF descarga **685 KB de JavaScript de golpe**. El código lo confiesa: antes se cargaban al arrancar (553 KB para todos) y se movieron a "al abrir la pestaña". **Se cambió un problema por otro.** Solo `pdfController.js` pesa 232 KB.

**c)** Traer un PDF descarga el motor: **458 KB + 1,26 MB del trabajador**. (Las copias `legacy` no cuentan: `.vercelignore` ya las excluye del despliegue.)

**d)** El service worker **no cachea nada de esto**: solo `/`, `/index.html` y `/manifest.webmanifest`. Cada sesión nueva vuelve a bajarlo por red.

**e) Ningún módulo cede el hilo principal.** Cero usos de `requestIdleCallback` o `scheduler.yield` en los 15 módulos de `js/pdf/`. pdf.js sí usa su trabajador, pero el post-procesado propio —reconstrucción, átomos, límites, léxico, limpieza— corre en el hilo principal sin soltarlo. **Mientras tanto la interfaz está congelada.**

## 2.8 Por qué el F5 expulsa

Causa exacta, en `index.html`:

```js
const params = new URLSearchParams(location.search);
const tab = params.get('tab');
const TABS_VALIDAS = new Set(['mic','file','yt','pdf','trans']);
if(TABS_VALIDAS.has(tab) || ...){
  setTimeout(() => activarTab(TABS_VALIDAS.has(tab) ? tab : 'file'), 0);
}
```

La pestaña **solo se restaura si viene en la dirección** (`?tab=pdf`). La app nunca la escribe ahí ni la guarda. Al recargar no hay nada que leer y cae en la pestaña por omisión.

**La posición de lectura sí se guarda** (`guardarProgreso` en `js/pdf/biblioteca.js`, IndexedDB). Falta recordar *dónde estaba el usuario en la app*, no *por dónde iba leyendo*.

---

# 3. Trampas del proyecto que afectan a este plan

**Esta sección corrige el plan.** Cada punto nace de un bug real ya cometido y documentado en `TRAMPAS.md`. Ignorarlos es repetir un error conocido.

## 3.1 El cromo no puede salir del flujo (afecta a la Fase D)

> **Síntoma (v2.41):** en el teléfono pulsabas «página siguiente» y volvías al principio del capítulo. **Causa:** la lectura inmersiva sacaba la cabecera y la barra del flujo con `display:none`, el texto crecía y había que repartir las páginas otra vez.

**Regla:** en un lector paginado, mostrar u ocultar cromo **no puede cambiar el tamaño del área de texto**. Se **reserva el hueco siempre** y solo se desvanece con `opacity`. Se gana menos alto, y a cambio la lectura no se mueve. Hay una prueba que vigila que el total de páginas no cambie.

➡️ **La barra inferior que se autooculta debe implementarse con `opacity`/`visibility`, nunca con `display:none` ni sacándola del flujo.**

## 3.2 Un control que se oculta se lleva el foco al `<body>`

> **Síntoma (v2.41):** al cerrar la hoja de Apariencia en el teléfono, el foco se perdía, porque se devolvía a un botón que en móvil está oculto.

**Regla:** al devolver el foco, buscar el primer candidato **visible** (`offsetParent !== null`), nunca uno fijo.

➡️ Aplica a todas las hojas y a la barra que se oculta.

## 3.3 En el teléfono desplaza el documento, no un cajón interno

> **Síntoma:** «queda un hueco abajo» y «la parte de arriba está cortada». **Causa:** `html,body{height:100%}` con `.wrap` desplazando por dentro. Un navegador móvil solo retrae su barra de direcciones cuando desplaza el **documento**.

**Regla:** en el teléfono desplaza el documento. Un alto fijo con cajón interno solo se justifica en pantallas que NO se desplazan (el lector paginado, la pantalla completa), y se acota con `:not()` a esos estados. **No se ve en un emulador:** hay que medir quién desplaza.

➡️ Corrige la idea de "un solo contenedor con desplazamiento": vale **solo** para el lector paginado. La biblioteca desplaza el documento.

## 3.4 `100dvh` no basta

> **Síntoma (v2.43):** borde superior cortado y franja inferior tras mover la barra del navegador.

**Regla:** sincronizar el alto con `visualViewport.height`, reservar zonas seguras y conservar un ancla de carácter antes de repartir de nuevo.

## 3.5 Un solo modelo de eventos

> **Síntoma (v2.43):** deslizar parecía bloqueado o saltaba errático, porque se registraban `touchend` y `pointerup` para la misma acción y un teléfono real dispara los dos.

**Regla:** un solo modelo de eventos, alternativa con botones, y comprobar el incremento exacto `+1/-1`.

➡️ Aplica al "toque en el centro para alternar controles" y a la precarga por `pointerdown`.

## 3.6 `import()` al arrancar no es carga diferida — y hay tensión con la Fase B

> **Síntoma (auditado 2026-09-05):** la app tardaba en abrir; el lector de PDF se traía con `import()` dinámico, pero la llamada estaba en el arranque: 553 KB para todo el mundo.

**Regla:** `import()` difiere la descarga al momento en que se **llama**, no por ser dinámico.

➡️ **Atención, conflicto real:** la Fase B propone *precarga ociosa* de los módulos del PDF. Eso puede chocar con `verificar_arranque_ligero.mjs`, que existe justamente para garantizar que "el lector de PDF no viaje con quien solo abre la app". **Resolución:** implementa primero la precarga por intención (§4.2.1), mide, y **solo** añade la precarga ociosa si `verificar_arranque_ligero.mjs` sigue en verde con sus 7 comprobaciones. Si entra en conflicto, la prueba gana y la precarga ociosa se descarta.

## 3.7 Otras trampas a revisar antes de tocar

`viewport-fit=cover` sin zona segura arriba corta el encabezado · Una hoja puede estar visible y no recibir ningún toque · Un aviso flotante que no recibe toques también tapa · Ningún aviso transitorio vive en el flujo del lector · Un selector con identificador le gana a `hidden`.

---

# 4. Las fases

Se ejecutan en el orden A → E. Cada una se termina, se verifica y se commitea antes de empezar la siguiente. **Nada de un cambio gigante de una sola vez.**

## Fase A — Que recargar no expulse

Ataca el síntoma 6. Cambio pequeño, efecto grande en la confianza. **Se hace primero porque se verifica en un minuto.**

### Qué debe recordar la app

| Dato | Dónde | Por qué ahí |
|---|---|---|
| Pestaña activa | Dirección (`?tab=pdf`) + `localStorage` de respaldo | La dirección hace que atrás/adelante funcionen y que el enlace se pueda compartir |
| Documento abierto | `localStorage` | Estado local del aparato; no debe viajar en un enlace |
| Vista dentro del PDF (biblioteca o lector) | `localStorage` | Igual |
| Posición de lectura | Ya funciona (IndexedDB) | Sin cambios |

### Cómo

1. Al cambiar de pestaña, `activarTab()` actualiza la dirección con **`history.replaceState`** — nunca `pushState`: el botón atrás debe seguir significando "atrás", no "deshacer mi último toque".
2. Al arrancar: primero la dirección; si no trae nada, `localStorage`; si tampoco, la pestaña por omisión actual.
3. Si estaba leyendo, vuelve al lector, a ese documento y a su posición guardada.
4. El botón atrás del teléfono sigue significando "salir del lector a la biblioteca", nunca "cerrar la app de golpe".

### Casos límite

- Documento borrado entre sesiones → a la biblioteca con aviso claro, nunca pantalla rota.
- Enlace con `?tab=pdf` → la dirección manda sobre lo guardado.
- Modo incógnito o almacenamiento bloqueado → falla en silencio al comportamiento actual; **nunca romper el arranque**.
- Documento a medio procesar al recargar → volver al estado anterior a esa carga, con aviso.

**Antes de tocar `localStorage`, lee `CONFIG_PERSISTENTE.md`.** Las claves `jg_*` no se renombran sin migración.

**Aceptación:** F5 en cualquier punto del apartado PDF, en teléfono y escritorio, deja al usuario donde estaba.

---

## Fase B — Fluidez y rapidez

Ataca el síntoma 5.

### B.0 Medir antes de tocar (obligatorio)

En un teléfono real, con red 4G simulada: tiempo de respuesta al tocar la pestaña, tiempo hasta la primera página, y tareas de más de 50 ms durante la extracción.

`[DATO PENDIENTE]` — sin línea base no se puede afirmar que algo mejoró. **Ninguna cifra de mejora se da por buena sin medición antes/después.**

### B.1 Entrar a la pestaña debe ser instantáneo

1. **Precarga por intención:** empezar a traer los módulos al `pointerdown` sobre la pestaña, antes de que el dedo se levante (100–300 ms gratis). Respeta §3.5: un solo modelo de eventos.
2. **Precarga ociosa:** solo si el navegador está inactivo (`requestIdleCallback`) y la conexión no es limitada (`navigator.connection.saveData`). **Sujeta a §3.6: si `verificar_arranque_ligero.mjs` baja de 7 comprobaciones, se descarta.**
3. **Pintar la pestaña de inmediato** aunque el motor no esté: biblioteca e interfaz al instante, y esqueleto de carga para lo que falte. Nunca pantalla en blanco ni congelada.

**Aceptación:** la pestaña responde visualmente en menos de 100 ms desde el toque, siempre.

### B.2 Partir `pdfController.js`

| Se carga al entrar | Se carga bajo demanda |
|---|---|
| Biblioteca, "Seguir leyendo", subir | Comparar con el original |
| Lector y navegación | OCR (y Tesseract) |
| Voz básica | Nube y sincronización |
| | Exportar |
| | Preguntar al documento |

**Aceptación:** lo que se descarga al entrar baja de 250 KB. `[DATO PENDIENTE]` cifra exacta al hacer el corte.

### B.3 Cachear lo descargado

*Stale-while-revalidate* para `/js/pdf/*` y `/js/vendor/pdfjs/*` en el service worker. La versión ya viaja en la dirección (`?v=JG_JS_V`), así que invalidar es seguro.

⚠️ `TRAMPAS.md` avisa: **redesplegar sin subir `JG_JS_V` deja el módulo viejo en la caché**. Si tocas módulos, sube la versión.

**Aceptación:** la segunda visita a la pestaña no toca la red para el código.

### B.4 Peso muerto: ya resuelto

Las copias `legacy` de pdf.js **ya están excluidas del despliegue** por `.vercelignore`. No hay nada que optimizar. Única verificación: que ninguna ruta las pida en tiempo de ejecución.

### B.5 Que la interfaz nunca se congele

1. **Ceder el hilo entre páginas:** tras procesar cada página, devolver el control al navegador (`scheduler.yield()`, o `await new Promise(r => setTimeout(r, 0))` como respaldo). El usuario debe poder desplazarse y cancelar mientras trabaja.
2. **Mover el trabajo pesado a un Web Worker propio:** reconstrucción, átomos y límites no tocan el DOM. Es el mayor impacto y el mayor esfuerzo — **evalúalo solo después** de aplicar el punto 1 y medir.
3. **Progreso honesto:** en vez de la barra indeterminada en bucle que marcó el detector, mostrar "Página 12 de 240" con cancelar siempre activo.

**Aceptación:** con un PDF de 200+ páginas, la pantalla se desplaza con el dedo sin trabarse y cancelar responde.

### B.6 Adelgazar `index.html` — al final de todo

Extraer el CSS a archivo aparte con caché larga (dejando incrustado solo lo de la primera pantalla) y mover el JS de cada pestaña a su módulo, como ya se hizo con PDF y YouTube.

Beneficia a **toda la app**. Va al final por ser la de mayor superficie de riesgo.

---

## Fase C — Cimientos responsive

### C.1 Subir los pisos de los tokens

| Token | Hoy | Propuesto | Por qué |
|---|---|---|---|
| `--fs-xs` | `clamp(10.5px, …, 11.5px)` | piso 12 px | 10,5 px es ilegible en teléfono |
| `--fs-sm` | `clamp(11.5px, …, 12.5px)` | piso 13 px | Etiquetas y metadatos |
| `--fs-md` | `clamp(13px, …, 14.5px)` | piso 15 px | Texto de interfaz |
| `--h-ctrl` | `40px` | `44px` | Mínimo táctil |
| — | — | `--h-ctrl-lg: 52px` (nuevo) | Acciones principales del lector |
| — | — | `--medida-lectura: 66ch` (nuevo) | Ancho de la columna de texto |

### C.2 De veinte breakpoints a tres

| Nombre | Rango | Uso |
|---|---|---|
| Teléfono | hasta 640 px | Base — se escribe primero |
| Tableta | 641–1023 px | Columna más ancha, sin índice lateral |
| Escritorio | 1024 px+ | Índice y lectura simultáneos |

Más `@media (pointer: coarse)` para todo lo táctil: **el tamaño de pantalla no dice si hay un dedo o un ratón**. Un portátil táctil necesita botones grandes igual que un teléfono.

Cada breakpoint sobrante se reasigna al más cercano y se elimina, **en lotes revisables**.

### C.3 Reemplazar píxeles sueltos por tokens

Barrido de las 761 reglas del PDF, por zona, con captura antes/después de cada lote.

**Aceptación:** cero controles bajo 44 px (lo verifica `verificar_pdf_geometria.mjs`), cero texto bajo 12 px, y el detector deja de reportar `tiny-text` y `undersized-ui-text` en esta zona.

---

## Fase D — Zona por zona

### D.1 Biblioteca

Hoy compiten 8 controles: 4 filtros + buscador + orden + 2 vistas.

- En teléfono quedan **buscador + un botón "Filtrar y ordenar"** que abre una hoja con el resto, mostrando cuántos filtros hay activos.
- **"Seguir leyendo" pasa a ser la pieza dominante**: portada, título, progreso y botón grande. Es lo que la persona quiere la mayoría de las veces.
- Rejilla fluida `repeat(auto-fill, minmax(140px, 1fr))` en lugar de saltos por breakpoint.
- Portadas con proporción fija, para que la rejilla no salte mientras cargan.
- Progreso de lectura en la tarjeta; corrección y sincronización pasan al detalle.
- **La biblioteca desplaza el documento** (§3.3).

### D.2 Subir un documento

- En un teléfono no se arrastra un archivo: el bloque se vuelve **un botón grande e inequívoco** (su acción mide hoy 38 px).
- Las opciones siguen plegadas, con el resumen de lo elegido a la vista.
- Los errores aparecen junto al documento afectado, con la acción de recuperación al lado.

### D.3 El lector — el corazón

```
┌─────────────────────────────┐
│ (cabecera, hueco reservado) │  ← título + volver + índice
├─────────────────────────────┤
│                             │
│      columna de texto       │  ← 66ch, 18–19px
│      sin bordes ni tarjetas │     fondo continuo de papel
│                             │
├─────────────────────────────┤
│ cap. 4 · 38% · 12 min       │  ← pie discreto
│ [◀] [▶▶ escuchar] [▶] [Aa]  │  ← barra al alcance del pulgar
└─────────────────────────────┘
```

- **Un toque en el centro** alterna cabecera y barra. Con **un solo modelo de eventos** (§3.5).
- **El cromo se desvanece con `opacity`; el hueco se reserva siempre** (§3.1). Nunca `display:none`.
- **Al ocultar, el foco va al primer candidato visible** (§3.2).
- **Alto sincronizado con `visualViewport.height`**, no solo `dvh` (§3.4).
- La barra respeta `env(safe-area-inset-bottom)`.
- **Hojas** (`Apariencia`, `Cortes`, `Comparar`): suben desde abajo, se cierran con Escape, gesto o tocando fuera, **atrapan el foco** y lo devuelven al abrir.
- **Arreglar los 6 contenedores que recortan** (`html`, `body`, `main.wrap`, `section.panel`, `div.card`): impiden que una hoja o barra flotante se vea completa.
- **Alternativa accesible al doble toque**: botón "Leer desde aquí".
- **"Volver a la lectura"** cuando el usuario se desplaza a mano mientras escucha.

### D.4 Voz

La consola vive en el dock con controles de 40 px y contenido pegado al borde.

| Primarios — barra inferior | Secundarios — hoja |
|---|---|
| Reproducir / pausar (52 px) | Elegir voz |
| Frase anterior / siguiente | Velocidad |
| | Descargar MP3 |
| | Temporizador |
| | Opciones avanzadas |

Cambiar entre leer y escuchar a un toque. La frase que se escucha se resalta **dentro del texto real**, sin duplicar contenido superpuesto.

---

## Fase E — Limpieza visual

| Qué se quita | Cuántos | Con qué se reemplaza |
|---|---|---|
| Halos de color | 31 | Elevación neutra y contraste real |
| Tarjetas dentro de tarjetas | 8 | Espacio, tipografía y separadores |
| Texto con degradado | 2 | Color sólido |
| Punto parpadeante | 2 | Indicador estático con etiqueta |
| Barra indeterminada en bucle | 1 | "Página 12 de 240" |

- **Contraste:** corregir los 6 casos bajo 4,5:1, empezando por el de 1,0:1 (`#062b25` sobre `#1c2230`).
- **Estados táctiles:** hay 68 reglas `:hover` y solo 2 consultas `@media (hover)`. En un teléfono el hover no existe: cada estado necesita su `:active`.
- **Jerarquía tipográfica:** con los tokens ya conectados, ampliar el contraste entre título, subtítulo y cuerpo.
- **Encabezados:** corregir el salto de `h3` a `h5` (rompe la navegación por lector de pantalla).

### Qué significa "estilo Kindle" aquí

No es copiar una marca: es adoptar decisiones ya comprobadas.

1. **El texto manda; la interfaz desaparece.** Nada compite con las palabras: ni tarjetas, ni bordes, ni sombras alrededor del texto.
2. **Un toque en el centro alterna los controles.**
3. **Superficie de papel, no de aplicación.** Fondo continuo, sin contenedores anidados. Papel, Sepia y Noche ya existen: se refuerzan.
4. **Medida de línea de 60–70 caracteres.**
5. **Progreso discreto y útil** en el pie: capítulo, porcentaje, páginas restantes.
6. **Cero animación decorativa.** El movimiento se reserva para lo que cambia.
7. **Todo lo secundario vive en hojas**, no en menús desplegables ni en la pantalla principal.

---

# 5. Qué NO se toca

- La lógica de extracción, reconstrucción y corrección del texto (funciona y tiene pruebas).
- Los textos e instrucciones actuales del producto.
- Las funciones existentes: nube, OCR, comparar, exportar, preguntar al documento.
- Los tres temas de lectura.
- El escritorio y la tableta, salvo lo que mejore de rebote. `verificar_pdf_movil.mjs` comprueba justamente que **no cambien**.
- La rama `main` y la carpeta principal del proyecto.

---

# 6. Orden de ejecución y riesgo

| Orden | Fase | Riesgo | Por qué aquí |
|---|---|---|---|
| 1 | A — Continuidad (F5) | Bajo | Pequeña, se verifica en minutos |
| 2 | B.1–B.4 — Carga y caché | Bajo-medio | El síntoma más molesto, sin tocar apariencia |
| 3 | B.5 — No congelar | Medio | Toca el procesamiento; hay pruebas que lo respaldan |
| 4 | C — Cimientos responsive | Medio | Superficie amplia; por lotes con capturas |
| 5 | D — Zonas | Medio | Zona por zona, verificando entre cada una |
| 6 | E — Limpieza visual | Bajo | Cierre estético sobre base sana |
| 7 | B.6 — Adelgazar `index.html` | Alto | Mayor superficie de riesgo; al final, con todo estable |

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Tocar tokens mueve el escritorio | Capturas antes/después + `verificar_pdf_movil.mjs` (comprueba que tablet y escritorio no cambien) |
| Partir `pdfController.js` rompe dependencias | Cortes guiados por los imports reales; pruebas entre cortes |
| La precarga ociosa revierte el arranque ligero | `verificar_arranque_ligero.mjs` manda (§3.6) |
| El worker propio complica la depuración | Solo si ceder el hilo no basta |
| La caché sirve código viejo | Subir `JG_JS_V` al tocar módulos |
| Persistir la pestaña rompe el botón atrás | `replaceState`, nunca `pushState` |
| Ocultar el cromo deshace el salto de página | Reservar hueco + `opacity` (§3.1); la prueba vigila el total de páginas |

---

# 7. Criterios de aceptación del encargo

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | La pestaña PDF responde en menos de 100 ms | Medición en teléfono real |
| 2 | La interfaz nunca se congela al cargar un PDF | Se desplaza y se cancela durante todo el proceso |
| 3 | F5 deja al usuario donde estaba | Manual, en los 4 estados |
| 4 | Cero controles bajo 44 px | `verificar_pdf_geometria.mjs` |
| 5 | Cero texto bajo 12 px | Detector |
| 6 | Cero hallazgos de contraste | Detector |
| 7 | Tres breakpoints, no veinte | Conteo en el CSS |
| 8 | Tablet y escritorio intactos | `verificar_pdf_movil.mjs` |
| 9 | Las 16 unitarias siguen en ~1.120 comprobaciones | Contarlas, no solo mirar que no falle |
| 10 | El lector se siente una app de lectura | El usuario, en su teléfono, por la vía 1 |

---

# 8. Datos pendientes

- `[DATO PENDIENTE]` Línea base de rendimiento en el teléfono del usuario: entrada a la pestaña, tiempo hasta la primera página, tareas largas.
- `[DATO PENDIENTE]` Modelo de teléfono y navegador de referencia.
- `[DATO PENDIENTE]` Peso exacto del corte de `pdfController.js`.
- `[DATO PENDIENTE]` Confirmar la IP local antes de cada sesión de revisión móvil (`ipconfig`).

---

# 9. Nota de método y honestidad

Este diagnóstico se construyó **leyendo y midiendo el código** y ejecutando el detector mecánico de Impeccable. **No incluye inspección visual en navegador**: no se levantó el servidor ni se tomaron capturas de la app en marcha.

➡️ **Por eso la primera tarea del agente ejecutor, antes de tocar nada, es levantar la vista previa (§0.4) y confirmar visualmente cada punto de la sección 2.** Si algo no coincide con lo descrito aquí, **el código manda y este documento se corrige**.

El proyecto no tiene `PRODUCT.md` ni `DESIGN.md`. No bloquea el trabajo (el código vigente es la autoridad visual), pero conviene ejecutar `impeccable init` después, para que las próximas sesiones no deduzcan todo desde cero.
