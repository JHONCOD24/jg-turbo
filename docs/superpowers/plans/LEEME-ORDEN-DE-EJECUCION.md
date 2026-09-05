# Cómo ejecutar los planes del lector PDF · Orden y agentes

Este es el archivo que hay que leer primero. Explica **cuántos agentes hay, en qué orden van y cuáles
pueden trabajar al mismo tiempo**.

## Los archivos de esta carpeta

| Archivo | Para quién | Qué hace |
|---|---|---|
| `LEEME-ORDEN-DE-EJECUCION.md` | Tú | Este archivo: el orden y por qué. |
| `2026-09-04-lector-pdf-legible.md` | Referencia | El plan completo, con el diagnóstico y las 8 tareas seguidas. Los cuatro planes de abajo salen de aquí. |
| `agente-1-lectura-y-voz.md` | Agente 1 | Que tocar un párrafo lo lea, que el texto siga a la voz y que el libro se retome donde se quedó. |
| `agente-2-interfaz-y-responsive.md` | Agente 2 | Juntar los ajustes de lectura en un solo sitio, quitar lo que sobra bajo el texto, verificar en seis pantallas. |
| `agente-3-cortes-libro-real.md` | Agente 3 | Las palabras cortadas: hacer que la prueba con un libro real se pueda ejecutar, medir y corregir. |
| `agente-4-cierre-y-despliegue.md` | Agente 4 | Comprobar que las tres partes funcionan **juntas**, cerrar la versión y desplegar. |

---

## Paso 0 (antes de lanzar ningún agente): guardar el trabajo de hoy

Ahora mismo hay **19 archivos modificados y 5 nuevos sin confirmar** en `main`. Si lanzas un agente
así, sus commits se mezclarán con el trabajo del agente anterior y no habrá forma de saber quién hizo
qué ni de deshacer una parte sin deshacer la otra.

Las 13 suites pasan con esos cambios, así que es seguro guardarlos como punto de partida:

```bash
cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
git config user.name "JHONCOD24"
git config user.email "juanloras35@gmail.com"
git add -A
git commit -m "chore(pdf): punto de partida antes del rediseno del lector"
```

Con eso, si algo sale mal, `git log` te dice exactamente qué agente lo introdujo y se puede revertir
solo esa parte.

---

## El orden

```
   Paso 0: guardar el trabajo de hoy
        │
        ├──────────────────────────────┐
        ▼                              ▼
   AGENTE 1                        AGENTE 3
   Lectura y voz                   Cortes con libro real
   (4 tareas, es el más largo)     (3 tareas)
        │                              │
        ▼                              │
   AGENTE 2                            │
   Interfaz y responsive               │
   (2 tareas)                          │
        │                              │
        └──────────────┬───────────────┘
                       ▼
                  AGENTE 4
                  Verificación de conjunto y despliegue
```

**Al mismo tiempo: los Agentes 1 y 3.** No comparten ni un solo archivo, así que pueden trabajar en
paralelo sin pisarse:

- El Agente 1 vive en `js/pdf/mapaLectura.js`, `js/pdf/libroVista.js`, `js/pdf/pdfController.js`,
  `index.html` y `tests/test_pdf_mejora_apartado.mjs`.
- El Agente 3 vive en `tests/test_pdf_reales.mjs`, `tests/test_pdf_cortes_reales.mjs`,
  `js/pdf/limites.js`, `js/pdf/lexico.js` y `CAMBIOS_PDF.md`.

**Después: el Agente 2.** Este **no puede ir en paralelo con el 1**, y la razón es concreta: los dos
editan `index.html`, `js/pdf/libroVista.js` y `js/pdf/pdfController.js`. `index.html` tiene 749 000
caracteres en un solo archivo; dos agentes editándolo a la vez producen conflictos que cuesta más
resolver que hacer el trabajo. Además, el Agente 2 reescribe el bloque de botones del que el Agente 1
saca «Volver a la lectura»: si van a la vez, uno de los dos pierde su cambio.

**Al final: el Agente 4.** Cuando los tres hayan terminado. Comprueba que el conjunto funciona (que la
hoja de Apariencia no tape la marca de la voz, que cambiar el tamaño de letra no rompa el
desplazamiento), cierra la versión y despliega.

---

## Cuánto trabajo es cada uno

| Agente | Tareas | Pasos | Archivos que toca | Riesgo |
|---|---|---|---|---|
| 1 · Lectura y voz | 4 | 26 | 6 | **Alto**: es el corazón del arreglo y toca el motor de voz. Revísalo con calma antes de lanzar el 2. |
| 2 · Interfaz y responsive | 2 | 15 | 5 | Medio: mucho HTML y CSS, poco riesgo lógico. |
| 3 · Cortes con libro real | 3 | 14 | 5 | Medio: puede descubrir cortes que no se sepan arreglar. Está previsto: los deja documentados. |
| 4 · Cierre y despliegue | 3 | 12 | 5 | Bajo, pero **es el que decide si esto sale a producción**. |

---

## Qué hacer entre agente y agente

Cuando un agente diga que terminó, antes de lanzar el siguiente:

1. **Mírale los commits**, no solo lo que dice:
   ```bash
   git log --oneline -8
   git show --stat HEAD
   ```
2. **Ejecuta sus pruebas tú misma:**
   ```bash
   node tests/test_pdf_mejora_apartado.mjs
   node tests/test_pdf_continuidad.mjs
   ```
3. **Abre la app y míralo con tus ojos.** Ninguna prueba automática te dice si el libro se ve bien:
   ```bash
   python -m http.server 8000
   ```
   Luego abre `http://localhost:8000`, carga un PDF y prueba lo que ese agente prometió.

Si algo no está, díselo a **ese** agente antes de seguir. Arrastrar un fallo al siguiente agente
multiplica el trabajo, porque el siguiente construye encima.

---

## Reglas que valen para los cuatro

- **Autor de git:** `JHONCOD24` / `juanloras35@gmail.com`. Con otro autor, Vercel bloquea el
  despliegue. Cada agente lo configura antes de su primer commit.
- **Solo el Agente 4 despliega.** Los otros tres confirman en `main` pero no publican nada.
- **Nadie sale de sus archivos.** Cada plan trae una tabla «Tus archivos» al principio. Si un agente
  necesita tocar algo de otro, para y pregunta.
- **Cada tarea termina con un commit propio.** Nunca «lo confirmo todo al final»: si algo falla, hay
  que poder volver una tarea atrás, no cuatro.
- **Una prueba en rojo detiene el trabajo.** No se relaja una prueba existente para que pase la nueva.

---

## Si quieres ir más despacio

No hace falta lanzar los cuatro. Un orden razonable si prefieres ver resultados antes de seguir:

1. **Solo el Agente 1.** Es el que arregla lo que más te molesta: el botón que no hacía nada, que no
   se vea por dónde va la voz, y que el libro no se retome. Con eso ya se nota el cambio.
2. Mirar el resultado, y entonces decidir si sigues con el 2 (interfaz) o con el 3 (cortes).
3. El Agente 4 al final, siempre.
