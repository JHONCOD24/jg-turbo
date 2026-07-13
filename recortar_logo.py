from PIL import Image, ImageChops
import sys
from pathlib import Path

def trim(im):
    # Convertir a RGB y crear imagen blanca del mismo tamaño
    bg = Image.new(im.mode, im.size, im.getpixel((0,0)))
    diff = ImageChops.difference(im, bg)
    diff = ImageChops.add(diff, diff, 2.0, -100)
    bbox = diff.getbbox()
    if bbox:
        return im.crop(bbox)
    return im

def make_transparent_bg(im):
    im = im.convert("RGBA")
    datas = im.getdata()
    newData = []
    # Usar el color del pixel (0,0) como fondo a eliminar
    bg_color = datas[0]
    # Si el fondo es blanco o muy claro, hacerlo transparente
    for item in datas:
        # Si es suficientemente parecido al color de fondo
        if abs(item[0]-bg_color[0])<10 and abs(item[1]-bg_color[1])<10 and abs(item[2]-bg_color[2])<10:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
    im.putdata(newData)
    return im

if __name__ == "__main__":
    app_dir = Path(r"e:\PROYECTS\Spech to text Pro\Spech to text App")
    logo_path = app_dir / "logo-real.png"
    if not logo_path.exists():
        logo_path = app_dir / "logo.png"

    try:
        im = Image.open(logo_path)
        # Recortar espacios vacíos (usando el color de las esquinas)
        im = trim(im)
        # Hacer transparente el fondo restante si es blanco
        im = make_transparent_bg(im)
        
        # Guardar sobreescribiendo
        im.save(app_dir / "logo-real.png")
        im.save(app_dir / "logo.png")
        
        # Crear ico
        im.save(
            app_dir / "jg-turbo.ico",
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        )
        im.save(
            app_dir / "logo.ico",
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        )
        print("Logo recortado, fondo transparente aplicado y guardado.")
    except Exception as e:
        print(f"Error: {e}")
