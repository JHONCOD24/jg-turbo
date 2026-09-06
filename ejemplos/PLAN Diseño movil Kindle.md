# Diseño móvil del lector PDF · modelo editorial

> **Estado (2026-09-06):** Fase 1 (Vista Página) **implementada y verificada**.
> Fase 2 (Vista Todas las páginas) pendiente. Revisión de este plan tras
> construirlo: lo que se confirmó, lo que se corrigió y por qué.

## Resumen

Modelar el lector PDF **solo en móvil** (≤640 px) con los dos estados de las
capturas de `ejemplos/`:

1. **Página** — lectura limpia, tipografía editorial, controles apartados y un
   pie discreto con lo que queda y el porcentaje.
2. **Todas las páginas** — fondo oscuro, carrusel de páginas, navegación,
   progreso y reproductor.

Tablet y escritorio **no se tocan**. Cada suite lo comprueba en cada corrida:
no es una promesa, es una aserción.

---

## Lo que cambió respecto al plan original, y por qué

### 1. Nada de tolerancias en píxeles contra la captura

El plan pedía «márgenes ±4 px, tipografía ±1 px… respecto a la referencia
escalada». Se retiró: las capturas son de **otro teléfono, a otra densidad y de
otra aplicación**, y el propio plan dice en sus supuestos que no se trata de
copiar otra app. Perseguir esos píxeles es perseguir un fantasma.

**En su lugar se mide lo que decide si un texto se lee bien:**

| Criterio | Objetivo | Medido |
|---|---|---|
| **Medida de línea** | 32-48 caracteres | **34-35** en los cuatro teléfonos |
| Pantalla para el texto | ≥80 % | **82-88 %** |
| Contraste del texto | ≥7:1 | **15,4:1** |
| Desbordamiento horizontal | 0 | 0 |

La medida de línea es **el** número: por debajo de ~32 el ojo salta de renglón
constantemente y por encima de ~48 se pierde al volver. La referencia está
en ~40.

### 2. El justificado depende del idioma, y hay que declararlo

El plan decía «`hyphens:auto` según el idioma». Comprobado en el código:
`#pdfLectura` **no tenía atributo `lang`**, así que un libro en inglés se habría
partido con reglas del español. Y un justificado que no puede partir abre ríos
de blanco: se lee peor que sin justificar.

**Regla implementada:** el artículo declara el idioma detectado del libro, y el
justificado **solo se activa** si es un idioma con patrones de partición
(`es en pt fr de it nl ca gl`). Con cualquier otro se lee alineado a la
izquierda, que es honesto.

### 3. La fuente se auto-aloja y se carga al abrir el lector

El plan proponía Literata (acertado: es la sustituta abierta de Bookerly y la
usa Google Play Libros) y cachearla en el service worker. Faltaban dos cosas:

- **Auto-alojarla.** El service worker no cachea Google Fonts, y la app es una
  PWA que debe abrir un libro sin conexión. Vive en `js/vendor/literata/`, que
  el SW sí guarda.
- **Solo el subconjunto `latin`.** Su rango `U+0000-00FF` ya cubre ñ, tildes y
  signos de apertura. Añadir `latin-ext` sumaba **175 KB para nada**.
- **Cargarla al abrir el lector**, no al arrancar la app. Son 220 KB que no le
  sirven a quien viene a dictar.

Licencia SIL Open Font 1.1, con su aviso en `LICENCIA-OFL.txt`.

### 4. Las miniaturas no hay que inventarlas (fase 2)

El plan proponía virtualizar tres miniaturas. Mejor: **el lector ya son columnas
CSS**, así que una miniatura es *el mismo artículo clonado y escalado* con el
desplazamiento puesto en esa página. Páginas reales, idénticas a lo que se va a
leer, sin duplicar la lógica de paginado ni arriesgarse a que no coincidan.

### 5. Los controles: híbrido, no Kindle completo

Decisión del usuario. La Vista Página queda limpia como la referencia, pero al
tocar aparece **la barra de cuatro destinos que ya existía** (Voz · Apariencia ·
Contenido · Opciones) en vez del cromo de Kindle. Se conserva lo que ya
funcionaba y se gana la lectura limpia.

«Unir palabras», «Revisar cortes» y «Editar» viven en la barra de modo, que
también flota.

---

## Cómo funciona la Vista Página

