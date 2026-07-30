# Cómo preparar el corpus privado de validación

Esta carpeta contiene el ejemplo y las reglas del benchmark. Los audios reales, el manifiesto completo y los reportes permanecen fuera de Git.

## Contenido requerido

Prepara:

- 50 audios autorizados en inglés
- 50 audios autorizados en español
- Una transcripción humana literal por muestra
- Una traducción humana si ejecutas `--traducir`
- Variedad representativa de acentos, micrófonos y ruido moderado

No uses datos personales innecesarios. Conserva el consentimiento asociado a cada grabación fuera del repositorio.

## Estructura recomendada

```text
backend/corpus/
  manifest.jsonl
  audio/
    en-001.wav
    es-001.wav
```

Copia `manifest.example.jsonl` como base. Cada ruta de audio se resuelve desde la carpeta del manifiesto.

## Protección del corpus

`.gitignore` excluye `manifest.jsonl`, la carpeta `audio/` y los reportes del benchmark. Verifica `git status` antes de cada commit.

Consulta [la referencia completa de precisión](../../PRECISION_AUDIO.md) para ejecutar el benchmark y registrar sus resultados.