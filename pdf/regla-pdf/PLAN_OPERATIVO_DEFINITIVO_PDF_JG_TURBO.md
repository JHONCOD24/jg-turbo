---
title: Procesar cualquier libro PDF para JG Turbo sin errores conocidos
navLabel: Proceso definitivo de PDF
contentType: How-to
version: 4.0.0
updated: 2026-09-11
status: vigente
---

# Procesar cualquier libro PDF para JG Turbo sin errores conocidos

Este documento define el procedimiento obligatorio para adaptar libros nuevos y existentes al lector PDF de JG Turbo. Un agente debe poder ejecutar el proceso usando únicamente este archivo, las reglas del repositorio y las herramientas indicadas. El resultado solo se considera candidato cuando supera todas las pruebas automáticas y visuales. Solo una escucha humana puede aprobarlo para `Lectura/`.

## 0. Regla de reinicio: ningún PDF llega adaptado

Cada asignación comienza con estado **no verificado**, aunque el nombre contenga
`adaptado`, `optimizado`, `JG Turbo`, `final`, `aprobado` o una versión anterior.
Esas palabras son antecedentes, no evidencia.

Queda prohibido cerrar una tarea con “ya estaba adaptado”, “no requiere cambios”
o “solo hice un repaso” basándose en el nombre, el inventario, un informe previo,
una carpeta `ok`, una prueba con código de salida cero o la existencia de
`jg-lectura.json`.

Antes de decidir que no hay que modificar un libro, el agente debe generar en la
ejecución actual:

1. Hash del archivo exacto que recibió y de la fuente editorial más antigua
2. Auditoría de entrada nueva, vinculada al hash y a la versión de estas reglas
3. Comparación entre fuente, bloques, PDF visible y `jg-lectura.json`
4. Inventario de todas las páginas con su tipo, texto, imágenes y resultado
5. Búsqueda contextual de OCR defectuoso, llamadas de notas, cabeceras, pies,
   índices y fragmentos verticales
6. Resultado completo de cada validador, incluidos estados y contadores internos
7. Renderizado del 100 % de las páginas y revisión a tamaño legible

Si aparece un defecto conocido, la aprobación anterior queda invalidada. Cambia
el estado a `rechazado_tecnico`, corrige la primera etapa donde nació el error y
repite las puertas dependientes. Un defecto conocido nunca se convierte en
“observación no bloqueante” cuando afecta el texto visible, la narración, el
orden, una cifra, una imagen o la fidelidad.

Si el libro realmente no requiere cambios, entrega igualmente toda la evidencia
anterior y una matriz de cero defectos. Sin esa evidencia, el resultado es
`auditoria_incompleta`, no “adaptado”.

## 1. Objetivo verificable

Transforma cada PDF fuente en una edición que cumpla estas condiciones:

- conserva el contenido y el orden semántico del libro
- presenta párrafos horizontales, completos y separados
- evita palabras pegadas, partidas, verticales o fuera de orden
- muestra cada imagen completa, legible y dentro de la página
- omite imágenes realmente vacías
- evita OCR duplicado, desordenado o visible sobre las figuras
- reemplaza el índice físico obsoleto por uno navegable
- evita que la voz lea números bibliográficos, encabezados o residuos editoriales
- pronuncia títulos, símbolos, cifras y pausas con naturalidad
- incluye un adjunto `jg-lectura.json` completo y validado
- mantiene el PDF fuente intacto
- deja evidencia reproducible de cada decisión y prueba

Ninguna herramienta automática puede garantizar ausencia absoluta de defectos. En este proceso, “sin errores” significa cobertura total de las páginas, cero defectos conocidos, todas las puertas automáticas aprobadas, revisión visual completa y escucha humana aprobada.

## 2. Autoridad y documentos que debes leer

Antes de modificar archivos, lee en este orden:

1. `Agents.md`
2. `TRAMPAS.md`, en especial las secciones 1, 6 y 9
3. `CAMBIOS_PDF.md`
4. este documento
5. el plan de traducción, si la fuente está en otro idioma
6. el informe y el registro del libro, si ya existen, solo como antecedentes

Si una regla antigua contradice este documento, aplica la regla más reciente que preserve mejor el contenido y exija más evidencia. Registra el conflicto en el informe del libro.

## 3. Principios que no se pueden omitir

### 3.1 Conserva la fuente

- No edites, muevas ni sobrescribas el PDF recibido
- Calcula su huella SHA-256 antes de procesarlo
- Guarda todos los derivados en una carpeta de trabajo separada
- Recalcula la huella de la fuente al cerrar el trabajo y exige que coincida
- No sustituyas la fuente por otra edición encontrada en Internet

### 3.2 El texto canónico manda

Cada bloque debe tener un texto canónico `txt`. El HTML solo representa estilo. Si `html` y `txt` difieren en palabras, espacios u orden, corrige el HTML o genera el bloque visual desde `txt`.

No aceptes estas diferencias:

- `combinadas con` visible como `combinadascon`
- palabras presentes en `txt` pero ausentes en el PDF
- etiquetas HTML partidas que oculten el texto posterior
- texto visible distinto del adjunto estructurado

Se permite perder cursiva o negrita en un bloque cuando conservarla ocultaría, pegaría o reordenaría palabras. Registra la decisión.

### 3.3 No confundas aprobación técnica con aprobación humana

Una ejecución con código de salida cero solo confirma que terminó el programa. Revisa también los contadores, el estado de fidelidad y los archivos producidos.

Usa estos estados:

| Estado | Significado |
|---|---|
| `inventariado` | Fuente registrada y sin procesar |
| `auditoria_incompleta` | Falta evidencia nueva de una o más puertas |
| `fuente_original_requerida` | Solo existe un derivado y no puede probarse fidelidad editorial |
| `diagnosticado` | Estructura, idioma y riesgos identificados |
| `en_revision` | Existen decisiones editoriales pendientes |
| `pendiente_servicio` | Falta traducción u otro servicio autorizado |
| `rechazado_tecnico` | Alguna puerta automática o visual falló |
| `pendiente_escucha` | Todas las puertas técnicas pasaron |
| `aprobado` | La escucha humana completa fue aceptada |

Nunca copies un archivo a `Lectura/` con estado distinto de `aprobado`.

### 3.4 Trata cada edición “optimizada” como un derivado sin comprobar

La palabra “optimizado” en el nombre no demuestra integridad. Repite diagnóstico,
extracción, revisión visual, verificación textual y escucha. Busca además la
fuente editorial anterior. Cuando exista, esa fuente es la referencia de
cobertura y el archivo optimizado es solo una candidata previa.

Si únicamente existe el archivo optimizado, no declares fidelidad total. Usa
`fuente_original_requerida`, corrige los defectos demostrables y registra que no
fue posible comprobar omisiones o alteraciones contra la edición original.

## 4. Estructura de carpetas

Mantén esta estructura:

```text
pdf/
  Libros PDF/
    Optimizados/                     Fuentes existentes, intactas
    Nuevos/                          Nuevas fuentes por procesar
  Libros listos para JG Turbo/
    Candidatas/                      Superaron todas las puertas técnicas
    Lectura/                         Aprobadas tras escucha humana
    Anexos/                          Notas y bibliografía separadas
    CATALOGO.csv
  _adaptacion_v2/
    inventario.json
    trabajos/<id-libro>/
      auditoria_entrada_<hash8>.json
      comparacion_fuente_salida.json
      matriz_hallazgos.csv
      revision_visual_paginas.csv
      decisiones.json
      registro.json
    pendientes/
  regla-pdf/
    PLAN_OPERATIVO_DEFINITIVO_PDF_JG_TURBO.md
    PLAN_TRADUCCION_LIBROS_INGLES_JG_TURBO.md
    herramientas-pdf/
```

Si `Nuevos/` no existe, créala. No mezcles fuentes con candidatas ni con entregas aprobadas.

Los cuatro archivos de auditoría son obligatorios y deben regenerarse para el
hash actual. Copiar los de una revisión anterior, cambiarles la fecha o declarar
que “siguen vigentes” no satisface la regla de reinicio.

## 5. Datos obligatorios por libro

Añade una entrada a `pdf/_adaptacion_v2/inventario.json`. No ejecutes el lote hasta completar estos campos:

```json
{
  "id": "titulo-normalizado",
  "ruta_fuente": "pdf/Libros PDF/Nuevos/libro.pdf",
  "sha256": "sha256_completo",
  "tamano_bytes": 123456789,
  "titulo": "Título editorial correcto",
  "autor": "Autor correcto",
  "edicion": "original",
  "idioma": "es",
  "paginas": 123,
  "tipo_documento": "digital",
  "fuente_utilizada": "pdf/Libros PDF/Nuevos/libro.pdf",
  "es_duplicado": false,
  "duplicado_de": null,
  "version_reglas": "4.0.0",
  "perfil_editorial": {
    "conservar_imagenes": true,
    "conservar_enfasis": true,
    "separar_notas": true,
    "traduccion_requerida": false,
    "paginas_omitir": []
  },
  "estado": "inventariado"
}
```

No reutilices un identificador para dos contenidos distintos. Si dos archivos tienen el mismo SHA-256, registra el duplicado y procesa una sola salida.

## 6. Flujo obligatorio por libro

Cada fase termina con una puerta. Si falla una puerta, detén la publicación, corrige la causa y repite todas las fases dependientes.

### Fase 0: protege el trabajo existente

Ejecuta desde la raíz del repositorio:

```powershell
git status --short --branch
```

Registra archivos modificados y no rastreados. No sobrescribas cambios de otro agente. No uses limpieza masiva, `reset --hard` ni restauraciones globales.

**Puerta 0:** conoces el estado del repositorio y la ruta absoluta de la fuente.

### Fase 1: identifica y diagnostica la fuente

Calcula SHA-256, tamaño, páginas, cifrado, idioma y tipo de contenido. Clasifica cada página como una de estas opciones:

- texto digital
- texto escaneado
- portada
- índice
- cuerpo
- tabla
- fórmula
- figura con texto
- lámina completa
- notas o bibliografía
- publicidad o material ajeno
- blanco real
- contenido dudoso

Construye también la cadena de procedencia:

```text
fuente editorial original -> derivado previo -> candidata actual -> adjunto de lectura
```

Compara hashes y rutas. No tomes un derivado ubicado en `Optimizados/`,
`Candidatas/`, `PDFs Listos/` o con “adaptado” en el nombre como fuente editorial
si existe un archivo anterior. Si no existe, activa
`fuente_original_requerida`.

La auditoría de entrada debe incluir por página: número físico, tipo, cantidad de
caracteres, palabras, imágenes, rotación, bloques verticales, texto aislado,
cabecera, pie, llamada bibliográfica y anomalías OCR.

Renderiza todas las páginas como miniaturas. No uses solo la extracción de texto. Una página sin texto puede contener una imagen esencial.

Las herramientas individuales leen y escriben archivos en la carpeta de trabajo actual. Define las rutas, registra la fuente y entra en esa carpeta antes de ejecutarlas:

```powershell
$repo = (Resolve-Path 'C:\Users\juanl\Documents\Proyectos\jg-turbo').Path
$book_id = 'id_del_libro'
$source_pdf = 'ruta_absoluta_del_pdf'
$workdir = Join-Path $repo "pdf\_adaptacion_v2\trabajos\$book_id"
Get-FileHash -Algorithm SHA256 -LiteralPath $source_pdf
python -c "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); print(d.page_count, d.is_encrypted)" $source_pdf
New-Item -ItemType Directory -Force -Path $workdir | Out-Null
Set-Location $workdir
python "$repo\pdf\regla-pdf\herramientas-pdf\1_diagnosticar.py" $source_pdf
```

Revisa `perfil.json`. Define bandas de cabecera y pie por repetición real. Nunca uses una franja amplia que pueda borrar cuerpo.

**Puerta 1:** la procedencia está resuelta, todas las páginas están clasificadas
y cada excepción tiene una decisión explícita. Un libro sin fuente editorial
identificable no puede recibir la etiqueta `fidelidad_verificada`.

### Fase 2: selecciona el inicio, final y páginas omitidas

Usa `empezar_en`, `terminar_en` y `paginas_omitir` solo para contenido identificado. Puedes omitir:

- índices físicos que serán regenerados
- páginas realmente blancas
- publicidad ajena al libro
- duplicados exactos

No omitas prólogos, créditos, epígrafes, pies, notas sustantivas, tablas, fórmulas o imágenes por parecer difíciles.

Si omites el índice original, comprueba que sus títulos aparecen en los encabezados reales y que el índice nuevo los incluye. El índice original nunca debe quedar como un párrafo continuo dentro del cuerpo.

**Puerta 2:** cada omisión está registrada con página, motivo y evidencia visual.

### Fase 3: extrae estructura y geometría

Ejecuta:

```powershell
python "$repo\pdf\regla-pdf\herramientas-pdf\2_extraer.py"
```

Conserva por bloque:

- identificador estable
- página fuente
- caja geométrica
- rol editorial
- texto original
- texto canónico
- HTML de presentación
- nivel de sangría
- referencia de imagen o tabla
- transformación aplicada
- motivo de la transformación

Ordena columnas mediante geometría. No confíes en el orden interno del PDF cuando la página tiene dos columnas, palabras rotadas o bloques flotantes.

**Puerta 3:** el orden de lectura reconstruye cada página sin saltos, inversiones ni duplicados.

### Fase 4: recompone palabras y párrafos

Ejecuta:

```powershell
python "$repo\pdf\regla-pdf\herramientas-pdf\3_reflujo.py"
python "$repo\pdf\regla-pdf\herramientas-pdf\3b_auditar.py"
```

Aplica estas reglas:

1. Une palabras partidas por guion solo cuando la geometría y el diccionario indiquen partición de renglón
2. Conserva guiones léxicos, rangos, signos menos y diálogos
3. Une fragmentos consecutivos que pertenecen a una oración
4. Conserva párrafos separados cuando el anterior termina con cierre real o existe separación editorial
5. No uses únicamente la sangría para separar bloques
6. Trata una sucesión de bloques de una o dos palabras como posible texto vertical roto
7. Compara `txt` y `html` después de cada unión

Para detectar el defecto de palabras verticales, marca una página cuando existan tres o más bloques consecutivos de cuerpo con una o dos palabras. Revisa esa página contra el original. Une los bloques solo si forman la misma oración y mantienen el orden geométrico.

Ejemplos de fallo:

```text
con
la
plasticidad
neuronal
```

Resultado esperado:

```text
con la plasticidad neuronal
```

No generalices una corrección de un libro mediante páginas codificadas en el script central. Expresa la excepción en `perfil.json` o en un archivo de decisiones del libro.

**Puerta 4:** cero secuencias verticales sin justificar, cero palabras pegadas y cero párrafos fuera de orden.

### Fase 5: corrige gramática sin cambiar el contenido

Revisa todos los bloques, no una muestra. Corrige únicamente errores comprobables:

- espacios ausentes o duplicados
- letras perdidas por extracción
- palabras partidas
- puntuación dañada
- concordancia rota por OCR
- nombres propios comprobados en la fuente
- residuos de cabecera y pie
- mensajes de traductor o de modelo ajenos al libro

Mantén una bitácora antes y después por bloque. No resumas, suavices, amplíes ni cambies las ideas del autor.

Los títulos impresos no necesitan punto visible. La capa de voz debe insertar la pausa estructural. Si el generador necesita una marca visible para evitar lectura corrida, documenta esa excepción y comprueba que no duplica signos.

**Puerta 5:** cada modificación léxica tiene origen, resultado, motivo y revisión.

### Fase 6: separa notas y referencias

Detecta llamadas bibliográficas mediante tamaño, posición, superíndice, vínculo y correspondencia con una nota real. No borres números mediante una expresión regular global.

Conserva:

- fechas
- cantidades
- porcentajes
- enumeraciones
- números de capítulos y figuras
- exponentes y fórmulas
- referencias necesarias para comprender el texto

Retira de la narración solo las llamadas bibliográficas confirmadas. Traslada la nota completa al anexo. Conserva una relación entre el bloque de origen y su nota.

Si la separación automática no es inequívoca, marca `en_revision`. No publiques para conseguir una prueba verde.

**Puerta 6:** ninguna llamada bibliográfica interrumpe la frase y ningún número significativo desaparece.

### Fase 7: procesa imágenes, tablas y fórmulas