- **Al abrir un capítulo la pantalla queda limpia.** Solo el texto y su pie.
- **Un toque en el texto trae los controles.** Ese toque no lee: el gesto de
  «leer desde aquí» es el siguiente.
- **Pasar de página los vuelve a apartar**, porque estás leyendo otra vez.
- **Sin temporizadores.** La primera versión los escondía tras 3,2 s sin tocar
  nada: se iban en mitad de un ajuste y volvían impredecible cualquier prueba.
  Lo decide siempre un gesto.

### Dos decisiones que sostienen todo lo demás

**El cromo flota, no ocupa sitio.** Es `position:fixed` por encima del texto.
Eso resuelve un dilema que antes no tenía salida: con los controles en el flujo
había que elegir entre dejar una franja vacía al ocultarlos (si se conservaba su
hueco) o **volver a paginar el capítulo** (si no). Flotando, apartarlos no deja
hueco ni mueve una línea. El precio: mientras están a la vista tapan 49 px
arriba y 79 abajo. Por eso se apartan solos al leer.

**La página cabe un número entero de renglones.** El alto se recorta al múltiplo
del interlineado. Media línea cortada al final delata al instante que no es un
libro. Cuesta hasta un renglón de pantalla y lo vale.

### Tipografía

| | Valor |
|---|---|
| Fuente | Literata (Georgia de respaldo) |
| Tamaño | `clamp(15px, min(--lec-tam, 4.5vw), 24px)` — automático |
| Si la persona elige tamaño | `max(16px, --lec-tam)` — manda ella |
| Interlineado | `--lec-inter` (1,55 por defecto) |
| Márgenes | `clamp(14px, 4.5vw, 30px)` |
| Sangría | 1,25 em desde el segundo párrafo |

**Por qué el tamaño es automático por defecto:** el ancho de la pantalla acota
el tamaño para que la línea no baje de ~32 caracteres. Pero en cuanto se mueve
el control de Apariencia manda la persona, aunque la línea quede corta: **poder
agrandar la letra importa más que la medida ideal.** Con un tope rígido, alguien
con poca vista en un teléfono de 320 px no habría podido agrandar nada.

---

## Fase 2 · Vista Todas las páginas (pendiente)

- Fondo oscuro, carrusel horizontal con la página actual centrada, vecinas
  parcialmente visibles y borde de acento.
- **Miniaturas por clonado del artículo** (ver punto 4), no re-maquetado.
- Cabecera con Volver, Contenido, Buscar, Apariencia y Opciones, conectados a
  las funciones que ya existen. **Ningún icono anunciará algo que no hace.**
- Pie con `Página X de Y`, porcentaje, deslizador y cambio Página/Todas. El
  deslizador mueve el carrusel.
- Reproductor con las acciones reales de JG Turbo.
- Preferencias nuevas: `vistaMovil: "pagina" | "todas"`.
- Sin tocar APIs del servidor, IndexedDB ni la extracción del PDF.

---

## Verificación

`tests/verificar_lectura_movil.mjs` — **32 comprobaciones** en 320, 375, 390 y
430 px, más tablet y escritorio para confirmar que no cambian:

- medida de línea dentro de rango;
- porcentaje de pantalla para el texto;
- la fuente **cargada de verdad** (`document.fonts.check`), no solo declarada;
- el idioma declarado en el artículo;
- contraste calculado sobre los colores reales;
- el pie con minutos y porcentaje;
- **mostrar los controles no remaqueta el texto ni cambia de página.**

Junto a ella, en cada entrega: `verificar_pdf_movil` (43), `verificar_pestanas`
(30), `verificar_movil_pantalla` (60), `verificar_pdf_geometria` (118),
`verificar_pdf_scroll` (39), `verificar_pdf_paginas` (5) y
`verificar_arranque_ligero` (10).

**Lo que ninguna de estas prueba:** cómo se ve en un teléfono físico. Tres veces
en este proyecto el emulador ha dado verde con algo roto en el móvil real (el
gesto táctil, la zona segura, la barra del navegador). La comprobación en un
teléfono de verdad sigue siendo obligatoria antes de dar esto por bueno.

---

## Supuestos

- Se reproduce la **composición y la experiencia** de las referencias, no
  elementos propios de otra aplicación.
- La disposición nueva es el valor inicial del lector en móvil; las
  preferencias manuales siguen mandando.
- Tablet y escritorio no se rediseñan en esta entrega.
