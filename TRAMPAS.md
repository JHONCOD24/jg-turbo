# Trampas de JG Turbo · errores ya cometidos que no deben repetirse

## El rescate que se rompe tapa el error original

**Síntoma (v2.46):** «Unir palabras» moría en silencio total. **Causa:** el
`catch` que debía revertir destructuraba un campo inexistente (`{lim}` de
`{id,copia}`) y lanzaba OTRO error, saltándose el aviso. **Regla:** el código
de rescate se prueba provocando el fallo; y se resuelve por id contra los
objetos vivos, nunca por referencia guardada.

## Una edición manual no puede tumbar lo automático para siempre

**Síntoma (v2.46):** con una sola edición, Unir moría, la etapa 1 fallaba
siempre y «Reanudar» quedaba eterno. **Causa:** `reconstruirTrasDecision`
lanzaba si había ediciones aprobadas. **Regla:** la edición aprobada se
conserva SOBRE lo recompuesto (como ya hacía el cierre de la corrección);
lo manual manda en su capítulo, lo automático sigue en el resto.

## Ningún aviso transitorio vive en el flujo del lector

**Síntoma (v2.46):** reabrir no retomaba (19 páginas contra 17 con la misma
letra). **Causa:** el aviso del dock medía dentro de la columna: con aviso
había 19 páginas, sin aviso 17, y la posición guardada caía en otra página.
**Regla:** los avisos flotan (`fixed`, sin toques si no tienen botones); la
paginación solo mide cromo permanente. Ojo: `transform:none` de una animación
mata el `translateX(-50%)`: centrar con la propiedad `translate`.

## Un blanco de fin de renglón no es prueba de espacio

**Síntoma (v2.45):** «Unir palabras» no unía «to»+«ma» aunque el léxico sabía
que es «toma». **Causa:** el extractor daba por espacio cualquier límite con
blanco residual, sin consultar al léxico; el botón solo veía pendientes y ese
límite nunca lo fue. **Regla:** al cambiar de renglón/página/columna con
blanco residual, el léxico opina con la regla de siempre; solo 'join' une y
jamás queda pendiente (no se infla «Revisar cortes» ni la etapa 1).

## Un botón que falla en silencio es un botón roto

**Síntoma (v2.45):** «Reanudar corrección» a veces no hacía nada. **Causa:**
permiso caído con `return` silencioso y un `.catch(()=>{})` que tragaba el
error real. **Regla:** todo camino de un botón termina en aviso visible o en
acción; prohibidos los `catch` vacíos en acciones del usuario.

## Una etapa de N peticiones en serie debe contar sus lotes

**Síntoma (v2.45):** «Etapa 1 de 3» clavada y parecía colgada. **Causa:** N
lotes secuenciales de hasta 90 s actualizando una etiqueta estática.
**Regla:** progreso por lote (`lote X de Y · N resueltos`) y pre-chequeo de IA
antes de arrancar, con mensaje claro en vez de colgar la etiqueta.

## Una selección vieja no puede bloquear los gestos para siempre

**Síntoma (v2.45):** tras seleccionar texto, los deslizamientos morían siempre.
**Causa:** el guardián de «está seleccionando» no distinguía seleccionar AHORA
de una selección de hace un minuto. **Regla:** el guardián lleva ventana de
tiempo (~800 ms desde el último `selectionchange` dentro de la lectura).

## Un teléfono puede emitir Touch Events y Pointer Events por el mismo gesto

**Síntoma (v2.43):** deslizar parecía bloqueado o saltaba de forma errática.
**Causa:** el lector registraba `touchend` y `pointerup` para la misma acción;
un dispositivo real puede ejecutar los dos. La prueba solo comprobaba que la
página cambiara, así que dos saltos también pasaban. **Regla:** un solo modelo
de eventos, alternativa con botones y comprobar el incremento exacto `+1/-1`.

## Desconocido no significa que falta una clave

**Síntoma (v2.43):** el teléfono pedía configurar Groq aunque Vercel ya tenía
`GROQ_API_KEY`. **Causa:** `serverInfo` empezaba en `false` y la interfaz lo
presentaba antes de que `/health` respondiera. **Regla:** modelar el estado
«aún no comprobado», no bloquear por él y conservar la última respuesta válida
ante un timeout móvil.

## `100dvh` no siempre sigue la ventana visible de un WebView

**Síntoma (v2.43):** borde superior cortado y franja inferior después de mover
la barra del navegador. **Causa:** el lector fijo confiaba solo en `100dvh`.
**Regla:** sincronizar el alto con `visualViewport.height`, reservar las zonas
seguras y conservar un ancla de carácter antes de repartir de nuevo.

## Una pantalla fija hereda el desplazamiento del documento

**Síntoma (v2.43):** la cabecera medía correctamente, pero no aparecía en la
captura: estaba por encima del viewport. **Causa:** al pulsar Leer, el navegador
había desplazado el documento hasta el selector; añadir `jg-leyendo` lo hacía
fijo sin devolver `scrollY` a cero. **Regla:** guardar el scroll de la biblioteca,
entrar al lector en cero y restaurarlo al salir. Medir también `top`, no solo alto.

## Si desplaza un cajón interno, el teléfono pierde pantalla para siempre

**Síntoma (auditado 2026-09-05):** «queda un hueco en la parte inferior» y «la
parte superior está cortada». **Causa:** `html,body{height:100%}` los clavaba
al alto de la ventana y el que desplazaba era `.wrap`. Un navegador móvil solo
retrae su barra de direcciones cuando desplaza el **documento**, así que esa
franja se perdía siempre; y al aparecer o esconderse esa barra cambiaba
`100dvh` y el alto fijado dejaba de cuadrar: ese era el hueco.

**Regla:** en el teléfono desplaza el documento. Un alto fijo con cajón interno
solo se justifica en pantallas que NO se desplazan (el lector paginado, la
pantalla completa), y entonces se acota con `:not()` a esos estados.
**No se ve en un emulador:** hay que medir quién desplaza
(`documentElement.scrollHeight > clientHeight` frente al del contenedor).

## `viewport-fit=cover` sin zona segura arriba corta el encabezado

**Síntoma (auditado 2026-09-05):** la parte de arriba se veía cortada.
**Causa:** el `<meta viewport>` lleva `viewport-fit=cover`, así que el
contenido pasa por debajo de la barra de estado y del notch; el encabezado
tenía `padding-top:10px` fijo. De 27 usos de `safe-area-inset` en la hoja de
estilos, **solo uno** era del borde superior, y era de un modal.