Ejecuta:

```powershell
python "$repo\pdf\regla-pdf\herramientas-pdf\4_imagenes.py"
```

Revisa todas las imágenes con estas pruebas:

1. **Vacío real:** descarta una imagen cuando al menos el 99,7 % de una muestra en escala de grises sea blanco y la revisión visual confirme que no contiene información
2. **Límites:** exige `x0 >= 0`, `y0 >= 0`, `x1 <= ancho_pagina` y `y1 <= alto_pagina`
3. **Integridad:** compara el cuadro de contenido de la fuente y el derivado
4. **Legibilidad:** comprueba títulos, escalas, leyendas, pies y texto interno a resolución completa
5. **Unidad:** conserva una página gráfica original por página final, salvo que la fuente ya sea una composición única
6. **Orientación:** rota la figura y su lectura juntas
7. **Nitidez:** evita recomprimir texto pequeño hasta volverlo ilegible

Si el extractor recorta la parte inferior de una página gráfica, renderiza la página fuente completa. Recorta únicamente el margen blanco exterior con un umbral conservador. Conserva todo el cuadro de contenido.

Si una imagen contiene texto y el OCR repite ese contenido debajo de ella:

- conserva la reproducción visual completa
- elimina la capa OCR duplicada del cuerpo
- redacta un pie oral breve y fiel
- conserva cifras y relaciones visibles
- no inventes una interpretación científica o editorial
- valida que el pie aparezca tanto en el PDF como en `jg-lectura.json`

Las tablas y fórmulas necesitan dos representaciones:

- representación visual completa
- representación oral fiel y vinculada al mismo bloque

**Puerta 7:** cero imágenes blancas, recortadas, fuera de margen, superpuestas o combinadas por accidente.

### Fase 8: traduce cuando corresponda

Para cualquier fuente en inglés, ejecuta íntegramente
`PLAN_TRADUCCION_LIBROS_INGLES_JG_TURBO.md`. Sus fases T0 a T16 desarrollan
esta puerta y prevalecen como procedimiento específico de traducción.

No traduzcas un libro sin autorización para el servicio externo y el gasto. Si el usuario pospone la traducción, usa `pendiente_servicio`.

Cuando traduzcas:

1. Reconstruye primero el texto fuente
2. Traduce por bloques identificados
3. Conserva estructura, cifras, negaciones, ejemplos y referencias
4. Usa español neutro
5. Mantén un glosario por libro
6. Revisa cada bloque contra su origen
7. Rechaza respuestas vacías, truncadas o con instrucciones del modelo
8. Comprueba cobertura completa

No uses igualdad de caracteres entre idiomas. Exige correspondencia de bloques y revisión bilingüe.

**Puerta 8:** todos los bloques fuente tienen traducción válida o el libro permanece pendiente.

### Fase 9: construye el PDF principal y el anexo

Ejecuta:

```powershell
python "$repo\pdf\regla-pdf\herramientas-pdf\5_construir.py" "Título" "Autor"
```

El PDF principal debe usar:

- tamaño A5
- una columna
- fuente Caladea incrustada
- texto sin silabeo automático
- párrafos separados
- títulos con jerarquía consistente
- portada auténtica
- índice regenerado con enlaces
- marcadores por capítulo y sección
- idioma `es-ES`
- cero cabeceras y números de página extraíbles

No incluyas el índice original en el cuerpo. No permitas dos saltos de página consecutivos. No dejes una figura separada de su pie.

**Puerta 9:** el archivo abre, tiene metadatos correctos y su diseño coincide con el contrato.

### Fase 10: añade y valida `jg-lectura.json`

El adjunto debe incluir:

- versión compatible
- identificador y revisión
- título, autor e idioma
- hash de la fuente
- perfil musical
- cantidad total de bloques
- identificador único por bloque
- rol, texto, página, nivel e imagen de cada bloque

El contenido del adjunto debe aparecer completo, contiguo y en el mismo orden dentro del PDF. Rechaza adjuntos truncados, alterados, repetidos o con versión desconocida.

**Puerta 10:** el lector acepta el adjunto y no cae a la extracción ordinaria.

### Fase 11: prepara la voz

Aplica la normalización en el camino real de `Escuchar`, `Desde aquí`, continuación y MP3.

Comprueba como mínimo:

- `#1` se pronuncia “número uno”
- `#etiqueta` conserva el sentido de etiqueta social
- URLs y correos no se rompen
- títulos reciben 700 ms de pausa
- capítulos reciben 1.000 ms de pausa
- paréntesis, comillas e interrogaciones no anulan la pausa
- fechas, porcentajes, monedas, unidades y fórmulas conservan su significado
- la normalización es idempotente
- las expansiones orales no desplazan la guía visual

No cambies el PDF para resolver un símbolo que corresponde a la capa de voz.

**Puerta 11:** la misma entrada produce voz estable en todos los recorridos de reproducción.

### Fase 12: ejecuta el lote estricto

Desde la raíz del repositorio:

```powershell
Set-Location $repo
python pdf/_adaptacion_v2/lote_adaptador.py id_del_libro
```

El lote debe completar, en este orden:

1. diagnóstico
2. perfil
3. extracción
4. reflujo
5. imágenes
6. notas y anexo
7. construcción
8. comparación secuencial
9. comparación con PDF.js
10. adjunto estructurado
11. prueba real estricta de la aplicación
12. generación de una candidata provisional dentro de la carpeta de trabajo

No copies a `Candidatas/` desde el lote. La publicación ocurre después de las
puertas independientes y de la revisión visual completa.

