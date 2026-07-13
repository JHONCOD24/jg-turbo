"""Test de humo: sube un audio de prueba a /transcribe y verifica la respuesta.

Detecta temprano regresiones en la cadena ffmpeg -> Whisper -> filtro
anti-alucinación -> JSON, sin depender de que el usuario abra la app.
"""
import os
import shutil
import subprocess
import time

import pytest

os.environ.setdefault("WHISPER_MODEL", "tiny")

from fastapi.testclient import TestClient

from app import app, modelo_listo

FFMPEG_DISPONIBLE = shutil.which("ffmpeg") is not None


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def audio_prueba(tmp_path_factory):
    if not FFMPEG_DISPONIBLE:
        pytest.skip("ffmpeg no está disponible en el PATH")
    destino = tmp_path_factory.mktemp("audio") / "tono.wav"
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-ar", "16000", "-ac", "1", str(destino),
        ],
        capture_output=True, check=True,
    )
    return destino


def _esperar_modelo(timeout=180):
    inicio = time.time()
    while not modelo_listo():
        if time.time() - inicio > timeout:
            pytest.skip("El modelo Whisper no cargó a tiempo")
        time.sleep(1)


def test_health_responde(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_transcribe_audio_valido(client, audio_prueba):
    _esperar_modelo()
    with open(audio_prueba, "rb") as f:
        resp = client.post(
            "/transcribe",
            files={"file": ("tono.wav", f, "audio/wav")},
            data={"language": "auto", "preview": "true"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "text" in data
    assert "segments" in data
    assert "needs_review" in data


def test_transcribe_audio_fast_mode(client, audio_prueba):
    _esperar_modelo()
    with open(audio_prueba, "rb") as f:
        resp = client.post(
            "/transcribe",
            files={"file": ("tono.wav", f, "audio/wav")},
            data={"language": "auto", "fast": "true"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "text" in data
    assert "segments" in data


def test_transcribe_formato_no_soportado(client):
    resp = client.post(
        "/transcribe",
        files={"file": ("audio.xyz", b"contenido", "application/octet-stream")},
        data={"language": "auto"},
    )
    assert resp.status_code == 400