**Regla:** con `viewport-fit=cover`, quien esté pegado a un borde reserva su
`env(safe-area-inset-*)`. Arriba conviene dárselo al elemento con fondo (el
encabezado), no al contenedor: así cubre la franja en vez de dejarla
transparente. En el emulador la zona segura vale 0, así que se comprueba
contando reglas, no midiendo píxeles.

## Un lector paginado sin deslizamiento se siente roto

**Síntoma (auditado 2026-09-05):** «no acepta ningún tipo de gesto ni
movimiento con el dedo, está como bloqueado». **Causa:** el área de lectura es
`overflow-x:hidden` (las páginas se mueven con `scrollTo`) y, al ser paginada,
tampoco tiene scroll vertical: en un teléfono real el dedo no tiene nada que
mover. **En el emulador de Chromium sí parecía responder**, así que ninguna
prueba lo veía. **Regla:** si un contenedor no puede desplazarse de forma
nativa, el gesto se atiende a mano (Pointer Events) y se declara
`touch-action`. Y desconfiar de un gesto probado solo en emulador.

## Una cadena flexible se rompe por el eslabón rígido

**Síntoma (auditado 2026-09-05):** el panel dejaba 192 px negros al final de la
pantalla. **Causa:** el panel y su tarjeta declaraban `flex:1`, pero sus
contenedores (`.wrap` y el propio panel) eran `display:block`, donde `flex` no
significa nada. **Regla:** para que algo se estire, **todos** los contenedores
entre él y la ventana deben ser flexibles. Comprobarlo recorriendo la cadena
con `getComputedStyle`, no leyendo la regla de un solo elemento.

## Un `import()` al arrancar no es carga diferida

**Síntoma (auditado 2026-09-05):** la app tardaba en abrir. **Causa:** el lector
de PDF se traía con `import()` dinámico —y un comentario decía que por eso
«quien no use esta pestaña no paga ese peso»— pero la llamada estaba en el
arranque: 553 KB para todo el mundo. **Regla:** `import()` difiere la descarga
al momento en que se **llama**, no por ser dinámico. Medir lo que baja la
pantalla de inicio; no confiar en el comentario.

## Un límite de corte no sabe en qué carácter está

**Síntoma (v2.41):** «Unir palabras» decía trabajar «sobre los cortes de esta
página» y en realidad reprocesaba el capítulo entero en cada salto, volvía a
pintar el texto y movía la lectura. **Causa:** `crearLimites` guarda los dos
átomos que separa cada corte, **no** una posición de carácter; el filtro
`l.charStart ?? l.pos` era `undefined` para todos y caía siempre en «todos».
**Regla:** antes de filtrar por posición, comprobar que el dato exista. Y solo
salió a la luz **ejecutando la prueba contra el dominio real**: en local el
diccionario se lee del disco y llega antes de que nadie note nada.

## Con páginas, apartar el cromo remaqueta y deshace el salto

**Síntoma (v2.41):** en el teléfono pulsabas «página siguiente» y volvías al
principio del capítulo. **Causa:** la lectura inmersiva sacaba la cabecera y la
barra del flujo (`display:none`), el texto crecía y había que repartir las
páginas otra vez; con el reparto nuevo, el carácter guardado caía dentro de la
página 1. **Regla:** en un lector paginado, mostrar u ocultar cromo **no puede
cambiar el tamaño del área de texto**. Se reserva el hueco siempre y solo se
desvanece (`opacity`). Se gana menos alto y a cambio la lectura no se mueve.
La prueba vigila que el total de páginas no cambie al apartar el cromo.

## Un control que se oculta se lleva el foco al `<body>`

**Síntoma (v2.41):** al cerrar la hoja de Apariencia en el teléfono, el foco se
perdía. **Causa:** el cierre hacía `btnApariencia.focus()` sin mirar, y en el
teléfono ese botón está oculto: `focus()` sobre un elemento sin caja no hace
nada. **Regla:** al devolver el foco, buscar el primer candidato **visible**
(`offsetParent !== null`), nunca uno fijo. Si un control existe en dos sitios
según la pantalla, el foco vuelve al que esté a la vista.

## Guardar el objeto para deshacer no sirve si el arreglo se reemplaza

**Síntoma (v2.41):** «Deshacer» no deshacía nada. **Causa:** se guardaba la
referencia al corte, pero `reconstruirTrasDecision` **reemplaza** el arreglo de
límites por otro nuevo; se estaba mutando un objeto que ya nadie miraba.
**Regla:** guardar el `id` y volver a buscarlo. Y al deshacer, marcar la
decisión como del usuario (`source:'user'`), no como «pendiente»: la
reconstrucción vuelve a resolver los pendientes y los habría unido otra vez en
el mismo instante.

## Un selector con identificador le gana a `hidden`

**Síntoma (producción, 2026-09-05):** en Micrófono, Archivo, YouTube y Traducir
aparecía **además** el contenido del panel de PDF. «Todos los apartados tienen
lo mismo», lo reportó el usuario.

**Causa:** al arreglar el hueco negro del panel PDF se añadió

```css
body:not(.jg-leyendo) #panelPdf{ display:flex }
```

Ese selector lleva un **identificador**, así que gana a `.panel{display:none}` y
al `display:none` que el navegador aplica por el atributo `hidden`. El panel se
dibujaba **siempre**, activo o no: 627 px de contenido ajeno en cada pestaña.

**Reglas:**

1. Una regla de `display` sobre un panel va acotada a su estado visible
   (`.active`), nunca al elemento a secas.
2. `hidden` debe ganar siempre. Hay una red de seguridad:
   `.panel[hidden], [hidden]{display:none !important}`. No quitarla.
3. **Probar la pestaña que NO se tocó.** Todas las suites miraban el panel de
   PDF y ninguna comprobaba que los demás siguieran limpios. Lo vigila ahora
   `verificar_pestanas.mjs`, en escritorio y en teléfono.

**Y una consecuencia que enseña algo:** este fallo **tapaba otro**. Los 58-83 px
de hueco muerto al final de la pestaña Archivo no se veían porque el panel de
PDF, dibujado de más, los rellenaba. Al corregir lo primero apareció lo
segundo. Un fallo que «compensa» a otro no es una casualidad rara: es lo que
pasa cuando nadie mide.

