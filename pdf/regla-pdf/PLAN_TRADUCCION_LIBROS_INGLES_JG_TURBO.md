---
title: Traducir libros en inglés y adaptarlos para JG Turbo
navLabel: Traducción de libros en inglés
contentType: How-to
version: 1.0.0
updated: 2026-09-11
status: vigente
dependsOn: PLAN_OPERATIVO_DEFINITIVO_PDF_JG_TURBO.md
---

# Traducir libros en inglés y adaptarlos para JG Turbo

Este documento define el proceso obligatorio para convertir un libro en inglés en una edición española adaptada al lector PDF de JG Turbo. La traducción debe conservar significado, estructura, cifras, ejemplos, imágenes y trazabilidad. Después de traducir, el libro debe superar todas las fases de `PLAN_OPERATIVO_DEFINITIVO_PDF_JG_TURBO.md`.

## 1. Resultado esperado

Entrega estos archivos por libro:

- PDF principal en español para JG Turbo
- PDF complementario de notas y bibliografía, si corresponde
- texto inglés reconstruido y aprobado
- traducción española vinculada bloque por bloque
- glosario terminológico versionado
- archivo de decisiones editoriales
- adjunto `jg-lectura.json` en español
- informe bilingüe de cobertura y validación
- evidencia visual y auditiva

El PDF fuente permanece intacto. Identifica el resultado como una adaptación para uso en JG Turbo. No lo presentes como traducción oficial de la editorial.

## 2. Relación con el plan general

Este plan complementa el procedimiento general. Sigue este orden:

1. Ejecuta las fases 0 a 7 del plan general sobre la fuente inglesa
2. Aplica las fases de traducción definidas aquí
3. Genera una edición canónica en español
4. Retoma las fases 9 a 15 del plan general
5. Publica primero en `Candidatas/`
6. Espera la escucha humana antes de copiar a `Lectura/`

No traduzcas antes de reconstruir correctamente el texto inglés. Una traducción fluida de una extracción incompleta continúa siendo incompleta.

## 3. Fuentes inglesas pendientes verificadas

El inventario actual registra cuatro obras en `pendiente_servicio`:

| Identificador | Obra | Autor | Fuente | Volumen registrado | Estado |
|---|---|---|---|---:|---|
| `zero-to-one` | *Zero to One* | Peter Thiel y Blake Masters | PDF | 213 páginas | `pendiente_servicio` |
| `this-is-marketing` | *This Is Marketing* | Seth Godin | PDF | 201 páginas | `candidata_pendiente_escucha` |
| `extreme-ownership` | *Extreme Ownership* | Jocko Willink y Leif Babin | PDF | 311 páginas | `pendiente_servicio` |
| `the-world-as-i-see-it` | *The World as I See It* | Albert Einstein | EPUB | 0 páginas en inventario | `pendiente_servicio` |

El expediente de *The World as I See It* estima 112 páginas de texto. Resuelve la discrepancia frente a las 0 páginas del inventario antes de calcular cobertura, costo o progreso.

Los presupuestos existentes son estimaciones históricas. Recalcula volumen, modelo, tarifa y límite de gasto inmediatamente antes de autorizar un servicio externo.

## 4. Restricciones obligatorias

### 4.1 No uses servicios externos sin autorización concreta

Antes de enviar texto a un proveedor, entrega una solicitud que indique:

- libro y hash de la fuente
- proveedor y modelo exactos
- cantidad estimada de caracteres y tokens
- precio consultado y fecha de consulta
- gasto máximo autorizado
- contenido que saldrá del equipo
- política de reintentos
- proveedor alternativo, si existe
- páginas incluidas en el piloto

Si falta autorización, conserva `pendiente_servicio`. No uses automáticamente otro proveedor.

### 4.2 Conserva ambos idiomas

Nunca sobrescribas el texto inglés con la traducción. Mantén estos niveles:

```text
fuente inglesa inmutable
texto inglés reconstruido
traducción española propuesta
traducción española revisada
texto español aprobado para construcción
```

Cada nivel necesita hash y versión.

### 4.3 Traduce por identificadores

No uses `@@@`, líneas vacías ni posiciones de una lista como único vínculo. Cada solicitud y respuesta debe usar identificadores estables.

Formato mínimo:

```json
{
  "book_id": "zero-to-one",
  "source_language": "en",
  "target_language": "es",
  "prompt_version": "translate-es-1.0.0",
  "glossary_version": "1.0.0",
  "blocks": [
    {
      "id": "b00001",
      "role": "chapter",
      "source": "Chapter 1"
    }
  ]
}
```

