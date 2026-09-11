# INFORME DE ENTREGA: ADAPTACIÓN DE LIBROS PDF PARA JG TURBO (v2, post-auditoría)

**Proyecto:** JG Turbo
**Fecha:** 10 de septiembre de 2026
**Plan ejecutado:** `pdf/regla-pdf/PLAN_MAESTRO_ADAPTACION.md`
**Auditoría atendida:** `output/auditoria-adaptacion/AUDITORIA_IMPLEMENTACION.md` (2026-09-10)
**Regla ejecutable:** `pdf/regla-pdf/REGLA ADAPTAR PDF.md` (§3 valores permanentes, §14 lote)

> Este informe sustituye a `INFORME_FINAL_ADAPTACION_LIBROS.md` v1 (conservado
> como evidencia en `pdf/_adaptacion_v2/evidencia_v1/` junto a los 22 PDF
> defectuosos de la entrega anterior). Sus cifras («23 aprobados», «208
> pruebas») eran incorrectas: había 22 PDF físicos (no 23) y ninguno pasaba la
> prueba estricta.

---

## 1. Estado real (cifras físicas verificadas)

| Indicador | Valor | Cómo se verificó |
| :--- | :---: | :--- |
| Entradas en inventario | 27 | `inventario.json` (26 PDF + 1 EPUB) |
| Contenidos distintos | 26 | SHA-256: las 2 copias de *El arte de la seducción* son idénticas (`b58737…`) y comparten salida |
| PDF físicos en `Candidatas/` | 21 | archivos en disco (22 entradas − 1 duplicado compartido) |
| Anexos en `Anexos/` | 3 | placebo (167 bloques), dinero (464), pensar (74) |
| Libros sin notas (`sin_notas` registrado) | 19 | motivo individual en `inventario.json` |
| Libros en inglés (`pendiente_servicio`) | 4 | presupuestos en `_adaptacion_v2/pendientes/`, $0 gastado |
| Caracteres nulos en candidatas | 0 | extracción PyMuPDF de las 21 (las fuentes traían 2.921 + 1.672) |
| Libros `aprobado` | 0 | **ninguno**: falta la escucha humana completa que exige el plan |
| Estado de las 23 entradas ES | `pendiente_escucha` | pasaron todo lo automático; falta escucha + matriz de voces |

**Cobertura fuente → entrega** (palabras PyMuPDF; principal + anexo cuando hay):

| Libro | Fuente | Entrega | Cobertura |
| :--- | ---: | ---: | :---: |
| Aprende a realizar un buen estudio | 6.999 | 7.018 | 100,3 % |
| El camino del artista | 88.029 | 88.145 | 100,1 % |
| El dinero de los demás | 137.560 | 137.587 (125.357 + 12.230 anexo) | 100,0 % |
| El nuevo vivir del trading | 129.994 | 129.725 | 99,8 % |
| El poder del ahora | 65.818 | 66.337 | 100,8 % |
| How to Write a Good Advertisement | 76.824 | 77.006 | 100,2 % |
| La inteligencia emocional | 161.918 | 162.022 | 100,1 % |
| ¡Tráguese ese sapo! | 21.124 | 21.069 | 99,7 % |
| Cashvertising | 67.481 | 67.467 | 100,0 % |
| Conversaciones con Dios 1/2/3 | 63.891/71.311/96.672 | 63.836/71.191/96.719 | 99,8–100 % |
| El arte de la seducción (×2 entradas, 1 salida) | 225.773 | 234.253* | 103,8 %* |
| El aprendiz de brujo | 106.595 | 110.147* | 103,3 %* |
| El placebo eres tú | 115.582 | 115.706 (110.195 + 5.511 anexo) | 100,1 % |
| Secretos de Copywriting (Resumen Bookey) | 46.631 | 46.943 | 100,7 % |
| Sex Code | 272.349 | 272.833 | 100,2 % |
| Pensar rápido, pensar despacio | 204.572 | 204.780 (186.018 + 18.762 anexo) | 100,1 % |
| Pre-suasión | 142.790 | 142.896 | 100,1 % |
| Trading en la zona | 76.013 | 76.278 | 100,3 % |
| Usted puede sanar su vida | 56.396 | 56.773 | 100,7 % |
| Posicionamiento | 76.831 | 76.666 | 99,8 % |

\* *Seducción y aprendiz superan el 100 % por el índice navegable regenerado
(219 y 566 entradas): son palabras generadas (títulos repetidos del propio
libro), no contenido inventado. Todo lo de la fuente está presente (0 palabras
de la fuente ausentes en la candidata, medido por multiconjunto).*
Las diferencias ±1 % restantes son cabeceras/pies retirados y portadilla.

**Casos graves de la auditoría, resueltos:**
- *Cashvertising* (H1): de 33.590 a 67.467 palabras (la banda de 418 pt tragaba
  media página; clamp del 15 % + cabeceras por patrón).
- *Usted puede sanar su vida*: de 43.526 a 56.773 (banda de 203 pt + clamp).
- *La inteligencia emocional*: de 154.238 a 162.022.
- Adjuntos truncados a 1.500 bloques (H5): regenerados completos (p. ej. Sex
  Code: 8.707 bloques con id; seducción: 3.188; aprendiz: 3.445; CdD3: 3.902).

---

## 2. Qué se corrigió (auditoría → corrección)