**Puerta 12:** el lote genera una candidata provisional reproducible, conserva
todos sus registros y no oculta advertencias ni estados pendientes.

### Fase 13: ejecuta verificaciones independientes

Repite fuera del lote la validación de la candidata provisional exacta:

```powershell
$env:JG_PDF_ADJUNTO='pdf/_adaptacion_v2/trabajos/id-del-libro/candidata_con_adjunto.pdf'
node tests/test_pdf_adjunto.mjs

$env:JG_PDF_REAL='pdf/_adaptacion_v2/trabajos/id-del-libro/candidata_con_adjunto.pdf'
$env:JG_STRICT='1'
node tests/test_pdf_reales.mjs
```

Ejecuta también las suites de texto, continuidad, voz, pausas y música que correspondan. Registra el número exacto de comprobaciones. Una suite que termina antes o ejecuta menos casos es un fallo.

Evalúa el contenido de la salida, no solo el código del proceso. Cualquiera de
estos resultados bloquea el libro aunque el comando termine con código 0:

- `fidelidad=pendiente_revision`
- `pendientes` mayor que cero
- transformaciones sin revisión individual o por regla demostrada
- páginas sin texto que no tengan imagen o justificación comprobada
- advertencias de renderizado que impidan verificar la página
- frases como “sin cortes” cuando siguen existiendo OCR, notas, cabeceras o pies
- una cantidad de pruebas inferior a la esperada

`pendientes=0` solo significa que ese detector no encontró límites por resolver.
No prueba gramática, OCR, orden, integridad editorial, imágenes ni naturalidad.

**Puerta 13:** cero fallos, cero advertencias sin resolver, estado explícito
`fidelidad_verificada`, cero transformaciones sin respaldo y conteos completos.

### Fase 14: revisa visualmente el 100 % de las páginas

Renderiza todas las páginas. Genera hojas de contacto para localizar anomalías y abre a resolución completa cada página marcada.

`pdf/_adaptacion_v2/hoja_contacto.py` solo muestra cinco páginas representativas por libro. Úsalo para orientación inicial. No lo presentes como revisión completa. La puerta final exige renderizar y contabilizar todas las páginas.

La revisión debe comprobar:

- portada completa
- índice ordenado
- inicios y finales de capítulos
- continuidad en cambios de página
- cero palabras verticales
- cero palabras pegadas
- cero párrafos superpuestos
- cero líneas fuera del margen
- cada imagen completa
- texto interno de imágenes visible
- pies legibles
- tablas y fórmulas completas
- cero páginas vacías no justificadas
- una imagen por página gráfica cuando corresponda
- últimas páginas y anexo completos

Las hojas de contacto ayudan a detectar problemas, pero no prueban legibilidad. Abre a tamaño completo todas las figuras con texto pequeño y todas las páginas que hayan cambiado.

Genera `revision_visual_paginas.csv` con una fila por página y estas columnas:

```text
pagina,render_sha256,revisor,fecha,zoom,texto,orden,imagenes,margenes,
cabecera_pie,notas,resultado,incidencia
```

No aceptes frases globales como “revisé tres tercios”, “hoja de contacto
correcta” o “estructura uniforme”. El número de filas debe ser idéntico al
número de páginas del PDF. Una miniatura no permite aprobar texto pequeño,
tablas, figuras, OCR ni palabras verticales.

Antes de aprobar una página, busca en su texto: tokens improbables, letras
separadas, palabras de una sola letra encadenadas, símbolos sustituidos,
números aislados, llamadas adyacentes a puntuación, cabeceras, pies y contenido
duplicado. Cada candidato se resuelve comparándolo con la imagen de la fuente.

**Puerta 14:** todas las páginas tienen una fila válida y estado
`aprobada_visual`. Cualquier excepción mantiene `rechazado_tecnico`.

Solo después de superar esta puerta copia el archivo a `Candidatas/` y cambia el
estado a `pendiente_escucha`.

### Fase 15: escucha y aprueba

La persona responsable debe escuchar el libro completo con una voz principal. También debe probar fragmentos críticos con cada familia de voz habilitada.

Incluye estos casos:

- índice y navegación
- títulos y subtítulos
- primer y último párrafo de cada capítulo
- números, símbolos y abreviaturas
- pies de figuras
- listas y citas
- transición entre páginas
- transición entre capítulos
- pausas y reanudación
- descarga MP3
- música aislada y mezclada con voz

Registra minuto, bloque, defecto, corrección y resultado de la repetición.

**Puerta 15:** solo una confirmación humana explícita cambia el estado a `aprobado` y permite copiar el PDF a `Lectura/`.

## 7. Detectores mínimos obligatorios

Cada libro debe producir un informe con estos contadores:

| Detector | Resultado exigido |
|---|---:|
| Páginas fuente inventariadas | total físico |
| Páginas finales | total físico |
| Páginas sin texto ni imagen | 0 o justificadas |
| Imágenes completamente blancas | 0 |
| Imágenes fuera de página | 0 |
| Páginas con varias imágenes independientes | 0 o justificadas |
| Fragmentos verticales sospechosos | 0 |
| Tokens OCR sospechosos | 0 pendientes de contraste |
| Secuencias de palabras de una letra | 0 pendientes de contraste |
| Números aislados fuera de índice, lista o fórmula | 0 |
| Cabeceras o pies dentro del texto narrable | 0 |
| Palabras partidas por guion de renglón | 0 |
| Palabras pegadas por divergencia HTML | 0 |
| Dobles espacios | 0 |
| Caracteres de control | 0 |
| Llamadas bibliográficas en cuerpo | 0 |
| Residuos de OCR duplicado | 0 |
| Residuos de traductor o modelo | 0 |
| Bloques sin identificador | 0 |
| Identificadores duplicados | 0 |
| Diferencias no justificadas | 0 |
| Pendientes estrictos de la app | 0 |
| Estado de fidelidad | `fidelidad_verificada` |
| Páginas con registro visual | igual al total final |

