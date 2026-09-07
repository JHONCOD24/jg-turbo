# Plan de producto: música de fondo en módulo PDF de JGTurbo

> Proyecto: JGTurbo · Módulo: PDF (dictado Fish Audio + lectura visual estilo Kindle)
> Fecha: 2026-09-07 · Estado: plan, sin código
> Convención permanente de planes: archivos en minúsculas-con-guiones, sin espacios ni tildes. Ej: `plan-pdf-musical.md`.

## Objetivo

Permitir que el usuario escuche música de fondo mientras lee un PDF, sin que la voz y la música se estorben.

Este plan responde primero si es viable, luego define qué construir y en qué orden. No incluye implementación.

---

## 1. Preguntas de viabilidad técnica

**¿Es posible reproducir dos audios a la vez donde corre JGTurbo?**
Sí. Stack: **web PWA (HTML5 + CSS vanilla + JS nativo en SPA, pdf.js local, IndexedDB, Service Worker), instalable en Windows (Chrome/Edge), Android y iPhone, con backend Vercel serverless + backend local FastAPI**.
El navegador permite varios audios simultáneos. JGTurbo ya lo prueba: usa dos `<audio>` que se turnan para lectura continua.

El único freno del navegador es el autoarranque: el primer sonido exige un toque. Como la música nace del botón Escuchar, ese toque ya existe.

**¿Fish Audio permite mezcla o su salida es exclusiva?**
Permite mezcla. Su API (`POST /v1/tts`, más streaming HTTP y WebSocket) devuelve audio estándar en mp3/wav/pcm/opus.
En JGTurbo no suena directo: pasa por `POST /api/tts` y llega como MP3 normal. No bloquea el canal del sistema. Es mezclable.

**¿Qué mecanismo separa y mezcla con volumen independiente?**
En web: **Web Audio API + elementos `<audio>` múltiples**.
Cada canal tiene su ganancia (volumen) propia. Una capa mezcladora en el navegador combina voz y música y respeta cada nivel. Para bloqueo, auriculares e interrupciones se usa **MediaSession**, que JGTurbo ya usa para pausar desde bloqueo.

No aplican AVAudioSession, AudioManager ni Electron porque JGTurbo no es app nativa. Matiz iPhone PWA: el sistema puede pausar el audio web al bloquear o en llamada. Se maneja como pausa, no como error.

**¿Qué restricciones de licencia aplican?**
Todas. Solo entra música con licencia explícita para uso en app: dominio público, Creative Commons apta para comercial, librería comprada con licencia app, o IA con derechos comerciales claros. Nada de rips de YouTube ni redirección de Spotify.

---

## 2. Opciones de fuente de música

### Opción A: Generación con IA tipo MusicFlow

Hay indicios de API pública de **MusicFlow (musicflow.io)**: SDK `musicflow-studioai v1.0.1` del 2026-09-06 con patrón `generate(prompt, genre, duration, loop)`. Es muy nueva, sin SLA ni precio verificados aquí. Ojo: “FlowMusic” de otros proveedores (useapi, apimart, ttapi) es otra cosa, un envoltorio de Google Lyria 3 Pro.

- Ventajas: variedad infinita, puede pedir “lo-fi 70 BPM instrumental en loop” según ánimo o contenido.
- Desventajas: latencia alta (generar toma decenas de segundos, no sirve en tiempo real), costo por segundo, dependencia inestable, riesgo de letras cantadas que distraen si no se fuerza instrumental.
- Requisitos: clave solo en servidor, cola async + caché, generar una vez y reutilizar, forzar instrumental.

### Opción B: Biblioteca libre de derechos integrada (local + CDN propio)

Archivos propios servidos desde JGTurbo y cacheados por el Service Worker, como ya hace con pdf.js.

