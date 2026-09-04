# Sincronización entre dispositivos · Proyecto B

## Entrega 2026-09-04 · PDF v2.37 · anclas y decisiones de límites

Las partes sincronizadas pueden llevar, además del texto, `atomStart`, `atomEnd`,
`boundaryIds`, `continuation`, `anclaInicio` y `anclaFin`. El documento puede llevar
`versionReconstruccion`, `pendientesLimites`, `listoParaLectura` y `needsSource`.

Un cliente antiguo **ignora** esos campos y sigue leyendo título/texto/página. Un cliente
nuevo los usa para no volver a partir palabras y para conservar la posición de lectura
con anclas textuales tras migrar de v5 a v6.

Si un libro llegó sin PDF y sin manifiesto, el receptor no finge una reconstrucción
perfecta: conserva el texto y marca `needsSource`.

---

## Entrega 2026-09-01 · v1.0 · la biblioteca viaja entre tu celular y tu PC

La biblioteca del Proyecto A vive en cada dispositivo: lo que lees en el
celular no aparece en el computador. Esto lo resuelve, **sin pedir un solo dato
personal**.

### La decisión que ordena todo lo demás

Se preguntó para quién era la cuenta y la respuesta fue **«solo para mí y mis
dispositivos»**. Eso cambió el diseño entero, para bien:

| Con registro público | Como quedó |
|---|---|
| Correos de terceros guardados | **Ningún dato personal** |
| Ley 1581 (habeas data): política, autorización, borrado | **No aplica**: no hay datos de titulares |
| Verificar correo, recuperar contraseña, spam | Un código de 6 dígitos |
| Más superficie que atacar | Una llave y ya |

No hay «usuarios»: hay **bibliotecas**, y quien tiene una llave de una
biblioteca la puede leer y escribir.

### Cómo se une un segundo dispositivo

1. En el PC (que ya tiene llave) se pulsa **Añadir otro dispositivo** → sale un
   código de **6 dígitos**, válido **10 minutos** y de **un solo uso**.
2. En el celular se escribe ese código.
3. El servidor le fabrica **su propia llave** y se la entrega una sola vez.

Lo importante de ese tercer paso: **el servidor nunca guarda ninguna llave en
claro**, solo su huella SHA-256. Si alguien leyera la base entera, no podría
entrar a ninguna biblioteca. Y como cada dispositivo tiene su llave, se le puede
quitar el acceso a uno sin tocar a los demás.

Adivinar un código exige acertar entre un millón, con **cinco intentos contados**
y una ventana de diez minutos.

### La llave de recuperación

Al activar la sincronización se muestra la llave **una sola vez**, con la
advertencia de guardarla. Es la única forma de recuperar la biblioteca si se
pierden todos los dispositivos: no hay correo al que mandar un enlace. Es la
contrapartida honesta de no pedir datos personales, y se dice en pantalla en vez
de esconderla.

### Qué viaja y qué no

Viaja: **texto por capítulos, progreso, traducciones y datos del documento**.
Un libro son ~150 KB, así que sincronizar toma segundos y caben miles en el plan
gratis.

No viaja el **PDF original**: se queda en el dispositivo donde se subió. En el
otro se puede leer, escuchar y traducir; lo único que no se puede es reprocesar
o aplicar OCR sin tener el archivo.

### Qué gana cuando el mismo libro cambió en dos sitios

**Gana el cambio más reciente.** Leer, reiniciar y borrar son todas acciones del
usuario y compiten con la misma vara. Es la regla que menos sorprende: si acabas
de leer en el celular, eso es lo que aparece al abrir el computador.

Un borrado viaja como **una marca**, no como una ausencia: sin eso, el otro
dispositivo devolvería el documento en la siguiente sincronización. La marca se
limpia sola a los 30 días.

Su límite, dicho claro: si el reloj de un dispositivo está muy desajustado, sus
cambios pueden ganar o perder mal. Es el compromiso conocido de esta regla; la
alternativa (resolver conflictos a mano) es peor para una biblioteca personal.

### Por dónde pasan los datos, y dónde vive la seguridad

El navegador **nunca habla con Supabase**: habla con la API del propio proyecto
(`/api/sync/*`, el FastAPI que ya corría en Vercel).

La seguridad **no está en la API, está en la base**:

- Las cuatro tablas tienen RLS **activo y sin políticas**: desde fuera no se
  puede leer ni escribir nada, ni siquiera con la clave pública.
- Lo único accesible son **siete funciones `SECURITY DEFINER`** (`jgt_crear`,
  `jgt_codigo`, `jgt_vincular`, `jgt_estado`, `jgt_bajar`, `jgt_subir`,
  `jgt_olvidar`) que validan la llave de la biblioteca antes de hacer nada.

Eso tiene una consecuencia práctica grande: **basta la clave pública** de
Supabase. No hace falta manejar la `service_role` secreta, que habría obligado
al dueño a copiarla a mano. Aunque alguien copiara la clave pública del código,
no podría leer ni escribir nada sin una llave de biblioteca válida.

**Prefijo `jgt_`:** esa base de Supabase la comparte otra aplicación del mismo
dueño (25 tablas: flashcards, skills, topics…). Todo lo de JG Turbo lleva ese
prefijo para no chocar con nada y poder identificarlo de un vistazo.

**Verificado, no supuesto.** Con una llave y un documento titulado «secreto»
dentro de la base, se consultó desde fuera con las dos claves públicas: ambas
devolvieron `[]`, y escribir dio error de RLS.

### Cuándo sincroniza

Al abrir la pestaña (en segundo plano y sin avisos si todo va bien) y con el
botón **Sincronizar ahora**. No en cada desplazamiento: eso gastaría datos
móviles para nada.