No conviertas una excepción en tolerancia global. Regístrala por libro, página y bloque.

Un detector con cero hallazgos no sustituye el contraste humano. Si el texto
contiene un término que parece correcto pero no lo es, la revisión visual contra
la fuente debe encontrarlo. Mantén una lista de candidatos, decisión y evidencia,
incluidos los falsos positivos.

## 8. Protocolo aprendido de “El placebo eres tú”

La revisión 9 de este libro establece el caso de referencia. Los defectos y soluciones generalizables son:

| Defecto | Causa | Solución permanente |
|---|---|---|
| Índice con números corridos | El índice original se trató como cuerpo | Omitir la página fuente y regenerar un índice navegable |
| Palabras en vertical | Una oración quedó dividida en bloques de una palabra | Detectar secuencias cortas y unirlas con geometría y puntuación |
| Palabras visualmente pegadas | `html` perdió espacios que `txt` sí conservaba | Generar el cuerpo desde el texto canónico cuando diverjan |
| Imágenes blancas | La fuente contenía láminas sin información | Detectar blancura, confirmar visualmente y omitir |
| Imágenes cortadas | Se reutilizó un recorte parcial del contenido | Renderizar la página gráfica completa y recortar solo el margen blanco |
| Dos figuras en una página | El reflujo trató láminas como imágenes ordinarias | Marcar páginas gráficas como láminas y forzar una por página |
| OCR repetido bajo la figura | La capa OCR reprodujo texto ya visible | Retirar el duplicado y escribir un pie oral breve y fiel |

El agente no debe copiar números de página ni nombres de funciones específicas de este caso a otro libro. Debe aplicar los detectores y registrar las páginas afectadas en el perfil del libro.

### 8.1 Auditoría de control del 11 de septiembre de 2026

Esta auditoría explica por qué una salida previa no sirve como prueba de una
nueva asignación.

| Libro revisado | Evidencia nueva | Decisión obligatoria |
|---|---|---|
| *El placebo eres tú*, revisión integral v9 | 426 páginas, 61 páginas con imágenes; las páginas muestreadas conservan composición horizontal y figuras legibles | Puede usarse como referencia visual, pero cada ejecución debe revalidar su hash y todas las puertas |
| *El aprendiz de brujo* | La candidata de 463 páginas contiene OCR como `This Oí`, `D-Padcrboro`, `Spatn`, `concreía`, `conflicliva`, `infarKia` y `upo de`; la página PDF 47 apila “Impreso en los talleres gráficos de” verticalmente; el adjunto conserva los mismos residuos | `rechazado_tecnico` hasta reconstruir desde una fuente editorial verificable, corregir OCR, índice y orden visual |
| *Pre-suasión* | La candidata principal tiene 360 páginas y el anexo 186; el informe reconoce 92 llamadas numéricas residuales en la narración y las llamó “no bloqueantes”; una búsqueda actual detecta al menos 109 bloques candidatos como `momento».1` y `troceadas.3` | `rechazado_tecnico` hasta retirar las llamadas del cuerpo narrable, vincularlas al anexo y repetir voz y cobertura |

En *El aprendiz de brujo* y *Pre-suasión*, `tests/test_pdf_reales.mjs` terminó
con código 0 y `pendientes=0`, pero también produjo
`fidelidad=pendiente_revision`. Por esta regla, ambos resultados son fallos de la
puerta 13. El mensaje “Libro real reconstruido sin cortes sin resolver” no
autoriza la publicación.

En *El aprendiz de brujo*, la ruta registrada como fuente apunta a un archivo
llamado “edición adaptada”. Mientras no se localice una fuente editorial anterior,
no se puede certificar cobertura ni corregir con seguridad todos los errores OCR.

En *Pre-suasión*, separar las notas al anexo no permite conservar sus llamadas en
la voz. La comparación de fidelidad debe distinguir contenido sustantivo de
marcas de navegación. Quitar del flujo narrable una llamada confirmada no es una
omisión del libro cuando la nota permanece íntegra y trazable en el anexo.

El informe anterior de *Pre-suasión* afirma que existe una copia principal y un
anexo en `pdf/PDFs Listos/`. En la revisión actual, esa carpeta solo contiene
*El aprendiz de brujo* y *El placebo eres tú*. Un informe no puede declarar una
entrega sin volver a comprobar la existencia física, tamaño y hash de cada ruta
al finalizar.

## 9. Trabajo técnico pendiente antes del lote completo

La solución actual de “El placebo eres tú” contiene lógica específica dentro de `pdf/_adaptacion_v2/lote_adaptador.py`. Antes de aplicarla masivamente, parametriza estos comportamientos:

1. Detección de fragmentos verticales por cantidad de palabras, continuidad y geometría
2. Exclusión de índices físicos mediante clasificación de página
3. Comparación automática entre `txt` y `html`
4. Detección de recorte de figuras mediante cuadros de contenido
5. Conversión de páginas gráficas a láminas individuales
6. Detección de OCR duplicado entre imagen y texto de página
7. Almacenamiento de pies orales en un archivo de decisiones por libro
8. Sincronización verificable entre PDF, bloques y `jg-lectura.json`

