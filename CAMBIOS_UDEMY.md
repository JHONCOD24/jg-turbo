# Udemy: extensión personal de Chrome

## Frases continuas, version 0.3.1 (2026-09-29)

El dueño dio el ejemplo «siempre / y cuando». Se reproduce primero en una
prueba que falla; el motor une continuaciones antes de pedir la voz, hasta
una pausa escrita, sin cambiar hablante ni borrar silencios reales. Limites:
18 segundos y 600 caracteres. Conserva los indices y los subtitulos de cada
segmento; retroceder vuelve a generar la frase completa. Copia actualizada
con `node extension-udemy/copiar_motor.mjs`, 13 archivos.

Pruebas locales: frases continuas 14; Udemy unitarias 116 y navegador falso
31. La escucha del cambio en una clase real queda pendiente del dueño.
Recargar la extension en chrome://extensions, luego recargar la clase y abrir
de nuevo el panel de la extension. No se abre la aplicacion para doblar Udemy.

## Diagnóstico recibido del dueño, 2026-09-29

Un video en el documento principal, duración 635,233 s, sin textTracks.
Se observó un VTT en `vtt-cdn77.udemycdn.com`, ruta con idioma `en_US`.
Fuente elegida según el plan: URL del VTT observado, leída desde el script aislado.
No se necesita `all_frames`. La cabecera reportó el nombre del curso; no se usa
como título de clase cuando no se encuentra una cabecera específica.

Este diagnóstico fue aportado por el dueño. El doblaje real aún no está probado.

## Desarrollo

- Tarea 0: YouTube sincronía 74, doblaje 139, X 70, cero fallos.
- Tarea 1: estáticas 18, navegador diagnóstico 10.
- Tarea 2: copia normalizada y dependencias internas, 26.
- Tarea 3: WebVTT, 12.
- Tarea 4: reproductor remoto, 16.
- Tarea 5: puente y restauración en navegador falso, 7.
- Tarea 6: adaptadores de traducción y voz, 10.
- Tarea 7: preferencias y panel, 12; navegador inicial, 5.
- Tarea 8: estilo del subtítulo, 4; navegador con pantalla completa, 9.
- Tarea 9: conjunto unitario 100 y navegador completo 26, cero fallos.
  Se midieron voz reproduciéndose, dos audios, controles de 44 px, subtítulo,
  cancelación de red, errores visibles, cambio de clase tras play de la persona,
  velocidad revertida sin insistencia, restauración y límites de peticiones.
  YouTube sincronía conserva 74, doblaje 139 y X 70.

Comandos: `node tests/test_udemy_doblaje.mjs` y
`node tests/verificar_udemy_doblaje.mjs`. La clase, el CDN y la API son falsos.
La Tarea 10 queda pendiente del dueño. No se hicieron pruebas en Udemy real.

El video sigue en su página original, sin incrustarlo ni descargarlo. El panel
ejecuta la copia del motor, con adaptadores propios. El script de página corre
aislado: sin cookies, credenciales, scripts en MAIN, recursos públicos de extensión,
clics ni navegación. Lee como máximo un VTT inglés ya observado por clase desde
udemycdn.com, con el origen de la página y sin credenciales.

La URL firmada solo vive en storage.session de la extensión mientras está abierta
la sesión de Chrome y se retira al cerrar el panel. El texto y la voz no se guardan.
El diagnóstico oculta firma e identificadores. Una clase se pide una sola vez por
sesión de página; si se cierra el panel y se vuelve a abrir, se puede necesitar
recargar la clase y activar CC en inglés.

El trabajo continúa en `tmp/udemy-trabajo`, en la rama `feat/udemy-doblaje`,
porque el checkout principal está siendo utilizado por otro trabajo del lector PDF.

## Corrección durante la prueba del dueño

La captura mostró el panel desconectado y Doblar desactivado tras recargar la clase.
Se reprodujo con la página falsa: la prueba nueva falló por tiempo agotado antes
del arreglo. Ahora el panel reintenta conectarse después de la recarga, con espera
creciente y límite de intentos, sin navegar ni pedir recursos de Udemy.
La prueba completa pasó con 27 comprobaciones; las unitarias siguen en 100.
Regresiones: YouTube sincronía 74, doblaje 139 y X 70, cero fallos.
La validación real continúa pendiente del dueño.

## Voces y tecnicismos, versión 0.3.0

El dueño reportó que el doblaje suena bien y pidió ampliar las voces y mejorar
el inglés técnico del bootcamp. Ese reporte no verifica todavía toda la lista
de Tarea 10 ni el estado de la cuenta durante varios días.

Se agregó el modo multilingüe de la aplicación mediante `unified: true`:
Mujer (Ava) y Hombre (Andrew). Las 12 opciones regionales existentes ahora
muestran el nombre. No se importan Fish, voces clonadas ni proveedores nuevos.
Se conserva la voz guardada; el dueño elige la opción nueva. El acento se
deshabilita al elegir multilingüe porque ese modo no lo utiliza.

`lib/terminosWeb.js` protege una lista de términos antes de traducir y restaura
su escritura original antes de mostrarla o sintetizarla. Comprueba que cada
término regrese una vez y dentro de su segmento: una respuesta incompleta
da error, no entrega tokens a la voz. Solo vive en memoria. El interruptor
«Conservar términos de desarrollo web» se puede apagar para otros cursos.
No cubre todas las expresiones posibles ni acredita por sí solo la calidad auditiva.

Pruebas primero: faltaba el módulo de términos y fallaba la bandera multilingüe.
Después: `test_udemy_doblaje` 116, `verificar_udemy_doblaje` 31, cero fallos.
YouTube sincronía 74, doblaje 139, X 70, cero fallos.
`node tests/verificar_udemy_voz_real.mjs --api-real`: 3 OK, usando solo JG Turbo
con frases inventadas, sin Udemy ni audio guardado. La traducción conservó seis
tecnicismos. La API anunció `en-US-AvaMultilingualNeural` y
`en-US-AndrewMultilingualNeural`, ambas con audio no vacío. No se hizo escucha
humana de esas muestras. La comprobación del sonido en la clase queda con el dueño.
