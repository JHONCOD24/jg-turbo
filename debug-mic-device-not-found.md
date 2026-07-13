[RESOLVED] Debug Session: mic-device-not-found

## Sintoma
- El navegador muestra: `No se pudo abrir el mic para MediaRecorder: NotFoundError: Requested device not found`.

## Esperado
- La app debe acceder al micrófono o, si no existe uno disponible, mostrar una guía clara y no fallar de forma confusa.

## Hipotesis
- H1: El equipo no tiene ningún dispositivo de entrada de audio disponible o está desconectado.
- H2: El navegador sí tiene permisos, pero el micrófono predeterminado cambió y `getUserMedia()` queda apuntando a un dispositivo inexistente.
- H3: El navegador/Windows está bloqueando el acceso al micrófono para esta sesión o para el navegador.
- H4: La app no maneja bien `NotFoundError` y solo registra el error en consola, sin dar feedback útil al usuario.

## Evidencia inicial
- Consola del navegador: `NotFoundError: Requested device not found` al ejecutar `iniciarMediaRecorder()`.

## Estado
- RESUELTO (2026-06-17, revisión doctor-codigo): descartado H4. index.html:2076-2086
  ya distingue NotFoundError/DevicesNotFoundError, NotAllowedError/PermissionDeniedError
  y NotReadableError, mostrando un mensaje claro al usuario en cada caso (no solo log
  en consola). Si el síntoma reaparece, la causa es H1/H2/H3 (hardware o permisos de
  Windows reales), no un bug de la app.
