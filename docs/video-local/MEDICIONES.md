# Doblar videos del equipo · hechos medidos (2026-10-01)

Medido por el agente director antes de escribir el plan, en este PC (Windows 11, sin GPU dedicada),
con Mediabunny 1.60.0 de `js/vendor/mediabunny/` y el `/api/transcribe` de **producción**
(`https://jg-turbo.vercel.app`, Whisper de Groq). Respuestas crudas en `capturas/`; página y scripts
de medición en `medicion/` (se pueden volver a correr con Playwright, ver al final).

## Videos usados

Generados con FFmpeg 9.0.2 a partir de 52,2 s de voz en inglés (edge-tts `en-US-AndrewNeural`,
texto en `medicion/texto_en.txt`) + 3 s de silencio, repetidos:

| Archivo | Contenido |
|---|---|
| `largo60.mp4` (140 MB, no se guarda) | 60 min · H.264 320×180 5 fps + AAC 128 kbps estéreo 44,1 kHz |
| `corto.mp4` / `.mkv` / `.mov` | 3 min, mismos códecs (copiados) |
| `corto.webm` | 3 min · VP9 + Opus 96 kbps 48 kHz |
| `corto_ac3.mkv` | 3 min · H.264 + **AC-3 192 kbps** (como muchas películas MKV) |
| `fixtures/*` | Los 4 videos pequeños que usan las pruebas (40 s y 10 s) |

## Resultados

| # | Hecho | Consecuencia para el diseño |
|---|---|---|
| M1 | **WebCodecs solo existe en contexto seguro.** En `http://spike.local` todo salió «no se puede decodificar»; en `http://localhost` y `127.0.0.1` sí. | La app (https) no tiene problema. Las pruebas deben servir en `localhost`/`127.0.0.1`. |
| M2 | Chrome decodifica AAC, Opus y H.264/VP9 con Mediabunny (`canDecode: true`). **AC-3 no** (`undecodable_source_codec`). El Chromium de Playwright también decodificó AAC. | Dos caminos: recodificar si se puede; copiar si no. |
| M3 | **Copiar** el audio de 60 min (sin decodificar), en partes de 200 s: **0,58 s** en total; 18 partes de ≤ 2,87 MB = **51 MB a subir**. | Rapidísimo pero pesado para los datos del celular. Solo como respaldo. |
| M4 | **Recodificar a MP3 16 kHz mono 32 kbps** (extensión `@mediabunny/mp3-encoder`, ya vendorizada), partes de 360 s: **16,7 s** para 60 min (216× tiempo real); 10 partes de **1,44 MB** = 13,7 MB. | Camino principal. |
| M5 | Recodificar a **Opus** 16 kHz mono 24 kbps (Ogg): 23,6 s para 60 min (153×); 10 partes de 0,9 MB. | Más lento que el MP3 en este PC y depende del codificador del navegador: no se usa. |
| M6 | Con la CPU **4× más lenta** (emulación de teléfono): MP3 ≈ **9 s por parte de 6 min**; Opus ≈ 8,8 s; copiar ≈ 0,33 s. | En el celular, 60 min tardan ~1,5 min en prepararse; la primera parte sale en ~9 s. Se dice en la tarjeta de progreso. |
| M7 | `/api/transcribe` de producción, `fast=false`, `language=auto`: | Todos aceptados y con tiempos por frase: |
| | · MP3 360 s (1,44 MB) → **200 en 5,8 s**, `en`, 68 frases, 0,0–360,07 s | |
| | · Ogg/Opus 360 s (0,95 MB) → 200 en 5,1 s, `en`, 70 frases | |
| | · AAC copiado .m4a 200 s (3,0 MB) → 200 en 10,8 s, `en`, 34 frases | Subir 3 MB tarda: el MP3 rinde 61 s de audio por segundo; el AAC copiado, 18. |
| | · **AC-3 copiado en MP4** (.m4a) 120 s (2,9 MB) → **200 en 9,1 s**, `en`, 24 frases | Groq decodifica AC-3 de su lado: el respaldo «copiar» sirve también para películas. |
| M8 | El servidor ya devuelve el idioma en código corto (`en`, `es`), no «english». | El cliente no traduce nombres de idioma. |
| M9 | `computePacketStats()` del audio de 60 min: **0,21 s** (117 798 bps reales; con 100 paquetes, 122 915). | Para copiar se mide la tasa de bits real y se deja 15 % de margen. |
| M10 | Huella SHA-256 de (tamaño + 1 MiB inicial + 1 MiB final) de 140 MB: **16 ms**. | Clave estable del video sin leerlo entero (TRAMPAS §6.7). |
| M11 | `<video>` con `URL.createObjectURL(file)`: MP4, MKV, MOV, WebM y el MKV con AC-3 cargaron en Chrome; `playbackRate = 0.85` aplicado. | El MKV con AC-3 carga, pero su sonido original no suena (Chrome no decodifica AC-3): se avisa. |
| M12 | Un `blob:` creado en la página **carga dentro del iframe `/x-reproductor.html`** (mismo origen): duración 3600, `playbackRate 0.8`, `volume 0.12`. | El video del equipo reutiliza `XVideoPlayer` sin código nuevo de reproductor. |
| M13 | Miniatura: un cuadro del 10 % del video a JPEG 320 px = **~6,6 KB**. | Se guarda como `data:` en la ficha de la biblioteca (no hay CSP que lo impida). |
| M14 | `Mp4OutputFormat().getSupportedVideoCodecs()` = avc, hevc, vp9, av1, vp8, prores. | El MP4 doblado copia el video de casi cualquier archivo, sin recodificar. |
| M15 | **Fallo real encontrado al validar:** el MP4 doblado de un MKV con AC-3 a 32 kHz falló en Chrome: `mp4a.40.2, 128000 bps, 2 channels, 32000 Hz is not supported`. El exportador usaba la frecuencia del audio original. | Se mezcla a 44,1/48 kHz siempre (corrección incluida en el plan). |

## Lo que NO se pudo medir aquí

- **iPhone/Safari real** y un Android real: WebCodecs de audio en Safari, memoria con un archivo de
  1–4 GB y el selector de archivos de la galería. Si Safari no decodifica, el camino «copiar» igual
  funciona (no decodifica nada). Lo mide el dueño en la vista previa (Tarea 13 del plan).
- El **límite por hora de Groq** (7 200 s de audio por hora en el plan gratuito, `CAMBIOS_X.md` H10):
  no se forzó. El plan guarda cada parte transcrita y retoma.

## Volver a medir

```bash
# Desde docs/video-local/medicion/ (necesita Playwright como las demás pruebas y los videos de arriba):
node medir.mjs chrome      # extracción en Chrome instalado (copiar · Opus · MP3 · WAV)
node medir2.mjs chrome lento   # con la CPU 4× más lenta
node medir4.mjs chrome     # tasa de bits, huella y blob dentro del iframe
```

Los scripts buscan los videos en su misma carpeta (`largo60.mp4`, `corto*.{mp4,mkv,mov,webm}`) y la
página en `web/`; ajusta las rutas si los mueves. Para generar el de 60 min:

```bash
python -m edge_tts --voice en-US-AndrewNeural --file texto_en.txt --write-media voz_en.mp3
ffmpeg -y -i voz_en.mp3 -af "apad=pad_dur=3" -ar 44100 -ac 2 bloque.wav
ffmpeg -y -stream_loop -1 -i bloque.wav -t 3600 -c:a pcm_s16le audio60.wav
ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=5" -i audio60.wav -t 3600 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart largo60.mp4
```