## Desplegar en cada mejora suelta cuesta horas y no aporta nada

**Síntoma (2026-09-05):** un solo encargo salieron **siete despliegues**. Cada
uno pide esperar el build, armar la copia limpia, comprobar los hashes contra el
dominio y volver a correr las suites de navegador. **Causa:** la regla escrita
decía «desplegar al cerrar cada mejora», y una tanda de trabajo tiene varias.
**Regla:** un despliegue por tanda, al final. Durante el trabajo se prueba en
local y se commitea. Solo se adelanta si hay algo roto en producción ahora
mismo, o si la duda **solo** se resuelve en el dominio real (en esta app ha
pasado con el gesto táctil, la zona segura y la barra del navegador). Para
mirar algo a mitad sin tocar producción: `npx vercel --yes`, sin `--prod`.

Ojo con lo que NO cambia: agrupar el despliegue no es saltárselo. Nada está
cerrado sin estar documentado, desplegado, verificado contra el dominio y
empujado a `origin/main`.

## Publicar en Vercel no es cerrar: Git puede quedarse atrás

**Síntoma (2026-09-05, v2.40):** producción servía v2.40.0 verificada byte a byte,
y `origin/main` seguía en v2.38.0. Catorce commits vivían solo en este equipo, entre
ellos el que metía `js/pdf/huella.js` en Git: **clonar el repositorio seguía dando una
app rota**, justo el fallo que la auditoría de v2.39.1 creía haber cerrado.
**Causa:** el despliegue sale por CLI desde la carpeta local, así que publicar no toca
Git; la lista de cierre pedía documentar, desplegar y verificar, pero no empujar.
**Regla:** una entrega no está cerrada hasta que `git log --oneline origin/main..HEAD`
sale vacío. Comprobarlo al final, junto con los hashes del dominio:

```bash
git fetch origin && git log --oneline origin/main..HEAD   # debe salir vacío
```

Si la rama de trabajo no es `main`, avanzar `main` (`git merge --ff-only <rama>`) antes
de empujar: dejar el cierre en una rama sin publicar es el mismo agujero.

## La cola debe conservar su propia huella de fuente

**Síntoma (v2.40, desarrollo):** al reabrir aparecían pendientes partes ya
corregidas. **Causa:** el controlador sustituía la huella calculada por partes
con otra del libro concatenado, usando separadores distintos. **Regla:** dejar
que la cola calcule su huella y restaurar el estado de guardado compatible.
La prueba de navegador verifica que reabrir no genera nuevas solicitudes de IA.

## Recalcular páginas no es avanzar en la lectura

**Síntoma (v2.40, desarrollo):** al reabrir un libro volvía a la primera página.
**Causa:** el primer cálculo de altura guardaba el carácter cero antes de
restaurar el avance. **Regla:** separar medir/presentar de guardar navegación.
Probar reapertura después de pasar varias páginas, también dentro de un párrafo.

## Reconstruir átomos filtrados no debe volver a detectar cabeceras

**Síntoma (v2.40, desarrollo):** Unir/Deshacer quitaba nuevas primeras líneas.
**Causa:** los átomos de lectura ya estaban filtrados; una segunda detección
de relleno descartaba otros fragmentos. El invariante comparaba solo la salida
filtrada y no veía la pérdida. **Regla:** marcar átomos ya filtrados y validar
contra los átomos de entrada. La regresión verifica ida/vuelta de texto exacto.

**Léelo antes de tocar el código.** No es teoría: cada caso ocurrió de verdad en este proyecto,
lo pagó el usuario, y aquí está la causa medida y la regla que lo evita. Varios se cometieron dos
veces por no estar escritos.

Cuando cometas uno nuevo, **añádelo aquí** con el mismo formato: síntoma, causa y regla. Un error
documentado deja de ser un error del proyecto.

> Las referencias apuntan a **nombres de función, selectores y títulos de sección**, no a números
> de línea: en un `index.html` de más de 15 000 líneas, cualquier edición los desplaza y una
> referencia vieja despista más que ayuda. Búscalos por texto.

---


## `.pytest_cache` bloqueada tumba el despliegue entero

**Síntoma:** `npx vercel --prod` termina en
`EPERM: operation not permitted, scandir '...\.pytest_cache'` y **no sube nada**.

Está en `.vercelignore`, pero el CLI recorre el árbol **antes** de aplicar las
exclusiones, así que una carpeta que ni siquiera se puede leer detiene todo. La
carpeta quedó con permisos rotos (ni `takeown` ni `icacls` la recuperan sin
administrador) y `Get-Acl` responde «Attempted to perform an unauthorized
operation».

**Salida sin administrador:** desplegar desde una copia limpia, llevándose
`.vercel/` para no publicar en otro proyecto.

```powershell
robocopy "<proyecto>" "<copia>" /E /XD ".pytest_cache" ".git" "node_modules" ".worktrees" "backend" "tests" "__pycache__"
cd "<copia>"; npx vercel --prod --yes --scope jhoncod24s-projects
```

Antes de publicar hay que comprobar que la copia lleva `.vercel/project.json`
con `prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8` (jg-turbo), o se publica en otro sitio.

**Sospecha razonable:** este mismo error explica el despliegue de v2.39.0 que
quedó anotado como bueno sirviendo el código viejo. Si el comando falla y solo
se mira el marcador de versión del HTML, parece que salió bien.


## Un despliegue «verificado» puede estar sirviendo el código viejo

**Qué pasó (2026-09-05, v2.39.0):** se anotó un despliegue como verificado
contra el dominio real, con marcador de versión y módulos «servidos con el
código nuevo». Al auditarlo, `js/pdf/mapaLectura.js` daba **404** y
`libroVista.js` pesaba 17 945 b en producción contra 20 570 b en local: era la
versión anterior, con el botón roto incluido.

**Por qué engaña:** el marcador de versión vive en `index.html`, que sí se
había actualizado. Comprobar el marcador no dice nada sobre los módulos.

**Cómo se comprueba de verdad:** comparando tamaños, archivo por archivo.

```bash
for m in mapaLectura libroVista pdfController limites; do
  loc=$(wc -c < "js/pdf/$m.js")
  prod=$(curl -s -o /dev/null -w "%{size_download}" "https://jg-turbo.vercel.app/js/pdf/$m.js")
  echo "$m local=$loc prod=$prod"
done
```

Y buscando en producción lo que **ya no debería estar**:

