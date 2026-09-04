# Trampas de JG Turbo · errores ya cometidos que no deben repetirse

**Léelo antes de tocar el código.** No es teoría: cada caso ocurrió de verdad en este proyecto,
lo pagó el usuario, y aquí está la causa medida y la regla que lo evita. Varios se cometieron dos
veces por no estar escritos.

Cuando cometas uno nuevo, **añádelo aquí** con el mismo formato: síntoma, causa y regla. Un error
documentado deja de ser un error del proyecto.

> Las referencias apuntan a **nombres de función, selectores y títulos de sección**, no a números
> de línea: en un `index.html` de más de 15 000 líneas, cualquier edición los desplaza y una
> referencia vieja despista más que ayuda. Búscalos por texto.

---

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

Y **prueba el camino del dato ya guardado**, no solo el de los datos nuevos: es el que tiene la
gente. `tests/verificar_pdf_retroceo.mjs` hace justo eso — siembra un libro con el defecto y
comprueba que al abrirlo queda arreglado.

### 1.5 Pruebas huérfanas que nadie mira

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

### 9.3 La carpeta de respaldo es solo de lectura

`JG Turbo_OLD/` conserva la estructura anterior a la reestructuración del 2026-09-03. Sirve para
recuperar lo que la migración dejó atrás (de ahí salieron las pruebas y Playwright). **Nunca
escribas ahí.**

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
