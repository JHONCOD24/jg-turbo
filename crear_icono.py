"""Genera jg-turbo.ico multi-resolución desde el logo de la app."""
from pathlib import Path

from PIL import Image

APP = Path(__file__).resolve().parent
SRC = APP / "logo-real.png"
if not SRC.exists():
    SRC = APP / "logo.png"

img = Image.open(SRC).convert("RGBA")
out = APP / "jg-turbo.ico"
img.save(
    out,
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(f"Icono creado: {out} ({out.stat().st_size} bytes)")