La respuesta debe devolver exactamente los mismos identificadores, una vez cada uno y en el mismo orden.

### 4.4 No cambies el contenido para mejorar el estilo

La traducción puede corregir gramática española. No puede:

- resumir
- ampliar argumentos
- suavizar afirmaciones
- añadir explicaciones
- eliminar repeticiones del autor
- cambiar cifras, fechas o unidades
- reemplazar ejemplos culturales
- censurar lenguaje
- convertir opiniones en hechos
- insertar comentarios del traductor dentro del cuerpo

Registra cualquier aclaración necesaria fuera del texto canónico.

## 5. Estructura de trabajo bilingüe

Crea esta estructura dentro del trabajo del libro:

```text
pdf/_adaptacion_v2/trabajos/<id-libro>/
  source/
    bloques_en.json
    texto_en.txt
  translation/
    glossary.json
    requests/
    responses/
    bloques_es_propuesta.json
    bloques_es_revision.json
    cache.json
    quality_report.json
  decisiones.json
  bloques.json
  registro.json
  INFORME_FINAL_TRADUCCION_<id-libro>.md
```

No incluyas fuentes, respuestas de proveedores ni libros completos en Git. Conserva los archivos localmente y registra solo instrucciones o código que no revele el contenido.

## 6. Estados de traducción

| Estado | Significado |
|---|---|
| `pendiente_servicio` | Falta autorización o proveedor |
| `piloto_traduccion` | Se traduce una muestra representativa |
| `traduccion_en_curso` | El lote autorizado está activo |
| `traduccion_incompleta` | Faltan bloques o existe una respuesta inválida |
| `revision_bilingue` | Traducción completa pendiente de contraste |
| `traduccion_aprobada` | Correspondencia y calidad bilingüe aprobadas |
| `pendiente_escucha` | PDF español validado técnicamente |
| `aprobado` | Lectura humana completa aprobada |

Un libro no puede pasar de `pendiente_servicio` a `traduccion_en_curso` sin registrar la autorización.

## 7. Fases obligatorias

Cada fase termina con una puerta. Detén el proceso si una puerta falla.

### Fase T0: confirma alcance y salida

Define si el resultado será solo español, bilingüe para revisión o español principal con notas originales. Para JG Turbo, usa español como contenido principal y conserva el inglés en los archivos de trazabilidad.

Registra:

- variante: español neutro
- tratamiento de nombres propios
- tratamiento de títulos de obras
- tratamiento de citas
- unidades y monedas
- tono del autor
- nivel de formalidad

**Puerta T0:** el alcance y el destino están escritos en `decisiones.json`.

### Fase T1: reconstruye el inglés

Ejecuta diagnóstico, extracción, reflujo e imágenes sobre la fuente. Corrige:

- palabras cortadas por renglón
- columnas desordenadas
- ligaduras rotas
- encabezados y pies repetidos
- índices incrustados como cuerpo
- notas insertadas dentro de frases
- OCR de imágenes duplicado
- bloques verticales

No traduzcas bloques con orden dudoso. Marca `source_review_required` y resuelve la fuente primero.

**Puerta T1:** `bloques_en.json` reconstruye el contenido inglés completo y ordenado.

### Fase T2: clasifica lo que se traduce

Asigna una política a cada rol:

| Rol | Política |
|---|---|
| título y subtítulo | traducir y conservar jerarquía |
| cuerpo | traducir completo |
| cita | traducir; conservar autor y fuente |
| lista | traducir cada elemento sin cambiar cantidad ni orden |
| tabla | traducir etiquetas; conservar valores y relaciones |
| fórmula | conservar expresión; traducir explicación |
| figura | conservar imagen; añadir descripción española fiel |
| pie de figura | traducir completo o sustituir OCR defectuoso por un pie fiel |
| nota sustantiva | traducir y trasladar al anexo cuando corresponda |
| bibliografía | conservar títulos y datos editoriales; traducir solo prosa descriptiva |
| URL, correo, DOI e ISBN | conservar exactamente |
| marca o producto | aplicar glosario y uso documentado |

No traduzcas código, fórmulas, identificadores, dominios ni referencias bibliográficas como si fueran prosa.

**Puerta T2:** cada bloque tiene una política explícita.

### Fase T3: crea y aprueba el glosario

Extrae términos repetidos, técnicos, ambiguos y propios del autor. Cada entrada debe incluir:

```json
{
  "source": "power law",
  "preferred": "ley de potencias",
  "forbidden": ["ley del poder"],
  "keep_english_first_use": false,
  "context": "economía y distribución empresarial",
  "status": "approved"
}
```