- Ventajas: encaja con lo local-first de JGTurbo. Funciona sin conexión. Latencia cero tras primera descarga. Costo único. Cero riesgo legal si se compra bien. Loops perfectos para lectura larga.
- Desventajas: variedad limitada al inicio, pesa si no se cuida (se mitiga con carga diferida por género).
- Requisitos: curar 12-20 pistas instrumentales en loop (lo-fi, piano suave, ambient, naturaleza), normalizar volumen, etiquetar por energía, hospedar fuera del bundle inicial.

### Opción C: Streaming externo (Spotify, YouTube Music u otro)

Ninguno sirve como “fondo mezclable” sin violar términos:

- Spotify exige SDK oficial, cuenta Premium, prohíbe reproducir fuera de su control y mezclar por debajo de voz. No entrega MP3 mezclable.
- YouTube Music / YouTube prohíbe background fuera de su app y extraer audio.

- Ventajas: catálogo enorme.
- Desventajas: bloqueo legal y técnico, exige login, mata el sin conexión, mete anuncios e interrupciones, y ata una función core a terceros.

### Recomendación

**Punto de partida: Opción B.**
Es la única que mantiene lo bueno de JGTurbo: abre sin internet, no retrasa la voz, no suma costo por lectura y no mete riesgo legal. A queda para Fase 3. C se descarta para MVP.

Criterio musical para leer: solo instrumental, sin voz, 60-90 BPM, mezcla suave, en loop sin cortes. Nada con letra: compite con la voz.

---

## 3. Experiencia de usuario (UX) propuesta

Principio: **sumar sin tapar**. Se reutiliza la estética actual —fondo oscuro, superficies, acento cyan, radios, Bricolage + Figtree, toques mínimo 44px—. Nada que achique el texto ni obligue a repaginar.

- **Activación:** botón “Música” con icono de nota dentro de la franja Escuchar, junto a Mujer/Hombre y velocidad. Estados: apagado / cargando / sonando.
- **Selección:** al tocarlo abre hoja inferior (como Ajustes, sin tapar Anterior/Siguiente/Escuchar):
  - Fila 1: Apagado + 4 ánimos: Concentración, Relax, Noche, Lluvia suave.
  - Fila 2: lista corta de pistas del ánimo (nombre + duración en loop).
  - “Automática” por defecto: elige según hora y última preferencia guardada.
- **Volumen independiente:** dos sliders con etiqueta real:
  - Voz (el actual).
  - Música (por defecto bajo, 20%).
  - Interruptor “Bajar música cuando habla la voz” (ducking suave), activado por defecto. Todo persiste en `jg_*` como el resto.
- **Pausa de lectura:** la voz pausa, la música baja a 10% y sigue 5 segundos en fundido, luego pausa. Al reanudar, entra primero la música en fundido y luego la voz. Sin cortes bruscos.
- **Notificaciones e interrupciones:** llamada, alarma, otro audio o quitar auriculares pausan ambos y guardan el punto con el ancla de texto. Al volver no autoarrancan: muestran “Continuar” en el mini reproductor. En bloqueo, MediaSession muestra la voz como principal.
- **Accesibilidad:** respeta `prefers-reduced-motion`, contraste verificado, foco visible con teclado, y aviso flotante si una pista no cargó (“Sin conexión para esa pista, sigue la voz”).

---

## 4. Arquitectura de audio de alto nivel

Sin código, en lenguaje de producto:

- **Canal 1 – Voz Fish:** sigue igual. Pide bloques a `/api/tts`, los cachea y los turna sin huecos. Es prioritario. Su camino no cambia.
- **Canal 2 – Música:** reproductor aparte en loop, precargado en segundo plano. Nunca pide al endpoint de voz para no competir con el límite de 60s de Vercel.
- **Capa mezcladora:** vive en el navegador, no en el servidor. Es la única dueña de “cuánto suena cada uno”. Recibe dos órdenes: nivel de voz y nivel de música. Si el usuario mueve un slider, solo cambia ese canal. Si entra una llamada, baja ambos.
- **Latencia:** la música jamás bloquea la voz. La voz arranca como hoy. La música entra cuando esté lista, en fundido. Si está en caché PWA, entra en menos de 1s. Si no, la voz no espera.