No proceses todos los libros con rangos de páginas codificados para “El placebo eres tú”. Primero convierte esas decisiones en opciones de perfil o detectores generales con pruebas negativas.

## 10. Archivo de decisiones por libro

Crea `pdf/_adaptacion_v2/trabajos/<id-libro>/decisiones.json` con esta forma:

```json
{
  "version_reglas": "4.0.0",
  "paginas_omitidas": [
    {"pagina": 4, "motivo": "indice_fuente_regenerado"}
  ],
  "fragmentos_unidos": [
    {"pagina": 5, "bloques": [12, 13, 14], "motivo": "misma_oracion"}
  ],
  "paginas_graficas": [
    {"pagina": 347, "modo": "pagina_completa", "pie_oral": "Figura 10.2…"}
  ],
  "imagenes_omitidas": [
    {"pagina": 372, "motivo": "blanco_confirmado"}
  ],
  "cambios_editoriales": []
}
```

El agente debe poder regenerar el mismo resultado usando la fuente, el inventario, este archivo y la versión de las herramientas.

## 11. Informe final obligatorio

Crea `INFORME_FINAL_<id-libro>.md` dentro de la carpeta de trabajo. Incluye:

1. Ruta y SHA-256 de la fuente
2. Ruta y SHA-256 de la candidata
3. Versión de reglas y revisión del libro
4. Páginas, palabras, bloques e imágenes
5. Cambios editoriales con página y motivo
6. Páginas omitidas
7. Notas separadas y ruta del anexo
8. Traducción y proveedor, si aplica
9. Resultados de cada prueba con conteo
10. Resultado de la revisión visual completa
11. Resultado de la escucha
12. Perfil musical y estado de su escucha
13. Riesgos o límites pendientes
14. Estado final

Antes de cerrar el informe, vuelve a consultar cada ruta declarada y registra
`existe`, tamaño y SHA-256. La ruta inexistente, el hash distinto o una copia que
no contiene la revisión auditada bloquean la entrega.

No escribas “verificado” si solo ejecutaste una prueba sintética. No escribas
“aprobado” si falta escucha. No escribas “falta solo escucha” si persiste un
defecto conocido, una advertencia sin resolver o un estado interno pendiente.

## 12. Qué hacer cuando aparezca un fallo

Sigue este orden:

1. Reproduce el fallo con la candidata exacta
2. Identifica la página física y la página mostrada por la aplicación
3. Compara fuente, bloques, PDF construido y texto leído por PDF.js
4. Corrige la primera etapa donde aparece la divergencia
5. Añade una prueba negativa que falle antes de la corrección
6. Regenera solo el libro afectado
7. Repite todas las puertas dependientes
8. Sube una nueva revisión
9. Elimina de la biblioteca la revisión anterior y vuelve a importar la nueva

No tapes el defecto en la capa de voz si el PDF visible ya está mal. No modifiques el texto visible cuando el problema pertenece únicamente a la pronunciación.

## 13. Instrucción reutilizable para cualquier agente

Copia esta instrucción al asignar un libro:

```text
Trabaja únicamente en el libro indicado. Lee Agents.md, TRAMPAS.md,
CAMBIOS_PDF.md y
pdf/regla-pdf/PLAN_OPERATIVO_DEFINITIVO_PDF_JG_TURBO.md.

Si la fuente está en inglés, lee y ejecuta también
pdf/regla-pdf/PLAN_TRADUCCION_LIBROS_INGLES_JG_TURBO.md. Completa sus puertas
T0 a T16 antes de continuar con la candidata española.

Empieza suponiendo que el archivo NO está verificado. No aceptes como prueba
su nombre, carpeta, inventario, informe anterior, adjunto ni una ejecución con
código 0. No respondas “ya estaba adaptado”. Genera evidencia nueva para el
hash actual y aplica la regla de reinicio de la sección 0.

Preserva el PDF fuente. Registra SHA-256, inventario y perfil. Ejecuta las
dieciséis fases y no saltes ninguna puerta. Revisa el 100 % de las páginas y
abre a resolución completa todas las páginas con imágenes, OCR, tablas,
fórmulas, columnas, texto vertical o poco texto. Corrige estructura,
espacios, índice, referencias, imágenes y lectura sin resumir ni cambiar las
ideas del autor.

Publica únicamente en Candidatas/ cuando todas las validaciones automáticas
y visuales pasen. Mantén el estado pendiente_escucha hasta que una persona
escuche y apruebe el libro. No copies nada a Lectura/ por decisión propia.

Entrega el PDF candidato, su anexo si corresponde, decisiones.json,
registro.json e INFORME_FINAL_<id-libro>.md. Incluye comandos, conteos,
hashes, páginas revisadas, defectos corregidos y pendientes reales.

Si encuentras un solo defecto visible, narrable o editorial, usa
rechazado_tecnico, corrígelo y repite las puertas dependientes. Si no encuentras
defectos, entrega igualmente revision_visual_paginas.csv con una fila por
página y demuestra fidelidad_verificada. Sin esos archivos la auditoría es
incompleta.
```

## 14. Secuencia recomendada para procesar la biblioteca

Procesa un libro por vez. Usa este orden:

1. Libros en español con texto digital
2. Libros en español con imágenes y notas
3. Libros escaneados u OCR complejo
4. Libros pendientes de traducción

Empieza cada grupo con un piloto. No inicies el siguiente lote hasta escuchar y aprobar el piloto. Una corrección descubierta en el piloto debe convertirse en regla, detector y prueba antes de continuar.

## 15. Definición de terminado

