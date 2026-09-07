# Plan de mejoramiento: sincronización PDF entre móvil, tablet y escritorio

> Proyecto: JGTurbo · Módulo: PDF + sincronización entre dispositivos
> Fecha: 2026-09-07 · Estado: plan, sin código
> Convención permanente de planes: minúsculas-con-guiones, sin espacios ni tildes.
>
> Estado de implementación (2026-09-07, v101): Fases 1-4 implementadas solo con
> cliente (sin migrar la base): corrección portable en `datos.correccion`,
> confianza al abrir sin pedir el PDF, libro privado, copia-archivo
> `.jgtcopia.json` (con PDF opcional), señal pedir/reenviar, latido ya existente.
> Pendiente con migración de servidor: traspaso binario del PDF por la nube y
> revocación de un aparato desde la nube. Despliegue pendiente de verificación.

## 1. Lo que está pasando hoy

Subes un PDF en el celular. Aparece en escritorio y tablet. Pero al abrirlo en la tablet muchas veces pide hacer correcciones y volver a subir el PDF original.

Eso se siente como si sincronizar no sirviera. La causa no es la red. Es el diseño actual:

- Lo que viaja: texto por capítulos, progreso de lectura, traducciones, pulidos, anclas de posición, manifiesto de límites y carátula pequeña.
- Lo que NO viaja: el PDF original. Se queda en el dispositivo donde se subió. Es deliberado: Vercel rechaza peticiones de más de ~4,5 MB y un libro no cabría, además de que así el archivo no sale del equipo.

En el segundo dispositivo se puede leer, escuchar y traducir. Lo único que no se puede es reprocesar o aplicar OCR sin el archivo.

El problema aparece cuando el libro necesita revalidarse: versión de reconstrucción vieja, límites pendientes o manifiesto insuficiente. La regla actual dice: sin PDF local ni manifiesto suficiente, marcar `needsSource` y no fingir que está corregido. En tu tablet eso se ve como "sube el PDF otra vez".

## 2. Decisión principal: no crear un login compartido

Pregunta del dueño: ¿creo un login de usuario para ver todo en tiempo real?

Respuesta corta: no con correo y contraseña, y jamás compartiendo tu clave con los usuarios.

Por qué:

- Con el sistema actual no hay usuarios ni correos: hay bibliotecas y llaves. Eso mantiene el proyecto fuera de la Ley 1581 (habeas data) porque no se guarda ningún dato personal. Meter registro por correo te vuelve responsable legal: autorización, política, borrado, soporte de recuperación.
- Si das tu llave o tu contraseña a los usuarios, todos escriben sobre la misma biblioteca con la regla "gana el más reciente". Un usuario borra o lee en otro punto y te pisa tu progreso en todos tus dispositivos. Y no podrías quitarle el acceso a uno sin cambiar la clave de todos.
- Recuperación con correo suena cómoda, pero trae verificar correo, spam, contraseñas olvidadas y más superficie de ataque. Hoy la recuperación es una llave que se muestra una vez. Es honesta y simple.

Mejor opción: mantener llaves, pero separar dos cosas que hoy se mezclan:

1. Tu biblioteca privada: solo tus dispositivos, nunca se comparte.
2. Espacios compartidos: copias o vistas de libros concretos para usuarios, cada una con su propia llave, revocable por dispositivo, sin tocar tu biblioteca.

Así no pierdes tu información aunque compartas contenido.

## 3. UX propuesta: que nunca pida el PDF sin explicar por qué

Principios: el aviso va donde está el usuario y dice la verdad. Nada de pedir el archivo a cada rato.

- Abrir en tablet un libro que llegó sin fuente debe decir su estado real: "Listo para leer y escuchar" o "Le faltan N cortes por revisar, se pueden revisar aquí sin el PDF" o "Necesita el PDF original solo para reprocesar".
- La corrección pendiente viaja: si dejaste cortes por revisar en el celular, la tablet los muestra y deja resolverlos ahí. Resolver en un dispositivo cierra el pendiente en todos.
- Botón explícito "Enviar PDF a este dispositivo" solo cuando hace falta reprocesar u OCR. Es una acción con consentimiento, no automática. Dice cuánto pesa y que el archivo saldrá del equipo origen.
- Si dos dispositivos editaron lo mismo, gana el más reciente y se muestra qué ganó: "La tablet tenía un avance más nuevo, se aplicó ese".
- Todo control táctil mínimo 44 px, mismos tokens visuales del lector, sin achicar el área de texto ni obligar a repaginar. Los avisos flotan, no empujan el contenido.

## 4. Arquitectura de alto nivel: corrección portable, fuente bajo demanda

Fuente única de verdad por libro: contenido + decisiones + progreso, no el binario.

