/* JG Turbo · La biblioteca en la nube (sincronizar entre tus dispositivos)
 *
 * Regla que manda sobre todo lo demás: **lo local siempre funciona**. La nube
 * es una copia, no la fuente. Si no hay internet, si el servidor está caído o
 * si nunca se vinculó nada, la biblioteca del dispositivo sigue intacta y la
 * app se usa igual. Sincronizar es algo que ocurre encima, y cuando falla se
 * dice y ya está.
 *
 * La llave del dispositivo vive en localStorage con el prefijo `jg_` (que el
 * proyecto respeta como configuración persistente). Nunca se envía a nadie
 * más que a la propia API.
 */
import { decidir, marcarBorrado, necesitaSubirContenido } from './sincronizacion.js';

const CLAVE_LLAVE = 'jg_sync_llave';
const CLAVE_CURSOR = 'jg_sync_cursor';
const CLAVE_BIBLIOTECA = 'jg_sync_biblioteca';

const leer = (clave) => { try { return localStorage.getItem(clave) || ''; } catch (_) { return ''; } };
const escribir = (clave, valor) => { try { localStorage.setItem(clave, valor); } catch (_) { /* modo privado */ } };
const borrar = (clave) => { try { localStorage.removeItem(clave); } catch (_) { /* da igual */ } };

/** Nombre del equipo, solo para que puedas reconocerlo en la lista. */
function nombreDispositivo() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone o iPad';
  if (/Android/i.test(ua)) return 'Celular Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Otro dispositivo';
}