Incluye títulos, conceptos centrales, métodos, cargos, términos científicos, falsos amigos, siglas y expresiones repetidas.

No adoptes automáticamente todas las propuestas antiguas. Revisa términos ambiguos como `champion`, `definiteness`, `mindset`, `cover and move` y `venture capital` dentro de su contexto.

**Puerta T3:** no quedan términos críticos con estado `pending`.

### Fase T4: prepara un piloto representativo

Selecciona entre 10 y 20 páginas que incluyan:

- portada e índice
- inicio de capítulo
- conversación o cita
- listas
- términos del glosario
- números y porcentajes
- notas
- figuras o tablas
- una página con extracción difícil

Traduce el piloto, construye un PDF parcial y pruébalo en JG Turbo. Evalúa fidelidad, naturalidad, terminología, títulos, pausas, pronunciación, costo real y tasa de reintentos.

**Puerta T4:** el piloto queda aprobado antes de traducir el libro completo.

### Fase T5: genera solicitudes estructuradas

Agrupa bloques sin partir una oración, cita, lista, tabla, título o subtítulo. No mezcles capítulos cuando no sea necesario. Respeta el límite del proveedor y deja margen para la respuesta.

Cada solicitud debe incluir identificador del libro, versiones del prompt y glosario, idiomas, roles, bloques identificados, esquema JSON y prohibición de resumir.

Calcula la clave de caché con:

```text
hash_texto_fuente + idioma_destino + proveedor + modelo
+ version_prompt + version_glosario
```

Una modificación en cualquiera de esos componentes invalida la traducción dependiente.

**Puerta T5:** todas las solicitudes pueden reanudarse sin duplicar gasto ni perder bloques.

### Fase T6: traduce el lote

El traductor debe devolver únicamente datos estructurados. Usa estas instrucciones mínimas:

```text
Traduce del inglés al español neutro.
Conserva significado, tono, cifras, negaciones, nombres y estructura.
Aplica el glosario aprobado.
No resumas, expliques, censures ni añadas información.
Devuelve todos los identificadores una vez y en el mismo orden.
Si un bloque no puede traducirse, devuelve error para ese identificador.
No escribas saludos, introducciones ni comentarios fuera del JSON.
```

Rechaza cualquier respuesta que contenga identificadores ausentes o duplicados, bloques vacíos, salida truncada, texto fuera del esquema, comentarios del modelo, inglés residual no autorizado o cambios en cifras.

Reintenta solo los bloques fallidos. No repitas solicitudes aprobadas.

**Puerta T6:** existe una traducción válida para cada bloque traducible.

### Fase T7: ejecuta controles deterministas

Exige en cada par inglés y español:

- mismo identificador
- mismo rol
- mismo orden
- misma cantidad de elementos en listas
- mismas cifras
- mismos porcentajes
- mismas fechas
- mismas monedas o conversión aprobada
- mismas unidades o equivalencia documentada
- mismas URL, correos, DOI e ISBN
- mismas referencias de figuras y tablas
- mismas negaciones lógicas
- mismos nombres propios

Detecta términos ingleses residuales. Permite únicamente los registrados en el glosario, nombres propios, marcas, títulos bibliográficos o términos técnicos aprobados.

La diferencia de cantidad de palabras no constituye un fallo por sí sola. La cobertura se valida por identificador y contenido.

**Puerta T7:** cero invariantes rotas y cero bloques sin correspondencia.

### Fase T8: realiza una segunda revisión bilingüe

La segunda revisión debe contrastar fuente y traducción. Revisa omisiones, añadidos, inversión de significado, negaciones, referentes, relaciones causales, grado de certeza, tiempos verbales, ironía, tono, terminología, citas, cifras y listas.

La retrotraducción puede detectar candidatos. No demuestra fidelidad por sí sola.

Registra cada cambio con bloque, versión anterior, versión nueva y motivo.

**Puerta T8:** todos los bloques tienen estado `approved` o una incidencia que bloquea el libro.

### Fase T9: pule el español para voz

Corrige gramática, puntuación y fluidez sin cambiar significado. Revisa concordancia, pronombres, tiempos verbales, preposiciones, calcos, falsos amigos, diálogos, abreviaturas, títulos y oraciones fragmentadas.

No conviertas el texto en adaptación libre. Si una frase literal suena rígida, reformúlala y vuelve a comprobarla contra el inglés.

**Puerta T9:** el español es natural y mantiene la misma proposición que el bloque fuente.

### Fase T10: traduce imágenes y tablas

Conserva la imagen original completa. No reemplaces cifras, escalas o etiquetas mediante edición raster sin comprobación individual.

Cuando una figura contiene texto inglés:

