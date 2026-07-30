"""Pruebas rápidas de controles de calidad sin cargar el modelo Whisper."""

from calidad_linguistica import analizar_segmentos_asr, construir_prompt_asr, validar_traduccion


def test_prompt_asr_ingles_incluye_glosario_y_es_acotado():
    prompt = construir_prompt_asr("en-US", "OpenAI\nJG Turbo\nPostgreSQL")
    assert "English" in prompt
    assert "OpenAI" in prompt
    assert len(prompt) <= 850


def test_segmentos_asr_marcan_ambiguedad_y_descartan_ruido_claro():
    resultado = analizar_segmentos_asr(
        "Texto general",
        [
            {"start": 0, "end": 1, "text": " Clear speech", "avg_logprob": -0.1, "no_speech_prob": 0.01},
            {"start": 1, "end": 2, "text": " thanks for watching", "avg_logprob": -1.3, "no_speech_prob": 0.8},
            {"start": 2, "end": 3, "text": " uncertain fragment", "avg_logprob": -1.0, "no_speech_prob": 0.4},
        ],
    )
    assert resultado["text"] == "Clear speech uncertain fragment"
    assert resultado["removed_hallucinations"] == 1
    assert resultado["low_confidence_segments"] == 1
    assert resultado["needs_review"] is True


def test_validador_detecta_cifras_inventadas_y_omisiones():
    resultado = validar_traduccion(
        "The API processed 25 files at https://example.com.",
        "La API procesó 40 archivos.",
        "en",
        "es",
    )
    codigos = {problema["code"] for problema in resultado["issues"]}
    assert resultado["status"] == "alert"
    assert resultado["requires_confirmation"] is True
    assert "missing_numbers" in codigos
    assert "invented_numbers" in codigos
    assert "missing_urls" in codigos


def test_100_casos_bilingues_conservan_invariantes():
    casos_ingles = [
        (
            f"Deploy batch {i} with API v2 at https://example.com/{i}.",
            f"Despliega el lote {i} con la API v2 en https://example.com/{i}.",
            "en",
            "es",
        )
        for i in range(1, 51)
    ]
    casos_espanol = [
        (
            f"Procesa el lote {i} con PostgreSQL v3 en https://example.com/{i}.",
            f"Process batch {i} with PostgreSQL v3 at https://example.com/{i}.",
            "es",
            "en",
        )
        for i in range(1, 51)
    ]
    for origen, traduccion, src, trg in casos_ingles + casos_espanol:
        resultado = validar_traduccion(origen, traduccion, src, trg)
        assert resultado["status"] != "alert", resultado
        assert resultado["checks"]["numbers_preserved"] is True