export function crearNube({ pedir, biblioteca }) {
  /* `pedir(ruta, opciones)` hace la petición a la API y devuelve el JSON;
   * `biblioteca` es el almacén local (js/pdf/biblioteca.js). */

  async function llamar(ruta, opciones = {}) {
    const llave = leer(CLAVE_LLAVE);
    const cabeceras = { 'Content-Type': 'application/json' };
    if (llave) cabeceras['X-JG-Llave'] = llave;
    return pedir(ruta, { ...opciones, headers: { ...cabeceras, ...(opciones.headers || {}) } });
  }

  return {
    estaVinculada: () => Boolean(leer(CLAVE_LLAVE)),
    biblioteca: () => leer(CLAVE_BIBLIOTECA),
    /* Para poder enseñarla cuando la persona la pide (no antes). */
    llaveGuardada: () => leer(CLAVE_LLAVE),

    /** Enciende la sincronización en este dispositivo (crea la biblioteca). */
    async activar() {
      const datos = await llamar('/api/sync/crear', {
        method: 'POST',
        body: JSON.stringify({ dispositivo: nombreDispositivo() }),
      });
      escribir(CLAVE_LLAVE, datos.llave);
      escribir(CLAVE_BIBLIOTECA, datos.biblioteca);
      borrar(CLAVE_CURSOR);
      return datos;
    },

    /** Código de 6 dígitos para escribir en el otro dispositivo. */
    async pedirCodigo() {
      return llamar('/api/sync/codigo', { method: 'POST', body: '{}' });
    },

    /** Este dispositivo se une a una biblioteca existente. */
    async vincular(codigo) {
      const datos = await pedir('/api/sync/vincular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: String(codigo || '').trim(), dispositivo: nombreDispositivo() }),
      });
      escribir(CLAVE_LLAVE, datos.llave);
      escribir(CLAVE_BIBLIOTECA, datos.biblioteca);
      borrar(CLAVE_CURSOR);
      return datos;
    },

    async estado() {
      return llamar('/api/sync/estado');
    },

    /** Deja de sincronizar en este dispositivo. Lo guardado aquí no se toca. */
    desconectar() {
      borrar(CLAVE_LLAVE);
      borrar(CLAVE_CURSOR);
      borrar(CLAVE_BIBLIOTECA);
    },

    /** Borra la copia de la nube (y desconecta este dispositivo). */
    async olvidarEnLaNube() {
      try { await llamar('/api/sync/olvidar', { method: 'POST', body: '{}' }); }
      finally { this.desconectar(); }
    },

    /**
     * Sincroniza en las dos direcciones.
     * @returns {{subidos:number, bajados:number}}
     */
    async sincronizar({ alProgresar } = {}) {
      if (!this.estaVinculada()) throw new Error('Este dispositivo no está sincronizando.');
      const avisar = (mensaje) => { if (alProgresar) alProgresar(mensaje); };

      const cursor = leer(CLAVE_CURSOR);
      avisar('Buscando cambios…');
      const remoto = await llamar(`/api/sync/bajar?desde=${encodeURIComponent(cursor)}`);
      const llegados = (remoto.documentos || []).map((d) => ({
        id: d.id,
        actualizado: d.actualizado,
        borrado: d.borrado ? d.actualizado : undefined,
        datos: d.datos,
      }));

      const locales = await biblioteca.exportarParaSincronizar();

      /* Quién gana lo decide siempre el mismo sitio: sincronizacion.js, que
       * es el módulo con pruebas. Aquí no se vuelve a razonar la regla. */
      const aqui = new Map(locales.map((d) => [d.id, d]));
      const alla = new Map(llegados.map((d) => [d.id, d]));
      const aplicar = llegados.filter((remotoDoc) =>
        decidir(aqui.get(remotoDoc.id) || null, remotoDoc) === 'bajar');

      /* ── Traer ─────────────────────────────────────────────────────── */
      let bajados = 0;
      for (const documento of aplicar) {
        avisar(`Trayendo ${bajados + 1} de ${aplicar.length}…`);
        await biblioteca.importarDeSincronizacion(documento);
        if (!documento.borrado) {
          /* El texto viene aparte: se pide capítulo a capítulo, sin límite
           * de tamaño de libro. */
          const respuesta = await llamar(
            `/api/sync/partes?documento=${encodeURIComponent(documento.id)}`
          );
          const partes = respuesta?.partes || [];
          if (partes.length) await biblioteca.importarPartes(documento.id, partes);
        }
        bajados += 1;
      }

      /* ── Enviar ────────────────────────────────────────────────────── */
      const paraSubir = locales.filter((local) => (cursor
        ? (local.actualizado || 0) > (local.sincronizado || 0)
        : decidir(local, alla.get(local.id) || null) === 'subir'));

      let subidos = 0;
      for (const resumen of paraSubir) {
        const paquete = await biblioteca.paqueteParaSubir(resumen.id);
        if (!paquete) continue;
        avisar(`Enviando ${subidos + 1} de ${paraSubir.length}…`);

        /* Primero los datos (ligeros), después el texto por capítulos. */
        await llamar('/api/sync/subir', {
          method: 'POST',
          body: JSON.stringify({ documentos: [paquete] }),
        });

        /* Los capítulos solo viajan si el texto cambió. Si lo único nuevo es
         * por dónde va la lectura, con el registro ligero de arriba basta:
         * así se puede sincronizar el avance cada minuto sin coste. */
        if (!paquete.borrado && necesitaSubirContenido(resumen)) {
          const partes = await biblioteca.partesParaSubir(resumen.id);
           for (let i = 0; i < partes.length; i += 1) {
             if (partes.length > 3) {
               avisar(`Enviando «${resumen.titulo || 'documento'}»: capítulo ${i + 1} de ${partes.length}…`);
             }
             const cuerpo = {
               documento: resumen.id,
               indice: partes[i].indice,
               titulo: partes[i].titulo,
               texto: partes[i].texto,
               traduccion: partes[i].traduccion,
               pulido: partes[i].pulido || null,
               pagina: partes[i].pagina,
               actualizado: paquete.actualizado,
             };
             try {
               await llamar('/api/sync/parte', {
                 method: 'POST',
                 body: JSON.stringify(cuerpo),
               });
             } catch (e) {
               // Compatibilidad: si el servidor aún no conoce 'pulido', reintentar sin él
               const msg = String(e?.message || '');
               if (msg.includes('pulido') || msg.includes('p_pulido')) {
                 const { pulido: _omit, ...sinPulido } = cuerpo;
                 await llamar('/api/sync/parte', { method: 'POST', body: JSON.stringify(sinPulido) });
               } else throw e;
             }
           }
        }

        await biblioteca.marcarSincronizado(paquete.id, paquete.actualizado);
        subidos += 1;
      }

      if (remoto.cursor) escribir(CLAVE_CURSOR, remoto.cursor);

      /* ── Reparar sincronizaciones a medias ─────────────────────────
       * Si alguien cierra la app mientras se suben los capítulos de un libro
       * grande, quedan a medias. La marca de tiempo del documento no cambia,
       * así que sin esto los capítulos que faltan NO llegarían nunca. Se
       * comparan las cuentas y se completa lo que falte, en los dos sentidos.
       */
      const reparados = await completarCapitulos(avisar);
      return { subidos, bajados: bajados + reparados.bajados, reparados: reparados.total };
    },

    marcarBorrado,
  };

  /**
   * Compara cuántos capítulos tiene cada libro aquí y en la nube, y completa
   * lo que falte de cada lado. Es la red de seguridad de los libros grandes.
   */
  async function completarCapitulos(avisar) {
    let subidos = 0;
    let bajados = 0;
    try {
      const resumen = await llamar('/api/sync/resumen-partes');
      const enLaNube = resumen && typeof resumen === 'object' ? resumen : {};
      const locales = await biblioteca.exportarParaSincronizar();

      for (const documento of locales) {
        if (documento.borrado) continue;
        const partes = await biblioteca.partesParaSubir(documento.id);
        const alla = Number(enLaNube[documento.id] || 0);

        /* Faltan capítulos allá: se envían los que no llegaron. */
        if (partes.length > alla) {
          for (let i = alla; i < partes.length; i += 1) {
            avisar(`Completando «${documento.titulo || 'documento'}»: ${i + 1} de ${partes.length}…`);
            const cuerpo = {
              documento: documento.id,
              indice: partes[i].indice,
              titulo: partes[i].titulo,
              texto: partes[i].texto,
              traduccion: partes[i].traduccion,
              pulido: partes[i].pulido || null,
              pagina: partes[i].pagina,
              actualizado: documento.actualizado || Date.now(),
            };
            try {
              await llamar('/api/sync/parte', { method: 'POST', body: JSON.stringify(cuerpo) });
            } catch (e) {
              const msg = String(e?.message || '');
              if (msg.includes('pulido') || msg.includes('p_pulido')) {
                const { pulido: _o2, ...sinP } = cuerpo;
                await llamar('/api/sync/parte', { method: 'POST', body: JSON.stringify(sinP) });
              } else throw e;
            }
            subidos += 1;
          }
        }

        /* Faltan capítulos aquí: se traen todos los del documento. */
        if (alla > partes.length) {
          avisar(`Completando «${documento.titulo || 'documento'}»…`);
          const respuesta = await llamar(
            `/api/sync/partes?documento=${encodeURIComponent(documento.id)}`
          );
          const llegadas = respuesta?.partes || [];
          if (llegadas.length > partes.length) {
            await biblioteca.importarPartes(documento.id, llegadas);
            bajados += 1;
          }
        }
      }
    } catch (error) {
      /* Completar es una reparación: si falla, la próxima vez se reintenta. */
      console.warn('[jg-sync] no se pudo completar capítulos', error);
    }
    return { subidos, bajados, total: subidos + bajados };
  }
}