1. Mantén la figura original visible
2. Extrae sus etiquetas en orden
3. Crea una descripción española fiel
4. Conserva valores, colores y relaciones
5. Añade un pie oral español
6. Identifica la figura por su número original

Si recreas una tabla o figura en español, compara cada celda, rótulo y valor. Conserva una copia de la figura original en la evidencia.

No describas como conclusión lo que la figura solo muestra como correlación, comparación o ejemplo.

**Puerta T10:** toda información visual necesaria tiene acceso visual y oral en español.

### Fase T11: trata notas, citas y bibliografía

Aplica estas reglas:

- elimina del cuerpo únicamente llamadas numéricas confirmadas
- traduce notas sustantivas
- conserva datos bibliográficos
- conserva títulos oficiales de obras en inglés
- añade una traducción entre corchetes solo cuando ayude a comprender
- no inventes una edición española
- conserva páginas, volúmenes, DOI, ISBN y URL
- traduce las citas y conserva la atribución
- identifica como propia la traducción creada para JG Turbo

**Puerta T11:** las notas no interrumpen la narración y la trazabilidad bibliográfica permanece completa.

### Fase T12: crea el español canónico

Genera `bloques_es_revision.json`. Después crea `bloques.json`, que será la entrada del constructor.

Cada bloque final debe conservar:

- `id`
- `source_id`
- `rol`
- `pag`
- `source_txt`
- `txt`
- `html`
- `translation_status`
- `glossary_version`
- `prompt_version`
- `review_version`

Genera el HTML desde el texto español canónico cuando exista cualquier divergencia de palabras o espacios.

**Puerta T12:** el texto español aprobado es completo, ordenado y reproducible.

### Fase T13: construye el PDF español

Retoma el plan general desde la fase 9. Genera portada auténtica, crédito de adaptación, índice navegable en español, una columna, Caladea incrustada, imágenes completas, anexos e idioma `es-ES`.

No incluyas el índice inglés original como cuerpo narrable. No dejes fragmentos en inglés salvo los autorizados por el glosario.

**Puerta T13:** el PDF español cumple el contrato visual del plan general.

### Fase T14: valida el adjunto y la aplicación

El adjunto `jg-lectura.json` debe contener el texto español aprobado y coincidir con el PDF.

```powershell
$env:JG_PDF_ADJUNTO='ruta_de_la_candidata.pdf'
node tests/test_pdf_adjunto.mjs

$env:JG_PDF_REAL='ruta_de_la_candidata.pdf'
$env:JG_STRICT='1'
node tests/test_pdf_reales.mjs
```

Prueba `Escuchar`, `Desde aquí`, continuación y MP3. Comprueba que la aplicación usa español y no detecta el documento como inglés.

**Puerta T14:** la aplicación usa los bloques españoles completos y contiguos.

### Fase T15: revisa todas las páginas

Renderiza y revisa el 100 % de las páginas. Busca páginas parcialmente traducidas, inglés residual, palabras pegadas, signos invertidos ausentes, comillas rotas, texto vertical, imágenes cortadas, pies duplicados y páginas blancas.

**Puerta T15:** cada página tiene revisión visual registrada.

### Fase T16: escucha la edición española

Escucha el libro completo con una voz española principal. Prueba nombres ingleses, títulos, pausas, números, símbolos, siglas, citas, figuras, cambios de capítulo, guía visual, MP3 y música.

La lectura debe usar la traducción aprobada. No permitas que el motor recupere bloques ingleses de caché.

**Puerta T16:** solo la aprobación humana cambia el libro a `aprobado`.

## 8. Validadores mínimos

| Control | Resultado exigido |
|---|---:|
| Bloques fuente | total registrado |
| Bloques traducibles | total registrado |
| Bloques traducidos | 100 % |
| Identificadores ausentes | 0 |
| Identificadores duplicados | 0 |
| Bloques vacíos | 0 |
| Respuestas truncadas | 0 |
| Texto ajeno al libro | 0 |
| Cifras alteradas | 0 |
| Negaciones alteradas | 0 |
| URL, correos, DOI o ISBN alterados | 0 |
| Términos críticos inconsistentes | 0 |
| Inglés residual no autorizado | 0 |
| Figuras sin tratamiento oral | 0 |
| Diferencias PDF frente a español canónico | 0 |
| Pendientes estrictos de JG Turbo | 0 |

Un porcentaje global alto no compensa un bloque ausente. La cobertura se valida por identificador.

## 9. Pruebas negativas obligatorias

Demuestra que los validadores rechazan:

