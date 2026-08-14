"""Techos de subida alineados con index.html (segmentación micrófono / archivo).

Evidencia prod (2026-08-01):
- WAV 1 min ≈ 1,83 MB → HTTP 200 en /api/transcribe
- WAV 5 min ≈ 9,16 MB → HTTP 413 (Vercel body ~4,5 MB)

El frontend parte en ~100 s (~3,2 MB) bajo techo de 3,6 MB en nube.
"""

AUDIO_LIMITE_SUBIDA_NUBE = int(3.6 * 1024 * 1024)
AUDIO_HZ = 16000
BYTES_POR_SEG = AUDIO_HZ * 2  # mono 16-bit
AUDIO_SEGUNDOS_POR_PARTE = 100
AUDIO_SOLAPE_PARTE_SEG = 0.4


def wav_size_for_seconds(seconds: float) -> int:
    return 44 + int(seconds * BYTES_POR_SEG)


def num_parts_for_duration(seconds: float) -> int:
    max_seg = max(20, (AUDIO_LIMITE_SUBIDA_NUBE - 44) // BYTES_POR_SEG)
    target = min(AUDIO_SEGUNDOS_POR_PARTE, max_seg)
    if seconds <= 0:
        return 0
    if wav_size_for_seconds(seconds) <= AUDIO_LIMITE_SUBIDA_NUBE:
        return 1
    n = 0
    pos = 0.0
    while pos < seconds - 1e-6 and n < 200:
        n += 1
        end = min(seconds, pos + target)
        if end >= seconds:
            break
        pos = max(pos + 0.01, end - AUDIO_SOLAPE_PARTE_SEG)
    return max(1, n)


def test_cuatro_minutos_supera_body_vercel_si_va_entero():
    size_4min = wav_size_for_seconds(240)
    assert size_4min > 4.5 * 1024 * 1024
    assert size_4min > AUDIO_LIMITE_SUBIDA_NUBE


def test_trozo_100s_cabe_en_techo_seguro():
    size = wav_size_for_seconds(AUDIO_SEGUNDOS_POR_PARTE)
    assert size < AUDIO_LIMITE_SUBIDA_NUBE
    assert size / (1024 * 1024) < 3.6


def test_cinco_minutos_se_parte():
    n = num_parts_for_duration(300)
    assert n >= 3
    assert n <= 5


def test_diez_minutos_viable_por_partes():
    n = num_parts_for_duration(600)
    assert 5 <= n <= 8
    assert wav_size_for_seconds(AUDIO_SEGUNDOS_POR_PARTE) < AUDIO_LIMITE_SUBIDA_NUBE


def test_audio_corto_una_sola_parte():
    assert num_parts_for_duration(45) == 1
    assert num_parts_for_duration(100) == 1  # 100 s ≈ 3,2 MB < 3,6 MB