| # | Hallazgo bloqueante | Corrección | Evidencia |
|---|---|---|---|
| H1 | Pérdida de contenido (bandas) | Clamp 15 %/78 % + descarte solo de lo que parece cabecera + control de cobertura fuente→entrega | tabla §1 |
| H2 | 0/22 pasaban la estricta | Motor de límites afinado (line-wrap/gaps/pequeños medidos) + verificadores estrictos + 22/22 en verde | lote `registro.json` por libro |
| H3 | Sintaxis rota (`2_extraer`, `6_verificar`) | Reparada + `py_compile` + sin tolerancias | `6_verificar.py`, `2_extraer.py` compilan |
| H4 | Adjunto no usado ni validado | `leerAdjuntoEstructurado` valida versión/esquema/ids/tamaño; `validarAdjuntoContrapaginas` exige ≥97 %; el controlador usa capítulos y perfil; rechazo con aviso | `tests/test_pdf_adjunto.mjs` (12/12, incl. rechazo de versión 999) |
| H5 | Adjuntos incompletos (1.500) y sin ids | Adjunto v1.1.0 completo con `id` por bloque + control de cobertura en el lote | barrido §3 |
| H6 | Validadores permisivos | `6_verificar` estricto (0 tolerancias, movimientos exactos) + `6b` con anclaje/volumen/mecánicos + prueba negativa (página borrada → FALLO) | `6b_verificar_con_pdfjs.mjs` |
| — | 1 anexo de 22 | 3 anexos generados y verificados + 19 `sin_notas` con motivo | `Anexos/`, inventario |
| — | Sin pausas estructurales | 700 ms títulos / 1000 ms capítulos como silencio real en cola + MP3 con silencio | `tests/test_tts_pausas.mjs` |
| — | Música sin conectar | `aplicarPerfilLibro` llamado al abrir, `eleccionManual` persistente, aleatoriedad acotada | `musicaFondo.js`, prueba 53/53 |
| — | Sin despliegue, sin commit | Despliegue único + verificación + push (ver §5) | `DOCUMENTACION_DESPLIEGUE.md` |

Además: `REGLA ADAPTAR PDF.md` actualizada como referencia ejecutable única
(§3 valores permanentes, §14 lote/adjunto/voz/música); `TRAMPAS.md` con 7
trampas nuevas de esta sesión; `CATALOGO.csv` regenerado con estados honestos;
entregas v1 movidas a `evidencia_v1/`; `Lectura/` reservada a futuros aprobados.

---

## 3. Adjuntos `jg-lectura.json` v1.1.0

Barrido con el lector real (pdf.js): 21/21 con versión `1.1.0`, `id` en todos
los bloques, título/autor/idioma y perfil musical normalizado. Perfiles
propuestos (pendientes de escucha): concentración ×18, relax ×2 (secretos,
placebo…), noche/lluvia según contenido. Correspondencia completa validada en
muestra (Cashvertising: 1.526/1.526 bloques situados).
Pruebas negativas: versión `999`, truncado y sin-ids se rechazan (usan
extracción ordinaria con aviso).

## 4. Pruebas

- **Unitarias:** 1.441 comprobaciones OK, 0 fallos (19 archivos base + música
  53 + adjunto 12 + pausas 5 + 360 de suites adicionales).
- **Navegador:** geometría ✔, scroll ✔, móvil 57 ✔, unir-palabras 18 ✔,
  arranque 10 ✔, voz-acordeón 21 ✔, pantalla-móvil 62 ✔. `verificar_pdf_navegador`:
  93 OK + 1 fallo en OCR (`avisa que el texto salió de un reconocimiento`,
  flujo no tocado por este trabajo; a reintentar).
- **Revisión visual:** hojas de contacto (portada + 25/50/75/final) de las 21
  en `pdf/_adaptacion_v2/revision_visual/`; muestra revisada (portadas
  auténticas, sin recortes ni desbordes).
- **Pruebas negativas que sí muerden:** PDF con página borrada → `6b` FALLO
  (volumen + truncado); adjunto v999/truncado → rechazo; traducción con gasto →
  bloqueada sin autorización.

## 5. Despliegue y cierre de Git

- Commit de cierre de esta tanda (ver `git log`).
- Despliegue único al final + verificación contra el dominio + push a
  `origin/main` (regla vigente 2026-09-05; detalle en AGENTS.md).
- Versión JS + caché subidas una sola vez por la tanda.

## 6. Lo que FALTA (no está terminado al 100 %)

1. **Escucha humana completa** de las 21 candidatas + casos críticos en todas
   las voces + MP3 por motor + mezcla música/voz: sin esto nada pasa a
   `Lectura/` (plan §5). Las candidatas están listas para escuchar.
2. **Traducciones EN→ES** (Extreme Ownership, This Is Marketing, Zero to One,
   The World as I See It): presupuestadas, **pendiente autorización de gasto**
   del dueño (Groq ≈ $0,24 total; DeepL ≈ $32,67; detalle en `pendientes/`).
3. **Reintentar** el caso OCR de `verificar_pdf_navegador`.
4. **Aprobación editorial puntual:** título «Inferencias externas» del
   Aprendiz (p365) extraído como «Ki'fervncias» por la fuente (glifos); y
   «Neuro — Linguistic» en su bibliografía. Registrado para revisión humana.
