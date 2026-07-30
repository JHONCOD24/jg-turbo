"""Benchmark reproducible de 100 audios reales para JG Turbo.

No genera voces sintéticas ni inventa resultados. Requiere un manifiesto JSONL con,
como mínimo, 50 audios etiquetados en inglés y 50 en español.
"""

from __future__ import annotations

import argparse
from collections import Counter
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import sys
import time

import httpx


def normalizar(texto: str) -> list[str]:
    return re.findall(r"[a-z0-9áéíóúüñ]+", (texto or "").casefold())


def distancia_levenshtein(a: list[str], b: list[str]) -> int:
    anterior = list(range(len(b) + 1))
    for i, palabra_a in enumerate(a, 1):
        actual = [i]
        for j, palabra_b in enumerate(b, 1):
            actual.append(min(
                actual[-1] + 1,
                anterior[j] + 1,
                anterior[j - 1] + (palabra_a != palabra_b),
            ))
        anterior = actual
    return anterior[-1]


def wer(referencia: str, hipotesis: str) -> float:
    ref = normalizar(referencia)
    hyp = normalizar(hipotesis)
    return distancia_levenshtein(ref, hyp) / max(1, len(ref))


def similitud(referencia: str, hipotesis: str) -> float:
    a = " ".join(normalizar(referencia))
    b = " ".join(normalizar(hipotesis))
    return SequenceMatcher(None, a, b).ratio()


def cargar_manifest(ruta: Path, minimo_por_idioma: int) -> list[dict]:
    muestras = []
    for numero, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        try:
            muestra = json.loads(linea)
        except json.JSONDecodeError as error:
            raise ValueError(f"JSON inválido en línea {numero}: {error}") from error
        for campo in ("id", "audio", "language", "transcript"):
            if not str(muestra.get(campo, "")).strip():
                raise ValueError(f"Falta '{campo}' en línea {numero}")
        muestra["language"] = muestra["language"].split("-")[0].lower()
        if muestra["language"] not in {"en", "es"}:
            raise ValueError(f"Idioma no soportado en línea {numero}: {muestra['language']}")
        audio = (ruta.parent / muestra["audio"]).resolve()
        if not audio.is_file():
            raise FileNotFoundError(f"Audio inexistente: {audio}")
        muestra["audio_path"] = audio
        muestras.append(muestra)

    conteo = Counter(m["language"] for m in muestras)
    for idioma in ("en", "es"):
        if conteo[idioma] < minimo_por_idioma:
            raise ValueError(
                f"Corpus incompleto: {conteo[idioma]} muestras '{idioma}'; "
                f"se requieren al menos {minimo_por_idioma}."
            )
    return muestras


def ejecutar(args) -> dict:
    manifest = Path(args.manifest).resolve()
    muestras = cargar_manifest(manifest, args.min_por_idioma)
    inicio = time.perf_counter()
    resultados = []
    idiomas = Counter()
    exitos = 0
    alertas_traduccion = 0

    with httpx.Client(base_url=args.server.rstrip("/"), timeout=args.timeout) as client:
        sesion = client.get("/session-config")
        sesion.raise_for_status()
        config = sesion.json()
        headers = {config.get("auth_header", "x-jg-local-token"): config["token"]}

        for indice, muestra in enumerate(muestras, 1):
            idioma = muestra["language"]
            idiomas[idioma] += 1
            with muestra["audio_path"].open("rb") as archivo:
                respuesta = client.post(
                    "/transcribe",
                    headers=headers,
                    files={"file": (muestra["audio_path"].name, archivo, "application/octet-stream")},
                    data={
                        "language": idioma,
                        "preview": "false",
                        "fast": "false",
                        "auto_correct": "false",
                        "context": muestra.get("context", ""),
                    },
                )
            respuesta.raise_for_status()
            data = respuesta.json()
            error_palabras = wer(muestra["transcript"], data.get("text", ""))
            exito = error_palabras <= args.max_wer_muestra
            exitos += int(exito)
            item = {
                "id": muestra["id"],
                "language": idioma,
                "wer": round(error_palabras, 4),
                "success": exito,
                "needs_review": bool(data.get("needs_review")),
            }

            referencia_traduccion = str(muestra.get("translation", "")).strip()
            if args.traducir and referencia_traduccion:
                destino = "es" if idioma == "en" else "en"
                traduccion = client.post(
                    "/translate",
                    headers=headers,
                    json={
                        "text": data.get("text", ""),
                        "direction": f"{idioma}-{destino}",
                        "provider": args.provider,
                        "api_key": args.api_key,
                    },
                )
                traduccion.raise_for_status()
                datos_traduccion = traduccion.json()
                score = similitud(referencia_traduccion, datos_traduccion.get("text", ""))
                validacion = datos_traduccion.get("validation") or {}
                alucinacion = validacion.get("status") == "alert" or score < args.min_similitud
                alertas_traduccion += int(alucinacion)
                item.update({
                    "translation_similarity": round(score, 4),
                    "translation_integrity": validacion.get("integrity_score"),
                    "translation_alert": alucinacion,
                })

            resultados.append(item)
            print(f"[{indice:03}/{len(muestras):03}] {muestra['id']} · WER {error_palabras:.2%}")

    tasa_exito = exitos / max(1, len(muestras))
    reporte = {
        "samples": len(muestras),
        "by_language": dict(idiomas),
        "success_rate": round(tasa_exito, 4),
        "mean_wer": round(sum(r["wer"] for r in resultados) / max(1, len(resultados)), 4),
        "translation_alerts": alertas_traduccion,
        "thresholds": {
            "success_rate": args.objetivo_exito,
            "max_sample_wer": args.max_wer_muestra,
            "translation_alerts": 0,
        },
        "passed": tasa_exito >= args.objetivo_exito and (not args.traducir or alertas_traduccion == 0),
        "elapsed_seconds": round(time.perf_counter() - inicio, 2),
        "results": resultados,
    }
    if args.report:
        Path(args.report).write_text(json.dumps(reporte, ensure_ascii=False, indent=2), encoding="utf-8")
    return reporte


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark real EN/ES de JG Turbo")
    parser.add_argument("manifest", help="Ruta al archivo JSONL del corpus")
    parser.add_argument("--server", default="http://127.0.0.1:8000")
    parser.add_argument("--min-por-idioma", type=int, default=50)
    parser.add_argument("--objetivo-exito", type=float, default=0.98)
    parser.add_argument("--max-wer-muestra", type=float, default=0.05)
    parser.add_argument("--traducir", action="store_true")
    parser.add_argument("--provider", default="none")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--min-similitud", type=float, default=0.60)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--report", default="benchmark-report.json")
    args = parser.parse_args()
    try:
        reporte = ejecutar(args)
    except (ValueError, FileNotFoundError, httpx.HTTPError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    print(json.dumps({k: v for k, v in reporte.items() if k != "results"}, ensure_ascii=False, indent=2))
    return 0 if reporte["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