**Lo local siempre funciona.** La nube es una copia, no la fuente: sin internet,
con el servidor caído o sin haber vinculado nada, la app se usa igual.

---

### Archivos

| Archivo | Papel |
|---|---|
| `js/pdf/sincronizacion.js` | Quién gana un conflicto. Funciones puras, con pruebas |
| `js/pdf/nube.js` | El cliente: activar, vincular, subir y bajar |
| `js/pdf/biblioteca.js` | Puente con el almacén local y marcas de borrado |
| `api/sync.py` | Los endpoints. En su propio módulo: `index.py` ya era enorme |
| `api/sync_esquema.sql` | Las cuatro tablas, con RLS y limpieza |
| `index.html` | El panel de sincronización |

### Pruebas

| Prueba | Qué cubre |
|---|---|
| `node tests/test_pdf_sincronizacion.mjs` | 38 casos de fusión: leer en el celular y abrir el PC, reiniciar, borrados viejos y nuevos, listas vacías, 5.000 documentos |
| `python -m pytest backend/tests/test_sync_api.py` | 26 casos de la API: **que la llave nunca se guarde en claro**, que una llave no abra otra biblioteca, códigos que caducan, se gastan y se bloquean |

| `node tests/verificar_sync_dos_dispositivos.mjs` | **La prueba que importa**: dos navegadores separados, subir en uno, vincular con el código y comprobar que el libro llega al otro con su progreso |

Resultados medidos:

- **38 comprobaciones** de fusión · pasan (5.000 documentos en 4 ms)
- **25 pruebas** de la API · pasan
- **165 pruebas** de Python en total · pasan
- Flujo completo probado **dentro de la base real** y **contra producción**
- Interfaz verificada en escritorio y móvil: sin servidor explica el fallo y deja reintentar

### Un bug que atrapó una prueba antes de producción

El cursor de sincronización es una fecha ISO con zona horaria (`…+00:00`). En
una URL, el signo `+` significa espacio, así que el cursor llegaba roto y se
volvían a descargar documentos ya sincronizados. Ahora el servidor lo repara en
vez de confiar en que todos los clientes lo codifiquen bien, y hay una prueba
que lo manda de las dos formas.

---

## Puesta en marcha · COMPLETADA (2026-09-01)

Todo quedó configurado y funcionando, sin pasos manuales pendientes:

| Paso | Estado |
|---|---|
| Proyecto Supabase `jg-PRUEBA` despierto | Hecho |
| Tablas `jgt_*` creadas con RLS | Hecho (migración `jg_turbo_sync_v1`) |
| Siete funciones de acceso | Hecho (migración `jg_turbo_sync_funciones`) |
| `SUPABASE_URL` en Vercel | Hecho |
| `SUPABASE_ANON_KEY` en Vercel | Hecho |
| Desplegado y verificado | Hecho |

**Prueba real en producción (2026-09-01):** el computador creó su biblioteca
(llave de 64 caracteres), pidió el código `744117`, el celular se unió con él, y
el libro apareció allí **con su texto completo y abriendo en el capítulo 3**,
que era donde iba el computador. Cero errores de JavaScript.

### Un tropiezo que quedó documentado

La primera migración se aplicó **mientras el proyecto se estaba restaurando** y
se perdió al terminar la restauración: `list_tables` mostraba las tablas creadas
pero la base real seguía sin ellas. Lección: tras un `restore`, esperar a que el
proyecto responda de verdad antes de escribir en él, y **verificar con una
consulta** en vez de fiarse del «success».

---

## Historial del diseño anterior (referencia)

*(Esto describe el plan inicial, que exigía la clave secreta `service_role`. Se
cambió por el diseño con funciones en la base, que no la necesita. Se conserva
por si algún día hiciera falta volver a ese camino.)*

### 1. Despertar el proyecto de Supabase

El proyecto `jg-PRUEBA` (`xuyxgzxseoetidzfqntu`) está pausado por inactividad.
En [supabase.com/dashboard](https://supabase.com/dashboard) → **Restore project**.

Después, aplicar `api/sync_esquema.sql` desde el editor SQL del panel.

### 2. La clave de servicio en Vercel

`SUPABASE_URL` **ya quedó configurada** en producción
(`https://xuyxgzxseoetidzfqntu.supabase.co`). Falta la otra:

```
npx vercel env add SUPABASE_SERVICE_KEY production --scope jhoncod24s-projects
```

El valor se copia de Supabase → Project Settings → API → **service_role**.

Esa clave es **secreta**: va solo en Vercel, nunca en el código, en el chat ni
en Git. Por eso la pone el dueño del proyecto y no el asistente.

Después de añadirla hay que **volver a desplegar** para que la función la tome.

Mientras falte, los endpoints responden 503 con un mensaje claro y el resto de
la app funciona igual.

### Estado verificado en producción (2026-09-01)

Las siete rutas responden correctamente sin la base todavía conectada:

| Ruta | Respuesta | Significa |
|---|---|---|
| `GET /api/sync/estado` | 401 | Existe y exige llave |
| `GET /api/sync/bajar` | 401 | Existe y exige llave |
| `POST /api/sync/crear` | 503 | Existe; falta la clave de servicio |
| `POST /api/sync/codigo` | 401 | Existe y exige llave |
| `POST /api/sync/vincular` | 422 | Existe; exige un código |
| `POST /api/sync/subir` | 422 | Existe; exige documentos |
| `POST /api/sync/olvidar` | 401 | Existe y exige llave |

### Aviso permanente sobre el plan gratis

Supabase pausa un proyecto gratuito tras ~7 días sin actividad. Si eso ocurre,
la app no falla en silencio: muestra *«Tu sincronización está dormida: entra a
supabase.com y pulsa Restore project»*.
