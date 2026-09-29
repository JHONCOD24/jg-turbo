# JG Turbo: doblaje de clases de Udemy

Se probó con una clase falsa, no con Udemy real. La prueba real la hace el dueño.

## Instalar en cinco pasos

1. Abre `chrome://extensions` en Chrome y activa «Modo de desarrollador».
2. Quita la extensión anterior de diagnóstico, si todavía está instalada.
3. Pulsa «Cargar descomprimida» y elige `C:\Users\juanl\Documents\Proyectos\jg-turbo\tmp\udemy-trabajo\extension-udemy`.
4. Recarga una clase en inglés, activa CC en inglés y dale play unos segundos.
5. Abre el icono de JG Turbo y pulsa «Doblar al español»; deja el panel abierto.

Se abre la extensión desde el botón de extensiones de Chrome (la pieza de
rompecabezas), no la aplicación web JG Turbo. Para actualizar esta versión:
cierra el panel, abre `chrome://extensions`, busca «JG Turbo | Udemy» y pulsa
su flecha circular de recarga. Después recarga la clase y abre otra vez la extensión.

## Lista de la prueba real

- [ ] Una clase de cinco minutos o más suena en español completa, sin frases cortadas.
- [ ] Al pausar, adelantar y retroceder en Udemy, la voz lo sigue.
- [ ] El subtítulo se ve en pantalla completa.
- [ ] Al pasar a otra clase y darle play, se dobla sola.
- [ ] Al detener y cerrar el panel, volumen, silencio y velocidad vuelven a sus valores anteriores.
- [ ] Durante unos días no hay avisos extraños ni cierres de sesión en la cuenta.

Comparte esta lista con lo que pasó. Si falla, usa «Diagnóstico de esta clase» y
«Copiar diagnóstico» en el panel. Comparte el JSON y la salida de
`jgDoblajeDiagnostico()` en la consola del panel (clic derecho, Inspeccionar).

No compartas capturas de tu cuenta, contraseñas ni cookies. El JSON no incluye la dirección completa de la clase ni la firma de las pistas. La extensión observa las peticiones de subtítulos del reproductor y no pide ni graba el video.

Texto y voz viven en memoria; solo se guardan los ajustes. Al reabrir el panel
puede hacer falta recargar la clase y activar CC en inglés. Sin subtítulos en inglés
esta versión no dobla. Comparte la cuota de voz de la app; su respaldo puede tardar más.
No hay garantía de que Udemy no cambie o bloquee la extensión.

## Voces y desarrollo web (0.3.0)

En «Voz» puedes elegir Ava o Andrew multilingües, el modo «misma voz» de la
aplicación. El acento regional no aplica en ese modo y se desactiva el selector.
Las dos opciones regionales conservan los seis acentos actuales y muestran sus
nombres: Salomé/Gonzalo, Dalia/Jorge, Elena/Tomás, Catalina/Lorenzo,
Camila/Alex y Paloma/Alonso. No se incluyen Fish ni voces clonadas.

«Conservar términos de desarrollo web» mantiene una lista de tecnicismos en
inglés, tanto en la voz como en el subtítulo, sin escribir guías fonéticas.
Puedes apagarlo en otros cursos. Cambiarlo durante el doblaje detiene la sesión:
pulsa Doblar otra vez para preparar las frases con el ajuste nuevo.
Los términos fuera de la lista y su calidad de pronunciación necesitan revisión
escuchando. Comparte la frase exacta si algún término sigue sonando mal.