```bash
curl -s https://jg-turbo.vercel.app/js/pdf/libroVista.js | grep -c "Leer desde aquí"   # 0
curl -s https://jg-turbo.vercel.app/js/pdf/pdfController.js | grep -c "jgLeerTextoPdf" # 0
```

## Redesplegar sin subir `JG_JS_V` deja el módulo viejo en la caché

Los módulos se piden como `pdfController.js?v=' + JG_JS_V`. Si un despliegue
sirvió código viejo con `v78`, el navegador de quien ya entró tiene cacheado
`?v=v78` con ese contenido. Volver a desplegar sin cambiar `JG_JS_V` **no le
llega**: sigue leyendo su copia. Hay que subir `JG_JS_V` en `index.html` **y**
`CACHE_SHELL` en `sw.js`, siempre los dos.

## Una prueba que hace `grep` sobre el código no prueba que el código funcione

Las suites del rediseño comprobaban que existieran cadenas como `marcarRango` o
`data-ini` en los archivos. Todas pasaban con el módulo dando 404 en producción,
porque miraban el disco local, no el comportamiento. Lo que sí lo demuestra es
abrir la app en un navegador y comprobar el resultado:
`tests/verificar_pdf_lector_integracion.mjs`.

## Un archivo sin seguimiento puede sostener a tres que sí lo tienen

`js/pdf/huella.js` estaba fuera de Git mientras `libroVista.js`,
`pdfController.js` y `colaCorreccion.js` lo importaban. En local todo funciona,
porque el archivo está en el disco; al clonar, la app se rompe. Se detecta así:

```bash
grep -rhoE "from '\.\.?/[^']+'" js/pdf/*.js | sed "s/from '//;s/'//" | sort -u   | while read -r p; do f="js/pdf/$p"; [ "$(git ls-files "$f" | wc -l)" = "0" ] && echo "FALTA: $f"; done
```

## Medir con un patrón sin anclar cuenta nombres propios como errores

El medidor de cortes informaba de 39 «palabras pegadas» en un libro. Eran
`HeartMath`, `WhatsApp` y `YouTube`: el patrón buscaba
minúscula+MAYÚSCULA+minúscula sin `` delante, así que cualquier marca con
mayúscula intercalada contaba. Antes de perseguir un defecto medido, hay que
comprobar que el defecto existe en el texto:

```bash
grep -c "HeartMath" <(salida del reconstructor)   # 28 → la palabra está bien
```


## Los cinco minutos que ahorran un día

Antes de dar por terminada una tarea:

1. ¿Ejecuté las pruebas **hasta el final**, o alguna se cortó por un timeout? Un corte no es un
   aprobado. Cuenta las comprobaciones: si salen menos que la vez anterior, algo se rompió.
2. ¿Probé con **volumen realista**? Dos libros caben en pantalla y no ejercitan el scroll.
3. ¿**Medí** lo que afirmo, o lo deduje leyendo CSS? El estilo computado manda sobre lo que
   dice la hoja de estilos.
4. Si una prueba antigua falla, ¿**tiene razón ella**? Casi siempre sí.
5. ¿Verifiqué producción **contra el dominio real** y comprobando que el código servido lleva el
   cambio, no solo el marcador de versión?

---

## 1. Verificación: pruebas que pasan sin probar nada

Esta es la categoría más peligrosa del proyecto. Ha dado por buenas entregas rotas **cuatro veces**.

### 1.1 Verde con la funcionalidad rota, por falta de volumen

**Ocurrió** (2026-09-03, v2.29.0): se sacó la biblioteca de su caja con scroll propio y **el scroll
quedó completamente muerto**. `verificar_pdf_geometria` dio 42/42 y `verificar_pdf_navegador`
103/103. Ambas en verde, con el scroll sin funcionar en las tres pantallas.

**Causa:** las dos verificaciones trabajan con **dos** libros. Con dos libros todo cabe en la
ventana, así que nunca llegan a intentar desplazarse. No comprobaban el scroll: comprobaban que
no hacía falta.

**Regla:** una prueba de comportamiento necesita **datos que fuercen ese comportamiento**. Para el
scroll, contenido que no quepa. Para la paginación, más elementos que una página. Para el
rendimiento, un libro grande. Si la prueba pasa igual con el código roto, no es una prueba.

**Ya existe:** `tests/verificar_pdf_scroll.mjs` siembra nueve libros y **hace scroll de verdad con
la rueda del ratón**. Contra el CSS roto da 6 fallos; contra el bueno, 39/39.

### 1.2 Una prueba que se corta no es una prueba que pasa

**Ocurrió** (2026-09-03): `verificar_pdf_navegador` llevaba desde la v2.28.0 cortándose en la
comprobación **48 de 103** con un `TimeoutError` que no explicaba nada. Las entregas intermedias se
documentaron como verificadas. Faltaba más de la mitad.

**Causa:** la hoja de permiso de la IA (`#pdfAuditoriaHoja`), nueva en la v2.28.0, se abría a media
prueba y tapaba la pantalla. Todos los clics siguientes fallaban.

**Regla:** al terminar una verificación mira **cuántas comprobaciones salieron**, no solo si hubo
`FALLO:`. Si el proceso acaba con código distinto de 0 pero sin fallos, se cortó. Y cuando añadas
un diálogo, hoja o modal nuevo, **actualiza las verificaciones** para que sepan cerrarlo.

### 1.3 Las pruebas se quedaron atrás en una reestructuración

**Ocurrió** (2026-09-03): al aplanar el repo, `tests/` se quedó con **una** prueba de PDF de las
diez que existían (`test_pdf_progreso`, `test_pdf_limpieza`, `test_pdf_sincronizacion` incluidas,
justo las de los módulos que se iban a tocar). Además, los dos verificadores buscaban Playwright en
una ruta única (`../node_modules`) que **dejó de existir**, así que ni siquiera arrancaban.

**Regla:** después de mover o renombrar carpetas, **ejecuta la batería entera** y compara el número
de archivos y de comprobaciones con el último informe. Herramientas externas: búscalas en varias
ubicaciones y falla con un mensaje claro, nunca en silencio.

### 1.4 Arreglar el código no arregla lo que ya está guardado

