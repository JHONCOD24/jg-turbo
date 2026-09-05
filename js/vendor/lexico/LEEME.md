# Listas de palabras · español e inglés

Las usa `js/pdf/lexico.js` para decidir si dos trozos separados por un corte de
renglón forman una palabra («sorprend» + «entes» → «sorprendentes»). Se cargan
**solo** cuando el lector las necesita: quien no abre un PDF no las descarga.

## Qué son

Formas ya conjugadas y declinadas, no lemas: para decidir hace falta reconocer
«sorprendentes», no solo «sorprendente». Salen de expandir los diccionarios
hunspell (`.dic` + `.aff`) con sus reglas de afijos.

| Archivo | Formas | Crudo | Por la red (gzip) |
|---|---:|---:|---:|
| `es.txt` | 655.614 | 2,5 MB | ~283 KB |
| `en.txt` | 123.679 | 518 KB | ~160 KB |

## Formato

Lista ordenada con **prefijo compartido**: cada línea empieza por un carácter
que dice cuántas letras repite de la línea anterior (`'0'` = 0, `'1'` = 1…) y
sigue con el resto. Sin esto la lista española pesa 1,5 MB por la red en vez de
283 KB. Lo descodifica `descodificarLista()` en `js/pdf/lexico.js`.

    0casa
    3ero      → casero  (repite «cas» + «ero»)

## Origen y licencia

- **es**: diccionario de LibreOffice/OpenOffice (Santiago Bosio y el equipo de
  RLA). Triple licencia GPLv3+ / LGPLv3+ / **MPL 1.1+**; se usa bajo MPL 1.1.
  Aviso completo en `LICENCIA-es.txt`.
- **en**: SCOWL, Copyright 2000-2018 Kevin Atkinson. Licencia permisiva tipo
  BSD que **exige conservar el aviso de copyright**: está en `LICENCIA-en.txt`.

**No borrar los archivos de licencia.** Las dos licencias obligan a que viajen
con las listas.

## Cómo se regeneran

No hay script en el repo: se hizo una sola vez. Para rehacerlo, expandir
`index.dic` + `index.aff` de `wooorm/dictionaries` aplicando SFX/PFX con su
condición, y el producto cruzado solo cuando ambas reglas son combinables
(`Y`), que es lo que hace hunspell. **Generar de más es peor que generar de
menos**: una forma inventada haría que el lector una dos palabras que no van
juntas, y eso corrompe el texto del libro.
