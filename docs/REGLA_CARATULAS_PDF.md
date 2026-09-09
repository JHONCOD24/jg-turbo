# Regla permanente · Carátulas originales en los libros PDF de JG Turbo

> **Objetivo inamovible:** Todo libro que ingrese o se adapte para el apartado PDF de JG Turbo **debe mostrar siempre su carátula original auténtica**, tanto en la cuadrícula de la biblioteca como en el banner superior «Seguir leyendo» y en el lector.
> 
> **Queda estrictamente prohibido:**
> - Libros con portada marrón dibujada por canvas con iniciales (p. ej. «CD»).
> - Libros con portadillas en blanco (>99.2% de píxeles blancos) tomadas por error como carátula.
> - Libros con portadas equivocadas por búsquedas erróneas de metadatos (p. ej. *Sinners Anonymous* en lugar de *Conversaciones con Dios 2*).
> - Banners promocionales de sitios terceros en lugar de la portada original del libro.

---

## 1. Arquitectura de Carátulas en la Aplicación

La resolución de la portada de un libro se realiza a través de `js/pdf/caratula.js` en una jerarquía estricta de cuatro niveles:

```
[1. Catálogo Canónico Local] (PORTADAS_CANONICAS en /img/portadas/*.jpg)
            │ (si no coincide el título)
            ▼
[2. Extracción de Página 1] (extractorPdf.js con filtro de blancura < 99.2%)
            │ (si es blanca >99.2% o falla)
            ▼
[3. Búsqueda en APIs de Catálogo] (OpenLibrary / Google Books con título limpio)
            │ (si no hay internet o no se encuentra)
            ▼
[4. Canvas Dibujado] (Último recurso de seguridad)
```

### Prioridad 1 · Catálogo Canónico Local (`PORTADAS_CANONICAS`)
- Los libros base de la biblioteca se registran de forma estática en `js/pdf/caratula.js` mapeando su título normalizado hacia un archivo de imagen en `/img/portadas/{slug}.jpg`.
- **Ventaja:** Funciona al 100% sin conexión, carga instantáneamente y no depende de APIs externas volátiles ni de si el PDF original traía o no portada incrustada.
- **Service Worker:** Todas las imágenes en `/img/portadas/` están precacheadas en `sw.js` bajo `CACHE_SHELL`.

### Prioridad 2 · Extracción inteligente de Página 1 (`extractorPdf.js`)
- Para PDFs subidos por el usuario que no pertenezcan al catálogo canónico, `pdf.js` renderiza la página 1 en un canvas a 380 px de ancho.
- **Filtro de blancura:** `extractorPdf.js` muestrea píxeles en cuadrícula. Si la página 1 tiene **más del 99.2% de píxeles blancos** (lo que indica una portadilla interior de texto con márgenes gigantes o una página en blanco), el extractor **salta automáticamente a inspeccionar la página 2**.

### Prioridad 3 · Búsqueda en catálogo online (`buscarPortadaReal`)
- Si no hay portada en el PDF, consulta OpenLibrary y Google Books.
- **Regla crítica de sanitización:** `limpiarNombreLibro()` descarta metadatos espurios como `(anonymous)` o cadenas vacías y utiliza el nombre del archivo (`nombreArchivo`) como respaldo. Esto previene que se busquen palabras genéricas que asocien novelas irrelevantes.

### Prioridad 4 · Canvas dibujado (`dibujarPortada`)
- Solo se utiliza como red de seguridad si el dispositivo está sin red, el PDF no tiene imagen y el libro no está en el catálogo canónico.

---

## 2. Instrucciones obligatorias al adaptar un PDF nuevo (`regla-pdf`)

Cualquier agente encargado de adaptar un libro para la app debe cumplir obligatoriamente estos 4 pasos sobre la carátula:

### Paso 1 · Extraer o conseguir la portada auténtica
- Obtener la portada oficial de la editorial a alta resolución.
- Guardarla en la carpeta de trabajo como `portada.jpg`.

### Paso 2 · Activar la portada en el perfil de adaptación
- En `perfil.json`, fijar `"portada_original": true`.
- Esto garantiza que `5_construir.py` monte en la **página 1 a sangre** la imagen de la portada completa antes del índice y del cuerpo del libro.

### Paso 3 · Compilar siempre con título y autor explícitos
- Al ejecutar el paso de construcción del PDF:
  ```bash
  python3 5_construir.py "Título del Libro" "Autor del Libro"
  ```
- **PROHIBIDO:** Omitir los argumentos o dejar que ReportLab guarde `(anonymous)` en los metadatos del PDF.

### Paso 4 · Integración en el catálogo base (si el libro se suma a la app)
Si el libro pasará a ser parte de la biblioteca estándar de JG Turbo:
1. Optimizar la portada a un archivo JPEG/WebP:
   - Ancho: **380 px**.
   - Peso: **15 KB a 60 KB**.
   - Destino: `/img/portadas/{nombre-del-libro}.jpg`.
2. Registrar el patrón en `PORTADAS_CANONICAS` en `js/pdf/caratula.js`:
   ```javascript
   { patron: /tu[\s-_]?libro/i, archivo: '/img/portadas/tu-libro.jpg' }
   ```
3. Añadir la ruta a la lista de precacheo en `sw.js`.
4. Subir la versión de `JG_JS_V` en `index.html` y `CACHE_SHELL` en `sw.js`.

---

## 3. Auto-reconciliación en la Interfaz (`pdfController.js`)

Cuando la aplicación carga la biblioteca local de IndexedDB:
1. `completarCaratulasQueFaltan()` escanea los registros.
2. Si encuentra un libro con:
   - `!tienePortada`
   - `origenPortada === 'dibujada'`
   - `titulo === '(anonymous)'`
   - Coincidencia en `buscarPortadaCanonica()` con origen no `'real'`
3. Resuelve la carátula auténtica, actualiza IndexedDB con `origenPortada = 'real'`, y **refresca simultáneamente**:
   - La cuadrícula de libros: `pintarBiblioteca()`.
   - La tarjeta superior destacada: `pintarContinuar()`.

---

## 4. Checklist de verificación para cualquier agente

Antes de dar por finalizada cualquier tarea sobre un PDF o la biblioteca:

- [ ] ¿La página 1 del PDF adaptado es la carátula original a sangre?
- [ ] ¿El PDF tiene título y autor reales en sus metadatos (no `(anonymous)`)?
- [ ] ¿Aparece la carátula original en la tarjeta del libro dentro de la biblioteca?
- [ ] ¿Aparece la carátula original en el banner superior «Seguir leyendo»?
- [ ] ¿Aparece la carátula original en el lector?
- [ ] ¿Si se recarga sin conexión (PWA offline), la carátula sigue visible gracias al Service Worker?