- Hoy ya viajan capítulos, manifiesto, anclas y pulidos. Falta que viajen completas las decisiones de corrección: cada límite con su decisión (unir, separar, pendiente) y su origen (usuario o IA), más la cola de corrección pendiente por capítulo.
- Con eso, el segundo dispositivo reconstruye el mismo texto sin reextraer. Solo pide el PDF cuando la tarea lo exige de verdad: reextracción por versión vieja sin manifiesto, OCR de escaneado o PDF dañado.
- Transferencia del PDF solo bajo demanda y por partes: el equipo origen lo trocea en bloques pequeños (para no chocar con el límite de Vercel), el destino lo rearma y verifica por huella. Al terminar, el destino ya corrige solo para siempre.
- Tiempo casi real sin login: mantener el modelo actual (sincronizar al abrir, al ocultar la app y con botón), más un latido corto mientras se lee y reintento de capítulos a medias. El tiempo real total (tipo websocket) queda como opción posterior, no como requisito.
- Separar "cambió el progreso" de "cambió el contenido" para no resubir 40 capítulos por mover el punto de lectura. Esto ya existe y no se toca: es lo que evita gastar datos móviles.

## 5. Fases del trabajo

**Fase 0 — Medir el dolor real**
- Objetivo: confirmar cuántos casos son por falta de fuente y cuántos por decisiones que no viajaron.
- Entregables: conteo de libros con `needsSource`, con pendientes y con versión vieja; lista de los 3 mensajes que más confunden.
- Éxito: sabemos qué porcentaje se arregla solo con corrección portable, sin mover PDFs.

**Fase 1 — Corrección que viaja (sin pedir el PDF)**
- Objetivo: lo corregido en un dispositivo queda corregido en todos.
- Entregables: decisiones por límite y cola pendiente incluidas en la sincronización; la tablet reconstruye desde manifiesto sin reextraer; mensaje honesto cuando sí falta la fuente.
- Éxito: abrir en tablet un libro corregido en el celular ya no pide nada; los pendientes se resuelven en cualquier dispositivo.

**Fase 2 — Compartir sin dar tu clave**
- Objetivo: dar contenido a usuarios sin exponer tu biblioteca.
- Entregables: crear espacio compartido por libro o colección con llave propia, QR o código de un solo uso, modo lectura o copia, revocación por dispositivo, tu biblioteca privada intacta.
- Éxito: un usuario con acceso no puede borrar ni mover tu progreso; revocar a uno no afecta a los demás.

**Fase 3 — Enviar el PDF solo cuando toca**
- Objetivo: eliminar el "sube el PDF otra vez" manual.
- Entregables: acción "Enviar a este dispositivo" con progreso por bloques, verificación por huella, aviso de peso y consentimiento, el destino guarda la fuente y deja de pedirla.
- Éxito: un libro que sí necesitaba fuente se repara en minutos desde la tablet, una sola vez.

**Fase 4 — Pulido y casi-tiempo-real**
- Objetivo: que se sienta instantáneo sin romper lo local-first.
- Entregables: latido mientras se lee, guardado al ocultar la app, reparación de capítulos a medias en ambos sentidos, textos de estado verificados en móvil y escritorio.
- Éxito: leer en el celular y abrir el PC retoma en el punto exacto sin pulsar nada.

## 6. Riesgos y dependencias

- Legal: meter correos y contraseñas te mete en Ley 1581. Mitigación: seguir sin datos personales; compartir por llaves por espacio, no por cuenta.
- Seguridad: una llave compartida que no se puede revocar es una puerta abierta. Mitigación: una llave por dispositivo, solo huellas SHA-256 en el servidor, RLS sin políticas y funciones que validan antes de tocar nada. Nunca guardar llaves en claro ni en Git.
- Técnico: versiones distintas entre dispositivos (JS cacheado) hacen que un equipo no entienda campos nuevos. Mitigación: campos nuevos ignorables por clientes viejos, subir versión de JS y caché juntos, y migraciones aditivas que no borran nada.
- Plataforma: Vercel corta a los 60 s y a ~4,5 MB por petición; Supabase gratis se pausa por inactividad. Mitigación: todo pesado por capítulos o bloques, reintentos con bloques más chicos, y mensaje claro cuando la nube está dormida.
- UX: forzar la subida del PDF siempre gastaría datos y batería. Mitigación: fuente solo bajo demanda y con consentimiento; lo local siempre funciona sin internet.

## 7. Métricas de éxito

- Cero re-subidas innecesarias: % de aperturas en segundo dispositivo que piden el PDF baja a [DATO PENDIENTE — medir base en Fase 0, meta <5%].
- Corrección portable: % de pendientes resueltos en un dispositivo distinto al origen. Meta >80%.
- Continuidad: % de veces que abrir en otro dispositivo retoma el punto exacto sin acción manual. Meta >95%.
- Compartir seguro: cero incidentes donde un usuario pise la biblioteca privada del dueño; revocar un dispositivo toma <1 minuto.
- Técnica: sincronizar un libro típico (~150 KB) en <10 s con red normal; capítulos a medias se reparan solos en la siguiente apertura.

## 8. Lo que no se hará

- No se crea login con correo ni se comparte la llave maestra con usuarios.
- No se sube el PDF siempre ni se guarda en el servidor por defecto.
- No se usa la marca de tiempo para forzar envíos: una carátula o preferencia no puede pisar el progreso.
- No se renombran claves `jg_*` ni almacenes sin migración; un deploy no borra la biblioteca.