**Ocurrió** (2026-09-03, v2.31.0 → v2.32.0): se corrigió cómo se trocea un libro en unidades de
lectura. Las pruebas pasaban, los PDF nuevos salían perfectos… y el usuario seguía viendo
exactamente el mismo fallo. Las unidades se cortan **al procesar el PDF** y se guardan en
IndexedDB: los libros que ya estaban en la biblioteca conservaban los cortes viejos. Desde fuera
parecía que el arreglo no había servido de nada.

**Regla:** cuando cambies **cómo se genera** algo que se guarda —troceo, capítulos, índices,
miniaturas, texto extraído—, pregunta siempre: *¿y lo que ya está guardado?* Casi siempre hace
falta una de estas dos:
- una versión en el registro (`versionTroceo`, `VERSION` de la base) que dispare el rehecho la
  primera vez que se abre, o
- una acción explícita para el usuario.

### 1.5 Un diálogo nativo puede bloquear una prueba visible sin lanzar error

**Ocurrió** (2026-09-03, v2.33.0): `verificar_pdf_navegador` quedó vivo más de 15 minutos al
ejecutarse con Chromium visible. Había completado audiolibro y Markdown, pero al comprobar «PDF
limpio» la página nueva ejecutó `window.print()` y abrió el diálogo nativo del sistema. Ese diálogo
no vive en el DOM, así que Playwright no podía cerrarlo ni llegar a su timeout normal.

**Regla:** una prueba visible que compruebe una vista imprimible debe neutralizar `window.print`
solo en el contexto automatizado y seguir verificando el HTML de la pestaña nueva. Registrar la
salida incrementalmente ayuda a distinguir el punto exacto de una espera de un proceso colgado.

Y **prueba el camino del dato ya guardado**, no solo el de los datos nuevos: es el que tiene la
gente. `tests/verificar_pdf_retroceo.mjs` hace justo eso — siembra un libro con el defecto y
comprueba que al abrirlo queda arreglado.

### 1.6 Una prueba puede mover el defecto y aun así quedar verde

**Ocurrió** (2026-09-04, revisión de v2.32.0): la migración unía las unidades guardadas con dos
saltos de línea. El corte `es` / `ta conclusión` dejó de aparecer en los extremos y la prueba pasó,
pero el resultado era `es\n\nta conclusión`, no `esta conclusión`. Para empeorar el caso, el libro
quedó marcado como migrado y no se revisaba en aperturas posteriores.

**Regla:** una regresión de integridad debe comprobar el contenido exacto reparado, no solo la
ausencia del patrón viejo. Si el dato original todavía existe, como el PDF guardado, vuelve a esa
fuente. Si no existe, conserva lo disponible y no adivines uniones. Toda migración persistente debe
tener una versión nueva cuando se descubre que la versión anterior fue defectuosa.

### 1.7 Pruebas huérfanas que nadie mira

**Estado actual:** `python -m pytest backend/tests` falla al recolectar 5 módulos
(`test_ai_youtube`, `test_marcas_de_tiempo`, `test_pulido_subtitulos`, `test_transcribe`,
`test_translate_local`): importan `api.subtitulos_limpieza` y `api.pulido`, que **no existen ni en
este repo ni en el respaldo**. Es anterior a septiembre de 2026 (comprobado con `git stash`).

**Regla:** una prueba que no compila es ruido que enseña a ignorar los fallos. Arréglala o
retírala, pero no la dejes ahí.

---

## 2. Cuando una prueba antigua falla, empieza por suponer que tiene razón

**Ocurrió** (2026-09-03, v2.28.0): al pulir la voz se añadió mayúscula automática al principio de
la cadena. `test_pdf_pulido_mecanico` falló: esperaba `página doce` y recibía `Página doce`.

Era tentador ajustar la prueba. **La prueba tenía razón:** el texto llega al motor de voz partido
en bloques, y un bloque que empieza en minúscula es la continuación del anterior. Forzar la
mayúscula cambiaba la entonación a media frase. La regla se limitó a «después de un punto».

**Regla:** una prueba vieja que falla es información, no un obstáculo. Entiende **por qué** se
escribió antes de tocarla. Si de verdad quedó obsoleta, cámbiala en un commit propio que explique
el motivo — nunca de paso mientras arreglas otra cosa.

---

## 3. Layout: la cadena de scroll se suelta entera o no se suelta

**Ocurrió** (2026-09-03, v2.29.0 → hotfix v2.29.1): se liberaron `html`, `body`, `#panelPdf`,
`.card` y `.pdf-area` para que la biblioteca dejara de tener scroll propio… pero **no `.wrap`**,
que en pantallas ≥641px lleva `height:100dvh; overflow:hidden` (`index.html`, sección
«9. Alto de la ventana»).

Medido con nueve libros: `#panelPdf` crecía a 1159 px, `.wrap` seguía anclado a 800 px y
**recortaba** 1334 px de contenido. El scroll no fallaba: no había nada que desplazar.

**Cómo está diseñada esta app** (imprescindible antes de tocar alturas):

| Zona | Modelo | Por qué |
|---|---|---|
| ≥641px, general | `.wrap{height:100dvh;overflow:hidden}` — pantalla fija, scroll interior | Lector, Micrófono, Archivo y YouTube tienen alto acotado |
| ≤640px, general | Scroll de documento | El teclado virtual rompe cualquier alto fijo (así lo dice el propio CSS) |
| Biblioteca del PDF | Excepción: scroll de documento en todas las pantallas | Crece con cada libro; encerrarla parecía una ventana flotante |
| Lector abierto (`body.jg-leyendo`) | Scroll interior | El dock de reproducción va anclado abajo |

**Regla:** antes de cambiar quién hace scroll, recorre **la cadena entera** desde `html` hasta el
elemento y anota `height`, `min-height` y `overflow` de cada eslabón. Un solo ancestro con
`overflow:hidden` y altura fija anula todo lo de abajo. Y compruébalo **midiendo en el navegador**,
no leyendo el CSS.

---

## 4. CSS: el estilo computado manda

**Ocurrió** (2026-09-03): `.pdf-actualizar{min-height:44px}` no se aplicaba; el botón medía 36 px y
la verificación lo avisaba. La regla existía y parecía correcta.

**Causa:** más abajo en `index.html`, bajo el comentario «Nada por debajo del tamaño de un dedo»,
está `.chip,.tts-pill,.result-expand,.btn-tts,.mini-btn{min-height:36px}`. Misma especificidad, va
después, gana. (Esa regla fija 36 px, por debajo de los 44 px recomendados: en móvil lo corrige un
`@media`, en tablet no.)

