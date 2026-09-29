# Udemy: extensión personal de Chrome

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

La URL firmada solo vive en storage.session de la extensión mientras está abierta
la sesión de Chrome y se retira al cerrar el panel. El texto y la voz no se guardan.
El diagnóstico oculta firma e identificadores. Una clase se pide una sola vez por
sesión de página; si se cierra el panel y se vuelve a abrir, se puede necesitar
recargar la clase y activar CC en inglés.

El trabajo continúa en `tmp/udemy-trabajo`, en la rama `feat/udemy-doblaje`,
porque el checkout principal está siendo utilizado por otro trabajo del lector PDF.
