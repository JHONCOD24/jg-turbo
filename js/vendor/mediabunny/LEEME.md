# Mediabunny (vendor)

- **Versión:** 1.60.0 (`mediabunny`, `@mediabunny/mp3-encoder`, `@mediabunny/aac-encoder`), licencia MPL-2.0 (`LICENSE`).
- **Origen:** paquetes npm de npmjs.com, copiados tal cual a esta carpeta (la app es PWA: sin CDN ni npm en tiempo de ejecución).
- **Import reescrito:** las extensiones traían `from "mediabunny"`; aquí apuntan a `from "./mediabunny.min.mjs"` para que usen ESTA copia. Sin eso, el navegador carga otra y el registro de códecs no se ve (MP3 «codec not supported», TRAMPAS.md).
- **Uso:** carga diferida solo al pedir una descarga (`js/youtube/medios.js`). No lo importes al arrancar.
- **Al actualizar:** repetir la reescritura del import y correr `node tests/verificar_biblioteca_datos.mjs` en un navegador sin códecs.