**Regla:** cuando un estilo «no se aplica», **mide `getComputedStyle`** antes de teorizar. En un
archivo de 15 000 líneas con reglas globales al final, el orden decide más que la lógica. Si tu
regla debe ganar, súbele la especificidad nombrando un ancestro y **deja escrito por qué**.

---

## 5. Sincronización: cinco formas de perder datos por el camino

Todas ocurrieron. Léelas antes de tocar `js/pdf/nube.js`, `sincronizacion.js` o `biblioteca.js`.

### 5.1 La comprobación va después del filtro que ya la excluyó

**Ocurrió** (v2.28.x): las carátulas de libros ya sincronizados **nunca** se enviaban.
`faltaSubirPortada()` existía, funcionaba y su comentario describía exactamente ese caso… pero se
llamaba **dentro del bucle** que recorría `paraSubir`, y `paraSubir` ya había dejado fuera a los
libros «al día», que son precisamente los que la necesitaban.

**Regla:** si una comprobación existe para **rescatar** casos, tiene que ejecutarse **antes** del
filtro que los descarta. Cuando escribas «y también cuando pase X», pregunta: *¿llega el código a
mirar X en ese caso?*

### 5.2 Cambiar algo que no altera la marca de tiempo no se propaga

**Ocurrió** (v2.29.0): las carátulas subían bien a la nube —comprobado en la base— y aun así no
aparecían en los otros aparatos. El documento **sí llegaba** (el servidor filtra por `sello`, el
momento de la escritura), pero el cliente lo descartaba: `decidir()` compara `actualizado`, y
enviar una carátula no cambia `actualizado`. La imagen llegaba al navegador y se tiraba.

**Regla:** si añades un dato que viaja pero **no** modifica la marca de tiempo, la comparación
«gana el más reciente» lo ignorará. Dale su propia vía. Aquí la solución fue aplicar la carátula al
margen de quién gane el documento (`portadasARescatar`), porque una imagen no compite con nada.

**Cuidado adicional:** la tentación era tocar `actualizado` para forzar la propagación. Habría
hecho que ese aparato «ganara» y **pisara el progreso de lectura** de los demás. Nunca uses la marca
de tiempo para forzar un envío.

### 5.3 Guardar el avance no puede arrastrar el libro entero

**Ocurrió:** `guardarProgreso()` hacía `doc.actualizado = Date.now()`, la sincronización lo leía
como «cambió el documento» y resubía **los 40 capítulos** para comunicar un dato de 20 bytes.

**Regla:** separa «cambió el progreso» de «cambió el contenido» (`actualizado` vs
`contenidoActualizado`, ver `necesitaSubirContenido()`). Antes de subir algo pesado, pregunta qué
cambió de verdad.

### 5.4 Sincronizar solo cuando el usuario pulsa un botón

**Ocurrió:** `sincronizarAhora()` se llamaba en cinco sitios, ninguno al ocultar la app. Si el
celular se apagaba o el usuario cambiaba de aplicación, **el progreso no salía nunca** del
dispositivo.

**Regla:** en móvil el único evento fiable es `visibilitychange` a `hidden`. `beforeunload` no se
dispara cuando el sistema mata la pestaña. Guarda ahí, y añade un latido mientras se usa.

### 5.5 Reemplazar el registro entero pisa lo que no querías

**Regla:** cuando llegue un dato suelto (una imagen, una preferencia), guárdalo **solo a él**. Ver
`guardarPortadaRecibida()`: no pasa por `guardarDocumento()` a propósito, para que una carátula que
llega no pueda hacer retroceder un libro que se estaba leyendo.

---

## 6. Texto y voz: el guardián que solo mira una dimensión

### 6.1 Conservar las palabras no es conservar el texto

**Ocurrió** (v4.x): `aplicarSignos()` rearmaba el bloque con `tokens.join(' ')`, lo que **borraba
todos los saltos de párrafo**. Los títulos quedaban pegados al texto siguiente y la voz los leía de
corrido. El guardián `mismasPalabras()` lo aprobaba: solo comparaba tokens léxicos normalizados, e
ignoraba los saltos de línea.

**Regla:** un guardián protege **exactamente** lo que compara. Si prometes «no se altera el texto»,
comprueba también la estructura (hoy `mismasPalabras` rechaza `estructura_perdida` si se pierden
saltos). Al reconstruir un texto, recórrelo desde el original e inserta; no lo rearmes desde sus
piezas.

### 6.2 Dos definiciones de lo mismo en el mismo archivo

**Ocurrió:** `limpiezaTexto.js` tenía dos criterios distintos e incompatibles de «esto es un
título»: `pareceTitulo()` (palabras clave o tamaño de letra) y `clasificarBloque()`
(`t.length < 90 && /^[A-ZÁÉÍÓÚÑ][^.!?]*$/`). Los bloques salían mal tipados según quién preguntara.

**Regla:** un concepto, una función. Si dos sitios necesitan decidir lo mismo, que uno llame al
otro.

### 6.3 Lo que se ve y lo que se oye son capas distintas

El texto del libro es **inmutable**. Las pausas, las expansiones de abreviaturas y la limpieza de
llamadas de nota viven **solo** en `prepararParaVoz()`, que se genera justo antes de hablar y se
descarta.

**Regla:** para que suene mejor, toca la capa de voz, nunca el texto guardado ni el exportado. Si
una prueba de exportación falla tras cambiar la voz, es que se coló: corrígelo antes de seguir.

### 6.4 El prompt puede pedir una corrección que el guardián descarta

**Ocurrió** (2026-09-04, v2.34): el prompt de lectura pedía unir palabras partidas como
`compren dido`, pero `mismasPalabras()` exigía el mismo número de tokens. La IA podía responder
bien y la aplicación reemplazaba silenciosamente esa salida por `compren dido`. Además, una
precarga ejecutada antes del consentimiento guardaba el texto local en caché; aceptar después ya
no lanzaba la corrección del capítulo.

**Regla:** prueba el texto que finalmente se muestra y se oye, no solo la respuesta de la IA. Una
excepción del guardián debe estar acotada por evidencia local, conservar letras, cifras y orden, y
tener regresiones negativas. Ningún resultado dependiente de consentimiento se calcula ni se
guarda antes de que la persona responda; una corrección persistida lleva la huella de su fuente.

### 6.6 Un fallo de red no es un capítulo corregido, ni el fin del libro

