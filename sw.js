/* JG Turbo · service worker
 * - Hace la app instalable (PWA)
 * - Recibe audios compartidos (WhatsApp → Compartir → JG Turbo) vía share_target
 */
/* v2: sube CACHE_SHELL al desplegar UI nueva para que el rediseño no quede
 * atrapado en el shell viejo. Network-first en HTML/navegación. */
const CACHE_SHELL = 'jg-turbo-shell-v83';
const CACHE_SHARE = 'jg-turbo-share-v1';
const SHARE_KEY = 'shared-audio';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) =>
      cache.addAll(['/', '/index.html', '/manifest.webmanifest']).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_SHELL && k !== CACHE_SHARE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo misma origen
  if (url.origin !== self.location.origin) return;

  // Share Target: WhatsApp / Galería → POST multipart con el audio
  if (req.method === 'POST' && (url.pathname === '/share-target' || url.pathname.endsWith('/share-target'))) {
    event.respondWith(handleShareTarget(req));
    return;
  }

  // HTML / navegación: siempre red primero (el diseño cambia a menudo)
  const esHtml =
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html') ||
    (req.headers.get('accept') || '').includes('text/html');
  if (esHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_SHELL).then((c) => {
              c.put('/', copy.clone()).catch(() => {});
              c.put('/index.html', copy).catch(() => {});
            }).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  /* Módulos y motores de /js/ (el lector de PDF pesa 1,7 MB y el de OCR
   * unos 6 MB cuando se usa): se sirven del caché al instante y se actualizan
   * por detrás. Así la app abre un PDF sin internet y aun así recibe las
   * mejoras del siguiente despliegue sin quedarse pegada a una versión vieja.
   * Solo se guarda lo que de verdad se descargó. */
  if (req.method === 'GET' && url.pathname.startsWith('/js/')) {
    event.respondWith(
      caches.open(CACHE_SHELL).then((cache) =>
        cache.match(req).then((guardado) => {
          const red = fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
              return res;
            })
            .catch(() => guardado);
          return guardado || red;
        })
      )
    );
  }
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    // El manifest declara name: "audio"; algunos clientes usan "file" o el primer File
    let file =
      formData.get('audio') ||
      formData.get('file') ||
      formData.get('media') ||
      null;

    if (!(file instanceof File) || !file.size) {
      for (const value of formData.values()) {
        if (value instanceof File && value.size > 0) {
          file = value;
          break;
        }
      }
    }

    if (file instanceof File && file.size > 0) {
      const headers = new Headers({
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'whatsapp-audio.ogg'),
        'X-Size': String(file.size),
        'X-Shared-At': String(Date.now()),
      });
      const cache = await caches.open(CACHE_SHARE);
      await cache.put(SHARE_KEY, new Response(file, { headers }));
    }
  } catch (err) {
    // Seguimos redirigiendo aunque falle el parseo
    console.error('[jg-sw] share-target', err);
  }

  // 303 → la app abre en la pestaña correspondiente y consume el archivo guardado.
  // Un PDF va al lector de PDF; lo demás (audio y video) va a la pestaña Archivo.
  const tipo = (file && file.type) || '';
  const nombre = (file && file.name) || '';
  const esPdf = tipo === 'application/pdf' || /\.pdf$/i.test(nombre);
  const dest = new URL(
    esPdf ? '/?shared=1&tab=pdf' : '/?shared=1&tab=file',
    self.location.origin
  ).href;
  return Response.redirect(dest, 303);
}
