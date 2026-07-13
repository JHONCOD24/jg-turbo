[RESOLVED] Debug Session: blob-aborted-audio

## Sintoma
- En consola del navegador aparece: `net::ERR_ABORTED blob:http://localhost:8000/...`

## Esperado
- La reproducción/uso del audio temporal no debería generar errores visibles o, si son inocuos, no deberían confundir al usuario.

## Hipotesis
- H1: El `blob:` se aborta porque la app revoca el `ObjectURL` demasiado pronto con `URL.revokeObjectURL(...)`.
- H2: El `blob:` se aborta al reemplazar `audio.src` o limpiar la grabación mientras el navegador aún intenta cargar el recurso.
- H3: El error viene del flujo de descarga/reproducción y es benigno, pero queda expuesto en consola.
- H4: La sincronización entre modal/reproductor/limpieza dispara una navegación interna al `blob:` que luego se cancela.

## Evidencia inicial
- Error de preview: `net::ERR_ABORTED blob:http://localhost:8000/...`

## Estado
- RESUELTO (2026-06-17, revisión doctor-codigo): confirmado H1+H2, es benigno.
  En index.html:2142-2147 y :2160-2165, el orden es: pausar audio → quitar src →
  audio.load() → revocar el ObjectURL anterior. El navegador reporta
  `net::ERR_ABORTED` porque la propia app le pide cancelar la carga del blob viejo
  antes de revocarlo; es el efecto esperado de una limpieza correcta, no una fuga
  ni un fallo funcional. No requiere cambio de código.