**Ocurrió** (v2.37): `iniciarCorreccionLibro` solo recorría límites `pending`. Si no había, marcaba
el libro como corregido sin tocar la puntuación. Un `catch` de red incrementaba `fallos` y seguía,
pero no reintentaba ni encogía el bloque; y `jgPulirTextoDetallado` en modo lectura devolvía el
original con `ia_used: false`, que acababa guardado como `lectura_segura`.

**Regla:** la corrección recorre **todas** las partes con cola persistente. Un fallo de red, tiempo
límite o proveedor no se guarda ni detiene el resto. Se reintenta, se encoge el bloque y lo que
falle queda pendiente para *Reanudar corrección*. «Libro corregido» solo si pendientes=0 y fallos=0.
Una prueba de 40/50/100/120 partes con recarga debe terminar en cero pendientes.

### 6.5b Aplanar TextItem es perder la palabra

**Ocurrió** (v2.31–v2.36): `agruparLineas()` juntaba fragmentos por Y, insertaba espacios por
un umbral de hueco y tiraba `hasEOL`, índice, fuente y geometría. Los cortes **dentro de una
misma línea** nunca eran candidatos. Los que sí lo eran se buscaban después por el par de
palabras (`es`+`ta`), así que una repetición podía corregir el sitio equivocado. Y la «reparación»
era que una IA reescribiera el capítulo: sin red, el usuario se quedaba con `bos ton`.

**Regla:** el átomo se crea **antes** de normalizar o agrupar. Cada posible separador tiene un
`boundaryId` ligado a los fragmentos originales. Una unión solo cambia ese separador. La IA no
reescribe letras. El texto canónico, el de la pantalla y el que oye TTS son el mismo.

### 6.5 Un fallback sin cambios no es una revisión terminada

**Ocurrió** (2026-09-04, v2.35): si `/improve` fallaba, el navegador recibía el texto original con
`ia_used: false`. `crearPulidor()` comprobaba que ese texto preservaba las palabras, lo guardaba
como `lectura_segura` y no volvía a pedirlo. Además, el indicador mostraba la cola editorial por
renglones, no el proceso que unía los cortes, de modo que `Parcial 25 de 4.950` parecía progreso
de una corrección que en realidad no estaba ocurriendo.

**Regla:** una degradación segura puede mostrar el original, pero nunca marcarlo como trabajo
confirmado ni meterlo en la caché. El contador visible debe medir exactamente la operación que
promete su etiqueta. Filtra los elementos pertinentes antes de aplicar un límite global; limitar
antes de filtrar elimina silenciosamente casos tardíos.

### 6.7 Un hash lento congela la pestaña con libros grandes

**Ocurrió** (v2.39, en desarrollo): al pedir SHA-256 se trajo un fragmento
puro de cadenas (`charCodeAt` + arreglos normales). Con 50 000 letras tardaba
4,4 s; con un libro de 300 páginas (~1,8 MB) bloqueaba el hilo principal
**90 segundos** (medido con `PerformanceObserver/longtask`). El lector no
abría y `verificar_pdf_navegador` moría esperando `#pdfProgLabel`.

**Causa:** el algoritmo era correcto pero con estructuras lentas (cadenas
inmutables concatenadas y arreglos normales). Nada lo delataba con libros
pequeños: todas las unitarias pasaban en verde.

**Regla:** toda función síncrona nueva que toque el texto completo se mide
con el libro de 300 páginas, no solo con unitarias pequeñas. SHA-256 va
sobre bytes (`TextEncoder` + `Uint32Array`): ~44 ms para 1,9 MB. Si algo
tarda más de ~200 ms con ese libro, va fuera del hilo principal o se
trocea con `await` entre bloques.

### 6.8 El indicador de archivo puede estar atrasado

**Ocurrió** (v2.48): un libro antiguo tenía el PDF en `archivos`, pero su
documento decía `tieneArchivo: false`. La migración creyó al metadato y dejó el
texto como no verificable aunque la fuente original sí existía.

**Regla:** para decidir si se puede reextraer, consulta el blob real en
IndexedDB. El indicador sirve para pintar la biblioteca, no como prueba de que
la fuente existe o falta.

### 6.9 Cobertura completa también exige un destino único

**Ocurrió** (v2.48): un TextItem vacío compartía línea con un número de página.
Quedó anotado una vez como vacío y otra dentro de la omisión del número. Los
conjuntos decían que toda la fuente estaba cubierta, pero ocultaban el destino
duplicado.

**Regla:** cuenta apariciones, no solo IDs distintos. Cada fragmento debe estar
incluido una vez o en una sola omisión, y su texto tiene que coincidir con la
fuente inmutable antes de validar la transcripción.

---

## 7. Caché y despliegue

### 7.1 Botones muertos: HTML nuevo con JavaScript viejo

**Ocurrió:** el service worker servía módulos `/js/` cacheados mientras el HTML llegaba nuevo. Los
botones existían y no hacían nada. Se resolvió versionando el JS junto al HTML (`JG_JS_V`).

**Regla:** si cambias un módulo de `js/`, **sube `JG_JS_V`** y `CACHE_SHELL` en `sw.js`. Si solo
cambias CSS del `index.html`, basta `CACHE_SHELL`.

### 7.2 La base de datos del navegador solo va hacia adelante

**Ocurrió:** un despliegue subió IndexedDB a la versión 5; luego el código pedía la 4. IndexedDB se
niega a abrir una base más nueva y **la biblioteca aparecía vacía**, aunque los libros estaban
intactos.

**Regla:** `VERSION` en `biblioteca.js` solo sube, nunca baja. Las migraciones son **aditivas**:
`onupgradeneeded` crea lo que falte y no borra nada. Y traduce el error de versión a algo que una
persona entienda.

### 7.3 bis La caché del CDN también miente en la primera comprobación

**Ocurrió** (2026-09-03, v2.31.0): la verificación devolvió el marcador de la entrega **anterior** y
cero coincidencias al buscar el código nuevo en los módulos. Parecía un despliegue fallido. No lo
era: era la caché del CDN. Repitiendo con `?nocache=<algo distinto>` salió todo correcto.

**Regla:** añade siempre un parámetro distinto a la URL al verificar
(`curl -s "https://jg-turbo.vercel.app/?nocache=$RANDOM"`), y lo mismo para los módulos. Sin eso
puedes redesplegar tres veces persiguiendo un fallo que no existe.