Fuente única de verdad: claves `jg_*` existentes más dos nuevas (`jg_musica_*`). Un deploy no las borra. Sin duplicar estado entre consola y mini flotante.

---

## 5. Fases del proyecto

**Fase 0 — Investigación y validación**
- Objetivo: responder el punto 1 con prueba mínima en Chrome, Edge, Safari iOS y Android.
- Entregables: prueba de dos audios con volúmenes separados, prueba de interrupción (llamada/bloqueo), tabla de licencias candidatas, ficha de MusicFlow con precio y latencia reales.
- Éxito: demo en PWA instalada donde voz + loop suenan sin cortes y cada slider manda solo a su canal.

**Fase 1 — MVP biblioteca local**
- Objetivo: leer con música pregenerada + volumen independiente.
- Entregables: botón Música en consola, 6-8 pistas en loop precacheadas, dos sliders, ducking básico, persistencia.
- Éxito: 95% de lecturas con música arrancan sin error y sin retrasar la voz más de 200ms extra.

**Fase 2 — Selector por usuario**
- Objetivo: elegir por ánimo y pista.
- Entregables: hoja de ánimos, 16-20 pistas etiquetadas, modo Automático, “seguir donde iba” para música.
- Éxito: cambiar de pista sin detener la voz y sin repaginar el libro.

**Fase 3 — Generación con IA bajo demanda**
- Objetivo: pedir “música para este capítulo” solo cuando se pida.
- Entregables: integración en servidor de MusicFlow u otra (ElevenLabs Music v2 como alternativa de licencia más limpia si MusicFlow no da SLA), generar una vez por ánimo/contenido, guardar y reutilizar, siempre instrumental.
- Éxito: lo generado se vuelve loop reutilizable, no se genera dos veces lo mismo.

**Fase 4 — Pulido y accesibilidad**
- Objetivo: que se sienta parte de JGTurbo y funcione sin conexión.
- Entregables: sin conexión para favoritas, pruebas con 5-8 lectores reales en móvil, ajustes de contraste, foco y táctil, documentación en `CAMBIOS_PDF.md`.
- Éxito: verificación móvil y geometría en verde sin regresiones.

---

## 6. Riesgos y dependencias

- **Técnico:** iOS PWA es el punto frágil. Puede pausar el segundo canal al bloquear. Mitigación: probar en iPhone real y degradar a “solo voz” con aviso si falla.
- **Legal:** música sin licencia app o IA con voz que imite artista real. Mitigación: solo catálogo con licencia + prompts instrumentales sin nombres de artistas.
- **UX:** que distraiga. Mitigación: música baja por defecto, sin letra, ducking activo, y si el usuario retrocede más con música, bajar aún más el default.
- **Dependencia externa:** MusicFlow muy nuevo, puede cambiar precio o caerse. Mitigación: no atar el MVP a él; abstraer “proveedor de música” para cambiar sin tocar la UI. Claves solo en Vercel.
- **Peso y caché:** sumar música sin control rompería la PWA. Mitigación: fuera del shell, carga diferida por ánimo.

---

## 7. Métricas de éxito

- **Adopción:** % de lectores PDF que activan música al menos una vez en 30 días. Meta inicial: [DATO PENDIENTE — definir línea base tras Fase 1, sugerido >15%].
- **Retención:** tiempo medio por sesión y sesiones/semana con música vs sin música. Éxito si con música leen +10% sin más retrocesos.
- **Satisfacción:** encuesta de 1 toque tras 3 usos (“¿Te ayuda a concentrarte?” Sí / Más o menos / Me distrae). Éxito si “Sí” >70% y “Me distrae” <10%.
- **Técnica:** inicio de música local <**800ms** percentil 75 en móvil medio con caché. La voz no se retrasa: incremento mediano <200ms vs sin música. Fallos de mezcla <2% de sesiones.

Umbral: 800ms porque la voz tarda 1-2.5s; la música debe estar antes de que termine el primer bloque para que el fundido se sienta natural.