Un libro está terminado solo cuando se cumplen todas estas condiciones:

- [ ] fuente intacta y hash confirmado
- [ ] fuente editorial original identificada o límite de procedencia declarado
- [ ] auditoría nueva vinculada al hash y a reglas 4.0.0
- [ ] inventario y perfil completos
- [ ] todas las páginas clasificadas
- [ ] texto y orden validados
- [ ] gramática revisada sin alterar significado
- [ ] índice original retirado y nuevo índice probado
- [ ] referencias tratadas sin borrar números válidos
- [ ] imágenes completas y legibles
- [ ] cero imágenes blancas o fuera de margen
- [ ] cero OCR duplicado
- [ ] cero tokens OCR pendientes de contraste
- [ ] cero llamadas bibliográficas en el flujo narrable
- [ ] cero cabeceras, pies o números de página narrables
- [ ] tablas y fórmulas conservadas
- [ ] traducción completa, si aplica
- [ ] PDF y anexo verificados
- [ ] `jg-lectura.json` completo y aceptado
- [ ] pruebas estrictas con conteos completos
- [ ] estado interno `fidelidad_verificada`
- [ ] revisión visual del 100 % registrada
- [ ] escucha humana completa aprobada
- [ ] perfil musical escuchado y aprobado o música desactivada
- [ ] informe final y catálogo actualizados
- [ ] candidata promovida a `Lectura/`

Si una casilla permanece vacía, el libro no está terminado.

## Apéndice A. Reglas técnicas consolidadas

Este apéndice conserva las reglas todavía válidas de los documentos históricos.
No consultes esos documentos para ejecutar un libro.

### A.1 Familias de origen

Clasifica primero la fuente porque las reglas pueden ser opuestas:

| Señal | PDF editorial | EPUB convertido |
|---|---|---|
| Maquetación | páginas grandes, texto justificado | páginas pequeñas y fragmentos por línea base |
| Guiones al final de línea | suelen ser particiones silábicas | suelen ser guiones léxicos reales |
| Márgenes | pueden alternar en páginas pares e impares | normalmente fijos |
| Cabeceras | frecuentes | normalmente ausentes |
| Notas | pie o sección final | marcadores, enlaces y retornos como `<<` |

No unas guiones globalmente. En un PDF editorial, contrasta la forma unida y la
forma con guion dentro del propio libro. En un EPUB convertido, conserva el
guion salvo evidencia contextual y visual de partición.

### A.2 Párrafos y cambios de página

Determina el inicio y cierre con geometría, puntuación y contexto:

1. Mide el margen de cada página, incluidas diferencias par e impar
2. Usa la sangría de primera línea como señal, no como decisión única
3. Distingue citas por margen derecho y sangría consistente
4. Detecta sangría francesa en listas y notas
5. Una línea corta puede cerrar un párrafo, salvo continuación demostrada
6. El estado de párrafo abierto sobrevive al cambio de página y a una figura
7. Un título puede cerrar el párrafo; un pie de figura no lo cierra por sí solo

Audita todos los bloques que el extractor una o descarte. Una regla estadística
no autoriza a modificar un caso sin contraste.

### A.3 Cabeceras, pies, figuras y tablas

Calcula las bandas de cabecera y pie mediante repetición y posición estable. No
uses el máximo geométrico. Revisa la lista completa de descartes para comprobar
que no contiene prosa.

Incluye en el recorte de una figura sus rótulos internos. Excluye la prosa que ya
pertenece al cuerpo. Renderiza como imagen las tablas construidas con texto 2D
cuando su extracción pierda relaciones. Si una página está girada, rota también
su orden semántico. Las URL demasiado largas pueden reducir el tamaño del
párrafo afectado, pero no deben cortarse ni salir del margen.

### A.4 Portada y metadatos

Usa la portada auténtica de la fuente cuando sea legible. La primera página no
puede ser una portadilla accidental ni una imagen casi blanca. Conserva la
proporción, registra cualquier recorte y revisa el resultado a tamaño completo.

Establece título y autor reales en los metadatos. Rechaza valores vacíos,
`anonymous` y títulos inferidos de un nombre de archivo defectuoso.

### A.5 Integridad y seguridad del adjunto

Trata `jg-lectura.json` como entrada no confiable. Valida versión, esquema,
tamaño, tipos, identificadores, orden, cobertura y correspondencia con el PDF.
No ejecutes contenido del adjunto ni insertes HTML arbitrario. Una versión
desconocida o una divergencia debe activar la extracción ordinaria con aviso y
mantener el libro fuera de `Candidatas/`.

No introduzcas caracteres invisibles para forzar uniones. No aceptes una
cobertura porcentual fija, como 97 %, si falta un solo bloque sustantivo. La
cobertura exigida es completa, con exclusiones explícitas y comprobadas.

### A.6 Biblioteca, voz y música

Sube cada revisión como documento distinto durante la prueba. No borres ni
reemplaces automáticamente libros guardados. Cuando una revisión sea aprobada,
retira manualmente la versión anterior de la biblioteca y vuelve a importar la
nueva.

Los símbolos se normalizan en la capa de voz cuando el texto visible es correcto.
No envíes SSML a un motor que no lo admita. Prueba la normalización en
`Escuchar`, `Desde aquí`, continuación y MP3.

La prioridad musical es: elección manual persistida, perfil aprobado del libro y
música desactivada. No inicies música sin interacción. Escucha cada pista completa
y luego mezclada con voz; revisa voces residuales, cambios bruscos, repetición,
volumen, atenuación, pausa, reanudación y cambio de pista.