### 7.3 El alias tarda en propagar: no des por fallido un despliegue a la primera

**Ocurrió** (v2.29.1): la verificación inmediata seguía sirviendo la versión anterior. El deploy
estaba `Ready`; el alias tardó unos 40 segundos.

**Regla:** reintenta unos segundos antes de concluir nada. Y verifica **contra
`https://jg-turbo.vercel.app`**, nunca contra la URL que imprime el CLI.

### 7.4 El marcador de versión no prueba que el código llegó

**Regla:** comprueba también que el **módulo servido** contiene el cambio:

```bash
curl -s https://jg-turbo.vercel.app | head -1                      # marcador
curl -s https://jg-turbo.vercel.app/sw.js | grep shell-v           # caché
curl -s "https://jg-turbo.vercel.app/js/pdf/nube.js?v=vNN" | grep miFuncionNueva
curl -s https://jg-turbo.vercel.app/api/health
```

---

## 8. Interfaz: si no da señal, está roto

### 8.1 Un botón sin respuesta es indistinguible de uno averiado

**Ocurrió:** el botón «Actualizar» de la cabecera de la biblioteca **sí** sincronizaba, pero todo su
feedback (`conBotonOcupado` y `avisoNube`) iba a la sección de la nube, al final de la página,
dentro de un `<details>` normalmente cerrado. El usuario lo reportó como «no pasa nada».

**Regla:** el aviso va **donde está el usuario**, en el botón que pulsó. Bloquéalo mientras
trabaja, cambia su etiqueta, y si la espera puede pasar de unos segundos, que se note que sigue
vivo (el icono de «Actualizar» gira por eso).

### 8.2 Los estados tienen que decir la verdad

**Ocurrió:** `estadoAuditoriaTexto()` devolvía `'Cambios por revisar'` como caso por defecto
**aunque no hubiera ninguna propuesta**. El propio código lo admitía en un comentario. El usuario
buscaba cambios que no existían.

**Regla:** ningún estado por defecto que afirme algo sin comprobarlo. Si no sabes cuántos hay,
pásale el número o di algo que sea cierto en todos los casos.

### 8.3 Nada de `confirm()` para decisiones que hay que explicar

**Ocurrió:** el permiso para enviar texto a la IA se pedía con `window.confirm()`: bloqueante, feo
en móvil y sin espacio para explicar qué se envía y qué no.

**Regla:** usa las hojas de la propia app. Quedan `confirm`/`alert` en `index.html`: al tocar una
zona que use uno, cámbialo.

---

## 9. Trabajar en este repo

### 9.1 Hay más de un agente

**Antes de empezar:** `git status` y `git log --oneline -5`. Si hay cambios sin commitear que no son
tuyos, **no los toques ni los descartes**: avisa. Trabaja en rama propia. Nunca `reset --hard`,
`checkout --` ni `push --force` sobre trabajo ajeno.

Si un archivo cambia bajo tus pies a mitad de tarea, **vuelve a leerlo** antes de seguir editando.

### 9.2 `git stash` distingue tu error del error heredado

**Úsalo siempre** antes de afirmar «esto ya fallaba»: guarda tus cambios, ejecuta la prueba, compara,
restaura. Así se comprobó que los 5 fallos de `pytest` y el corte de `verificar_pdf_navegador` eran
anteriores, y que el scroll roto sí era propio.

### 9.3 La carpeta de respaldo es solo de lectura, y no se despliega

`JG Turbo_OLD/` conserva la estructura anterior a la reestructuración del 2026-09-03. Sirve para
recuperar lo que la migración dejó atrás (de ahí salieron las pruebas y Playwright). **Nunca
escribas ahí.** No es un repositorio git: lo que se edite ahí queda suelto, sin historial y sin
forma de llevarlo al otro computador.

**El peligro que tenía** (neutralizado el 2026-09-04): conservaba **dos** enlaces con el proyecto
de producción, los dos apuntando al mismo `prj_EfuyBt2YDNqQNVaKif9DKUjpVaz8` que la carpeta buena:

| Carpeta | Por qué era peligrosa |
|---|---|
| `JG Turbo_OLD/.vercel` | un `npx vercel --prod` desde ahí subía la versión de agosto |
| `JG Turbo_OLD/vercel_deploy/.vercel` | peor: `vercel_deploy` **era** la carpeta de despliegue del flujo antiguo, justo donde iría alguien siguiendo documentación vieja |

Un solo comando ejecutado ahí por equivocación habría sobrescrito **jg-turbo.vercel.app** con la
versión de agosto. Ambas se renombraron a `.vercel.NO-DESPLEGAR-CARPETA-ANTIGUA`, y hay un
`LEER-PRIMERO-NO-TRABAJAR-AQUI.md` en su raíz explicándolo. **No las vuelvas a renombrar.**

**Regla general:** cuando dupliques o archives una carpeta de proyecto, lo primero que hay que
desactivar es su enlace de despliegue. Una copia de seguridad que puede escribir en producción no
es una copia de seguridad: es una bomba con temporizador. Comprueba con:

```bash
find . -maxdepth 4 -path "*/.vercel/*" -name "project.json" -exec grep -l "prj_TU_PROYECTO" {} +
```

Solo debería salir la carpeta viva (`jg-turbo/`).

**Y no la borres sin más:** las verificaciones con navegador buscan ahí su copia de Playwright
(`JG Turbo_OLD/node_modules/playwright`), porque no está instalado en el proyecto nuevo. Para poder
borrarla, antes `npm i -D playwright` en `jg-turbo`.

### 9.4 Diagnostica midiendo, no leyendo

En esta sesión, tres hipótesis razonables leyendo el código resultaron falsas y se corrigieron
midiendo: el filtro del cursor de sincronización (el servidor usa `sello`, no `actualizado`, y se
comprobó consultando la función real), el `min-height` del botón, y el solape del pie con los
botones. Un script de Playwright que imprime `getBoundingClientRect` y `getComputedStyle` cuesta dos
minutos y evita una tarde de suposiciones.

### 9.5 Entregar es documentar, desplegar y verificar

Una mejora **no está cerrada** hasta que está en el MD de su feature (pedido, causa —nombrando la
función o el selector, no la línea—, corrección, pruebas, deploy), desplegada, y verificada contra
el dominio real.
Y di también **qué no pudiste comprobar** — por ejemplo, si algo necesita dos dispositivos, o si la
voz «suena bien», que ninguna prueba mide.
