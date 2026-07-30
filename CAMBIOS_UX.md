# Mejoras de experiencia de usuario

Fecha: 2026-07-29

## Objetivo

Mejorar la claridad y la disposición de los flujos de Micrófono, Archivo,
YouTube y Traducir, conservando la identidad visual de JG Turbo y sin cambiar
las claves `jg_*` guardadas en `localStorage`.

## Cambios implementados

### Navegación general

- Las cuatro pestañas conservan icono y nombre también en celular.
- La navegación usa semántica de pestañas y permite cambiar con flechas,
  Inicio y Fin desde el teclado.
- Se añadió un enlace para saltar directamente a la herramienta.
- Cada panel oculto queda fuera de la navegación hasta que se selecciona.

### Micrófono

- La transcripción queda visible dentro del panel, con el título
  `Resultado editable`.
- `Editar en grande` comunica mejor la función del antiguo icono de expandir.
- Las opciones de dictado empiezan plegadas y resumen el idioma y el número de
  opciones activas.
- La escucha del resultado se presenta como una opción secundaria plegable.
- Al terminar una grabación se muestra el resultado en el panel actual; no se
  abre automáticamente una ventana que interrumpa el flujo.

### Archivo

- El orden ahora sigue la tarea real: elegir archivo, configurar idiomas y
  transcribir.
- Los selectores tienen etiquetas visibles.
- El botón principal permanece desactivado hasta elegir un archivo y explica
  por qué todavía no se puede usar.
- La ayuda para notas de WhatsApp queda disponible sin competir con la acción
  principal.
- El área de carga funciona con ratón y teclado.

### YouTube

- El campo del enlace aparece primero y tiene etiqueta visible.
- Idioma del audio, idioma final y método de obtención del texto se muestran
  antes del botón principal.
- El botón se habilita únicamente con una URL válida de YouTube.
- El estado vacío explica dónde aparecerá el resultado y qué se podrá hacer
  con él.

### Traducir

- Original y traducción se muestran lado a lado en escritorio y en secuencia
  clara en celular.
- La acción `Traducir ahora` queda entre el texto de origen y el resultado.
- Traducir, copiar, descargar y limpiar reflejan correctamente cuándo están
  disponibles.
- El progreso usa un estado indeterminado y no muestra porcentajes inventados.

## Verificación realizada

- Revisión visual en Chrome a 1395 × 730 y 390 × 844.
- Capturas de los cuatro paneles en escritorio y celular.
- Revisión de roles, nombres accesibles, estados desactivados y panel visible.
- Prueba de navegación de pestañas con flechas del teclado.
- Prueba del cambio de estado de Traducir al escribir texto.
- Comprobación sintáctica del JavaScript principal con `node --check`.
- Revisión sin errores de consola nuevos en el origen local limpio
  `http://127.0.0.1:8766/`.
- Verificación del alias público en escritorio y celular, sin desbordamiento
  horizontal en ninguno de los cuatro paneles a 390 px de ancho.
- Verificación de `/api/health` con estado `ok`, modelo listo y respuesta HTTP
  disponible desde producción.

La suite de Python no se ejecutó porque `pytest` no está instalado en este
entorno. El comando falló antes de iniciar pruebas con
`No module named pytest`.

Las capturas están en `../auditoria-ux-2026-07-29/`.

Comparaciones principales:

- `21-comparacion-escritorio-antes-despues.png`.
- `22-comparacion-movil-antes-despues.png`.

## Fortalezas preservadas

- Identidad oscura con gradiente naranja y fucsia.
- Separación por cuatro tareas principales.
- Acciones de copiar, corregir, pulir y descargar.
- Estado del servidor visible.
- Preferencias persistentes del usuario.

## Siguientes mejoras recomendadas

1. Probar con usuarios reales el permiso de micrófono y una grabación completa
   en Android, iPhone y escritorio.
2. Añadir una vista breve de historial local de transcripciones recientes, con
   control explícito para activar o desactivar el guardado.
3. Medir tiempos reales por flujo para decidir si conviene mostrar una
   estimación de espera basada en datos observados.

## Límites de esta verificación

No se ejecutaron una grabación real, una subida de audio ni llamadas reales a
YouTube o traducción porque el servidor local estaba desconectado. Esos
servicios no fueron modificados por este cambio visual.

## Despliegue

- Proyecto: `jg-turbo`.
- Equipo: `jhoncod24s-projects`.
- Despliegue: `dpl_Wv8aTd1YwcaMcEwJHimqushPmqBv`.
- Destino: producción.
- Estado verificado por Vercel: `Ready`.
- Alias público: <https://jg-turbo.vercel.app>.
