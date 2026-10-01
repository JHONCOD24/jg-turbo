# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Un solo usuario: el dueño de la app (Colombia). La usa para sí mismo, a diario, tanto en el
celular como en el computador (mitad y mitad: ninguno de los dos se sacrifica). No es programador:
la interfaz debe explicarse sola, en español de Colombia, sin jerga técnica.

Su trabajo principal con los videos: entender y aprovechar contenido en inglés (y en portugués,
francés, alemán o italiano) sobre **inteligencia artificial**, **aprendizaje** (cursos, charlas,
tutoriales) y **trabajo y negocio** (marketing, ventas, emprendimiento, entrevistas), oyéndolo en
español con voz natural.

## Product Purpose

JG Turbo es una PWA personal de voz y texto: dictado, transcripción de archivos, lector de PDF con
voz, traducción y **doblaje al español de videos de YouTube y de X (antes Twitter)**. El doblaje
pone una voz en español sobre el video, sincronizada frase por frase, con subtítulos opcionales.

Éxito para el doblaje y su biblioteca: pegar un enlace, oírlo en español en segundos, y poder volver
a cualquier video ya doblado (encontrarlo rápido por tema o por lo que se dijo) sin volver a esperar
ni a gastar cuota.

## Positioning

Todo corre con servicios gratuitos y la mayor parte del trabajo pesado ocurre en el navegador del
propio usuario (troceo de audio, traducción por partes, armado de archivos). La voz en español no
salta frases: si el español necesita más tiempo, el video se frena solo. Los videos de X se doblan
escuchando su audio, porque X casi nunca publica subtítulos.

## Operating Context

- Producción: https://jg-turbo.vercel.app (Vercel, función Python de 60 s, cuerpos de ≤ ~4,5 MB).
- Un solo `index.html` (SPA) con módulos ES cargados bajo demanda en `js/`; API en `api/index.py`.
- Datos del usuario solo en el navegador (localStorage `jg_*` e IndexedDB). No hay cuentas ni correos.
- Se usa en Chrome/Edge de escritorio (Windows) y en el celular; el iPhone tiene limitaciones de
  audio conocidas (Safari no deja fijar volúmenes por código).
- El dueño a veces reparte la construcción entre agentes: los planes viven como `.md` en la raíz.

## Capabilities and Constraints

- Doblaje: YouTube (texto vía Supadata/subtítulos), X (audio → Whisper de Groq) y
  videos del equipo (archivo local → Whisper de Groq, sin copiar el video).
  Idiomas de origen: en, pt, fr, de, it. Destino: español.
- Voz: Fish (clones) → Azure F0 (500 000 caracteres/mes gratis, 20 síntesis/min) → edge-tts →
  navegador. Estrategia 100 % gratuita por decisión del dueño.
- YouTube bloquea a los servidores de Vercel: **no se descargan videos de YouTube** (decisión del
  dueño, 2026-09-28; además sus términos lo prohíben). De YouTube se descarga solo lo que la app crea.
- De X sí se descarga el video original y el video doblado (MP4), porque X lo permite técnicamente
  desde el navegador sin Referer.
- La biblioteca de videos vive **solo en este dispositivo** (decisión del 2026-09-28); la nube que
  ya usa la biblioteca de PDF queda para después.
- Organización de videos por **etiquetas libres** (decisión del 2026-09-28): un video puede tener
  varios temas.
- Toques ≥ 44 px, sin desborde horizontal a 360 px, textos ≥ 13 px.

## Brand Commitments

- Nombre: **JG Turbo**. Idioma de toda la interfaz: español de Colombia, con tildes.
- El diseño de los subtítulos del doblaje (`.yt-caption`) lo fijó el dueño: no se cambia su aspecto.
- La app ya tiene un sistema visual oscuro propio (tokens en `:root` de `index.html`: `--bg`,
  `--surface`, `--cyan`, `--hot-1/2`, escala `--fs-*`, `--space-*`, `--h-touch`). Las superficies
  nuevas extienden ese sistema; la biblioteca de PDF es la referencia más cercana.

## Evidence on Hand

- Capturas reales de X y mediciones: `docs/x-doblaje/capturas/`, `CAMBIOS_X.md`.
- Mediciones del doblaje de YouTube: `CAMBIOS_YOUTUBE.md`, `AUDITORIA_YOUTUBE_2026-09-25.md`.
- No hay testimonios, métricas de uso ni usuarios externos: no inventarlos.

## Product Principles

1. **No hacer esperar dos veces.** Lo que ya costó tiempo o cuota (texto, traducción, voz) se
   guarda y se reutiliza.
2. **Nada se pierde sin que el dueño lo pida.** Borrar siempre ofrece deshacer; nada se poda en
   silencio lo que él organizó.
3. **Decir la verdad sobre lo que cuesta.** Antes de gastar cuota o generar un archivo pesado, la
   app muestra cuánto tardará, cuánto pesará y qué gasta.
4. **Gratis y en el navegador.** Si algo solo es posible pagando o en un servidor que no lo aguanta,
   se dice y se ofrece la alternativa más cercana.
5. **Si falla, que diga por qué.** Ningún botón falla en silencio (`TRAMPAS.md`).

## Accessibility & Inclusion

Lectura cómoda en celular (el dueño la usa a diario en el teléfono): contraste alto sobre el fondo
oscuro, navegación completa por teclado en escritorio, `label` en cada campo, estados de foco
visibles y respeto de `prefers-reduced-motion`.