1. Un bloque omitido
2. Dos bloques intercambiados
3. Un identificador duplicado
4. Una respuesta truncada
5. Una cifra cambiada
6. Una negación eliminada
7. Una URL traducida
8. Un término inconsistente
9. Una disculpa del modelo
10. Un párrafo no traducido
11. Una lista con menos elementos
12. Una figura sin pie español
13. Un adjunto distinto del PDF
14. Una caché de otra versión del glosario

Una prueba negativa debe fallar antes de considerar confiable el validador.

## 10. Orden de los cuatro libros

Procesa un libro por vez:

1. **Zero to One:** piloto por su extensión menor entre los PDF pendientes
2. **This Is Marketing:** terminología de marketing y tono ensayístico
3. **Extreme Ownership:** volumen largo, lenguaje militar y conceptos repetidos
4. **The World as I See It:** después de corregir el inventario EPUB

No empieces el segundo libro hasta aprobar el piloto del primero. Convierte cada defecto nuevo en regla, detector y prueba.

## 11. Tratamiento del EPUB pendiente

Para *The World as I See It*:

1. Calcula hash y tamaño del EPUB
2. Cuenta documentos, capítulos, palabras e imágenes
3. Comprueba el orden del índice del paquete EPUB
4. Elimina navegación duplicada y enlaces de retorno
5. Conserva cursivas, citas e imágenes
6. Genera bloques ingleses estables
7. Corrige la discrepancia de 0 frente a 112 páginas
8. Traduce los bloques, no una conversión PDF intermedia defectuosa
9. Construye el PDF español desde los bloques aprobados

No inventes equivalencias entre páginas EPUB y PDF. Usa capítulos, identificadores y posiciones de bloque.

## 12. Informe final bilingüe

Crea `INFORME_FINAL_TRADUCCION_<id-libro>.md` con:

1. Fuente, hash y tipo de archivo
2. Proveedor, modelo y autorización
3. Volumen estimado y real
4. Gasto autorizado y real
5. Versiones de prompt y glosario
6. Bloques fuente, traducidos y revisados
7. Incidencias por categoría
8. Cambios de glosario
9. Controles deterministas
10. Revisión bilingüe
11. Pruebas de JG Turbo
12. Revisión visual completa
13. Escucha humana
14. Hash de la candidata
15. Estado final

No escribas “traducción completa” si existe un bloque pendiente. No escribas “fiel” basándote solo en retrotraducción o similitud automática.

## 13. Instrucción reutilizable

```text
Traduce y adapta únicamente el libro indicado. Lee Agents.md, TRAMPAS.md,
CAMBIOS_PDF.md, PLAN_OPERATIVO_DEFINITIVO_PDF_JG_TURBO.md y
PLAN_TRADUCCION_LIBROS_INGLES_JG_TURBO.md.

Preserva la fuente. Reconstruye y aprueba primero el texto inglés. Crea un
glosario contextual. Ejecuta un piloto de 10 a 20 páginas. No uses un
servicio externo sin autorización concreta de proveedor, modelo y gasto.

Traduce mediante bloques con identificadores estables. Conserva estructura,
significado, cifras, negaciones, nombres, listas, citas, imágenes y
referencias. Rechaza omisiones, duplicados, texto truncado, inglés residual
no autorizado y comentarios del modelo.

Realiza una segunda revisión bilingüe completa. Construye el PDF español solo
desde bloques aprobados. Después ejecuta todas las puertas técnicas, visuales
y auditivas del plan general. Publica en Candidatas/ con estado
pendiente_escucha. No copies a Lectura/ hasta recibir aprobación humana.

Entrega la candidata, el anexo, bloques ingleses, bloques españoles, glosario,
decisiones, registro e informe final con hashes y conteos.
```

## 14. Definición de terminado

- [ ] fuente inglesa intacta
- [ ] texto inglés reconstruido y aprobado
- [ ] autorización y gasto registrados
- [ ] glosario aprobado
- [ ] piloto aprobado
- [ ] 100 % de bloques traducidos
- [ ] cero identificadores ausentes o duplicados
- [ ] cifras, negaciones y referencias conservadas
- [ ] segunda revisión bilingüe completa
- [ ] español natural y fiel
- [ ] imágenes y tablas tratadas visual y oralmente
- [ ] notas y bibliografía completas
- [ ] PDF español construido desde texto aprobado
- [ ] `jg-lectura.json` completo
- [ ] pruebas estrictas aprobadas
- [ ] revisión visual completa
- [ ] escucha humana completa
- [ ] informe, hashes y catálogo actualizados
- [ ] archivo promovido a `Lectura/`

Si una casilla permanece vacía, conserva el libro fuera de `Lectura/`.
