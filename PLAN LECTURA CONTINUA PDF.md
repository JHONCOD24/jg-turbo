# Plan · Lectura continua del PDF: retomar donde quedaste, navegar sin pelear y que suene bien

> **Para el agente que ejecuta este plan:** implementa tarea por tarea, en orden. Cada tarea
> termina con una prueba que corre y un commit. No pases a la siguiente sin que la anterior
> esté en verde. Los pasos usan `- [ ]` para que marques avance.

**Objetivo:** que quien lee o escucha un libro en JG Turbo pueda cerrar la app en cualquier
momento —incluso porque se apagó el celular— y al volver, en el mismo dispositivo o en otro,
aterrice **exactamente en la frase donde quedó**; que pueda adelantar y retroceder por contenido
(frase, párrafo, capítulo) en vez de por minutos; que los títulos no se peguen al texto y la voz
suene fluida; y que entienda qué hace la auditoría mientras la hace.

**Arquitectura:** todo se resuelve en el cliente. La posición de lectura pasa de ser una
*fracción de scroll* (que no significa lo mismo en un celular que en una tablet) a un **ancla de
texto portable** (índice de carácter + fragmento de respaldo). La sincronización deja de
arrastrar el libro entero cada vez que avanzas: se separa «cambió el progreso» de «cambió el
texto». Las pausas de lectura en voz alta se aplican **solo en la capa efímera que va al motor
de voz**, nunca en el texto que ves. **No se toca el esquema de Supabase ni se crea ningún
endpoint nuevo.**

**Stack:** JavaScript nativo (módulos ES) · IndexedDB · FastAPI (Python) en `api/` ·
pruebas con `node tests/<archivo>.mjs` (sin framework) y `pytest` en `backend/tests/`.

**Origen:** este plan nace de la revisión del código del 3 de septiembre de 2026 sobre el
commit `5984269` («Estado real del proyecto: lector de PDF v4.1 (app v2.26.0)»). Continúa
`PLAN pulir gramatica pdf.md` y `CAMBIOS_PDF.md` (v4.1), y respeta sus invariantes.

---

## 0. Reglas obligatorias antes de tocar nada

Estas reglas no son sugerencias. Si alguna no se cumple, **detente y avisa** en vez de improvisar.

### 0.1 La ruta del proyecto cambió

El repositorio se reestructuró el 3 de septiembre de 2026. La app ya **no** vive en
`Spech to text App/` ni se despliega desde `vercel_deploy/`:

| Antes | Ahora |
|---|---|
| `Proyectos\JG Turbo\Spech to text App\` | `Proyectos\jg-turbo\` (app en la raíz) |
| `Proyectos\JG Turbo\vercel_deploy\` | ya no existe |
| — | `Proyectos\JG Turbo_OLD\` (respaldo, **solo lectura**) |

**Ruta de trabajo:** `C:\Users\juanl\Documents\Proyectos\jg-turbo\`

**Nunca escribas en `JG Turbo_OLD\`.** Es el respaldo de la estructura anterior y solo se usa
para recuperar archivos que la migración dejó atrás (ver Tarea 0).

### 0.2 Hay otro agente trabajando en este repositorio

- **Antes de empezar**, corre `git status` y `git log --oneline -5`. Si el árbol de trabajo
  tiene cambios sin commitear que tú no hiciste, **no los toques ni los descartes**: avisa al
  usuario y espera.
- Trabaja en una rama propia: `git checkout -b lectura-continua-pdf`. No hagas `rebase`,
  `reset --hard`, `checkout --` ni `push --force` sobre `main`.
- Si `AGENTS.md`, `CAMBIOS_PDF.md` o `index.html` cambian bajo tus pies durante el trabajo,
  vuelve a leerlos antes de seguir editando.

### 0.3 Identidad de Git (obligatorio para que Vercel no bloquee el despliegue)

```bash
git config user.name "JHONCOD24"
git config user.email "juanloras35@gmail.com"
```

Nunca uses `186778938+JHONCOD24@users.noreply.github.com`: produce *Deployment Blocked*.

### 0.4 Invariantes que este plan NO puede romper

Vienen de `PLAN pulir gramatica pdf.md` y de la entrega v4.0. Romper una es motivo de rechazo:

1. **El texto original es inmutable.** Ninguna tarea de este plan puede insertar, borrar,
   sustituir ni reordenar una sola palabra del texto que se muestra en pantalla.
2. **Las pausas y ayudas de pronunciación son efímeras.** Viven solo en la salida de
   `prepararParaVoz()`, que se genera justo antes de hablar y se descarta. No se guardan,
   no se exportan, no se sincronizan.
3. **Nada se envía a la IA sin consentimiento explícito** del usuario para ese PDF.
4. **La configuración con prefijo `jg_` en `localStorage` es persistente.** No se borra ni se
   renombra sin migración.
5. **Lo local siempre funciona.** La nube es una copia; si falla, la app sigue funcionando.

### 0.5 Cómo se cierra cada entrega

Una mejora **no está terminada** hasta que:
1. Sus pruebas corren en verde (las nuevas y las de regresión).
2. Está documentada en `CAMBIOS_PDF.md` con el formato de las entregas anteriores
   (Lo pedido · Corrección · Pruebas · Deploy).
3. Está desplegada y **verificada contra `https://jg-turbo.vercel.app`** buscando un marcador
   del cambio en el HTML servido y `/api/health` — nunca contra la URL que imprime el CLI.

**Comando de despliegue:** desde `C:\Users\juanl\Documents\Proyectos\jg-turbo\`

```bash
npx vercel --prod --yes --scope jhoncod24s-projects
```

> ⚠️ **Verifica esto antes de desplegar.** `AGENTS.md` todavía describe el flujo antiguo
> («sincroniza `Spech to text App/` → `vercel_deploy/`») y en la raíz sigue existiendo
> `sincronizar_deploy.mjs`, que apunta a carpetas que ya no existen. Con el repo aplanado el
> despliegue sale de la raíz. **Confirma con el usuario** cuál es el flujo vigente antes del
> primer `vercel --prod`, y **actualiza `AGENTS.md`** como parte de la última tarea.

---

## 1. Diagnóstico: por qué pasa lo que pasa

Cada punto está verificado en el código, con archivo y línea. Léelo completo: las tareas
corrigen estas causas, no los síntomas.

### 1.1 «Vuelvo a entrar y el capítulo empieza de cero»

Hay **tres** causas encadenadas, no una:

**Causa A — el pulido borra la posición recién restaurada.**
`montarDocumento()` restaura el scroll en `js/pdf/pdfController.js:940-942` y, tres líneas
después (`:943-945`), lanza `asegurarPulido(..., { mostrar: true })`. Cuando ese pulido termina,
`mostrarPulido()` hace `el.salida.value = ...` (`js/pdf/pdfController.js:1225-1231`) **sin
volver a poner el scroll**. Reemplazar el contenido de un `<textarea>` lo devuelve al inicio.
Resultado: el usuario aterriza en la primera línea del capítulo. Lo mismo ocurre con la
traducción en `js/pdf/pdfController.js:1495-1497`.

**Causa B — la posición no significa lo mismo en dos pantallas.**
`desplazamientoActual()` (`js/pdf/pdfController.js:766-770`) guarda
`scrollTop / (scrollHeight - clientHeight)`: una **fracción visual**. Ese mismo 0,42 apunta a
párrafos distintos en un celular angosto y en una tablet ancha, porque el texto se reacomoda.
Al restaurar (`js/pdf/pdfController.js:803-806`) se multiplica por el alto del nuevo
dispositivo, así que la posición se desplaza.

**Causa C — la restauración se intenta una sola vez, demasiado pronto.**
El `requestAnimationFrame` de `js/pdf/pdfController.js:803` corre antes de que el navegador
haya terminado de maquetar el texto. Si `scrollHeight` todavía no es el definitivo,
`alto <= 0` y el scroll queda en 0.

### 1.2 «Leo en el celular y en la tablet no aparece dónde quedé»

**Causa D — la sincronización casi nunca se dispara.**
`sincronizarAhora()` (`js/pdf/pdfController.js:2963`) solo se llama al reiniciar un libro
(`:375`), al borrarlo (`:447`), al terminar de procesar un PDF nuevo (`:1639`), al volver a la
biblioteca (`:2325`) y al cerrar el documento (`:2715`). **No hay ningún `visibilitychange`,
`pagehide` ni sincronización periódica.** Si el celular se apaga, si el usuario cambia de app o
si simplemente deja el libro abierto, el progreso **jamás sale del dispositivo**.

**Causa E — avanzar en la lectura marca el libro entero como «cambiado».**
`guardarProgreso()` (`js/pdf/biblioteca.js:284-296`) hace `doc.actualizado = Date.now()`. La
sincronización interpreta esa marca como «cambió el documento» y en
`js/pdf/nube.js:158-188` sube **todos los capítulos de texto** otra vez. En un libro de 40
capítulos son 40 peticiones para comunicar un dato de 20 bytes. Es lento, gasta cuota, y si el
usuario cierra a mitad, la sincronización queda incompleta.

### 1.3 «Adelantar es engorroso: no sé dónde darle play»

Los únicos controles de navegación son **±10 segundos** (`TTS_SALTO_SEG = 10` en
`index.html:11524`, botones creados en `index.html:13740-13748`) y una **barra de tiempo**
(`index.html:13744`). Ambos hablan en minutos y segundos; el lector piensa en frases, párrafos y
capítulos. No existe forma de decir «empieza a leer *aquí*»: tocar un párrafo del texto no hace
nada.

Lo llamativo es que **la pieza difícil ya está construida**: `situarBloques()`
(`js/pdf/pdfController.js:2424-2452`) sabe en qué carácter del texto empieza cada bloque de
audio, y `posicionDeVoz()` (`:2455-2465`) traduce el avance del audio a una posición exacta en
el texto. Falta el camino inverso —de un punto del texto al segundo de audio— y los botones.

### 1.4 «El título se pega al párrafo y no se lee fluido»

**Causa F — la auditoría aplasta los saltos de párrafo.**
`aplicarSignos()` (`js/pdf/pulido.js:166-187`) reconstruye el bloque con
`salida += sep + tok` donde `sep = i ? ' ' : ''` (`:182-183`). Es decir: **une todos los tokens
con espacios simples y destruye los `\n\n`**. El guardián `mismasPalabras()` lo aprueba porque
solo compara palabras normalizadas (`:46-54`) e ignora los saltos de línea. Un título que estaba
separado queda pegado al párrafo siguiente, y la voz lo lee de corrido.

**Causa G — muchos títulos no se detectan como títulos.**
`pareceTitulo()` (`js/pdf/limpiezaTexto.js:174-183`) solo reconoce un título si coincide con
`PATRON_TITULO` (palabras como «capítulo», «prólogo») **o** si está impreso ≥25 % más grande.
Un título en negrita o versalitas del mismo tamaño no se detecta, así que nunca se separa como
párrafo propio ni recibe el punto de cierre de la regla 8 (`:231-240`). Además existe una
**segunda definición de título, distinta e incompatible**, en `clasificarBloque()`
(`js/pdf/limpiezaTexto.js:296`): `t.length < 90 && /^[A-ZÁÉÍÓÚÑ][^.!?]*$/`. Dos criterios que no
coinciden producen bloques mal tipados.

**Causa H — se retiraron las comas prosódicas y no se repuso nada equivalente.**
La v3.2 había añadido una coma antes de `pero/aunque/porque/...` para que las frases largas no
se cortaran en mitad. La v4.0 la retiró (`js/pdf/limpiezaTexto.js:246-250`) —correctamente, para
no alterar el original— y trasladó esas comas a *propuestas* que el usuario debe aceptar a mano
en la hoja de revisión. En la práctica nadie las acepta una por una, así que el texto llega al
motor de voz sin ninguna pausa interna y `ttsPartirTexto` corta donde puede. **Este plan repone
la fluidez donde sí corresponde: en la capa de voz.**

### 1.5 «Hay un puntico verde y no sé qué está pasando»

El indicador es `#pdfPulidoEstado`, pintado por `mostrarPulidoEstado()`
(`js/pdf/pdfController.js:981-995`). Muestra cadenas cortas —`Auditando 3 de 47`,
`Cambios por revisar`, `Completa`— y **se esconde solo a los 4 segundos**
(`:1007`). Problemas concretos:

- **Nunca explica qué es la auditoría**, para qué sirve ni qué NO hace.
- El consentimiento se pide con `window.confirm()` (`js/pdf/pdfController.js:1015`): un diálogo
  del navegador, bloqueante, con un párrafo de texto legal dentro y sin forma de decir «cuéntame
  más». En móvil se ve especialmente mal.
- `estadoAuditoriaTexto()` (`js/pdf/auditoria.js:54-61`) devuelve `'Cambios por revisar'` como
  caso por defecto **aunque no haya ninguna propuesta pendiente** — el propio código lo admite
  en el comentario de la línea 59.
- No hay forma de pausar, reanudar ni ver el detalle del avance.

### 1.6 Riesgo detectado: la migración dejó atrás la red de seguridad

`CAMBIOS_PDF.md` documenta que estas pruebas existen y pasan, pero **no están en el repo nuevo**.
Solo sobrevivió `tests/test_pdf_auditoria_p0.mjs`:

| Prueba que falta | Sigue en el respaldo |
|---|---|
| `test_pdf_progreso.mjs` | `JG Turbo_OLD\Spech to text App\tests\` |
| `test_pdf_limpieza.mjs` (38 casos) | idem |
| `test_pdf_sincronizacion.mjs` | idem |
| `test_pdf_pulido_mecanico.mjs` | idem |
| `test_pdf_pulido_troceo.mjs` | idem |
| `test_pdf_exportar.mjs` | idem |
| `test_pdf_busqueda.mjs` | idem |
| `test_pdf_traduccion.mjs` | idem |
| `verificar_pdf_geometria.mjs` | idem |
| `verificar_pdf_navegador.mjs` | idem |
| `backend/tests/test_pdf_ask.py` | `JG Turbo_OLD\Spech to text App\backend\tests\` |

Tres de ellas (`progreso`, `limpieza`, `sincronizacion`) cubren justo los módulos que este plan
modifica. **Sin ellas, cualquier cambio es a ciegas.** Por eso la Tarea 0 las restaura.

---

## 2. Mapa de archivos

| Archivo | Responsabilidad tras el plan | Tareas |
|---|---|---|
| `js/pdf/progreso.js` | Modelo de posición de lectura, ahora con ancla de texto portable | 1 |
| `js/pdf/anclaTexto.js` | **NUEVO.** Localizar una posición en un texto que pudo cambiar | 1 |
| `js/pdf/pdfController.js` | Capturar, restaurar y sincronizar la posición; controles nuevos | 2, 3, 6, 7, 10 |
| `js/pdf/biblioteca.js` | Separar «cambió el progreso» de «cambió el contenido» | 4 |
| `js/pdf/nube.js` | Subir solo lo ligero cuando solo cambió el progreso | 4 |
| `js/pdf/pulido.js` | `aplicarSignos()` deja de aplastar los párrafos | 8 |
| `js/pdf/limpiezaTexto.js` | Detección de títulos unificada y más amplia | 9 |
| `js/pdf/vozTexto.js` | Pausas prosódicas efímeras (título, frases largas) | 10 |
| `js/pdf/auditoria.js` | Estados honestos y explicables | 11 |
| `index.html` | Controles del reproductor, hoja de auditoría, CSS móvil | 6, 7, 11 |
| `tests/*.mjs` | Red de seguridad restaurada y ampliada | 0 y todas |

---

## Tarea 0 · Restaurar la red de seguridad

**Por qué primero:** vas a modificar `progreso.js`, `limpiezaTexto.js`, `pulido.js` y
`sincronizacion.js`. Sus pruebas existen pero se quedaron en el respaldo. Sin ellas no puedes
saber si rompes algo.

**Archivos:**
- Copiar a: `tests/` (10 archivos `.mjs`)
- Copiar a: `backend/tests/test_pdf_ask.py`

- [ ] **Paso 1: Comprobar que no pisas trabajo ajeno**

```bash
cd "C:\Users\juanl\Documents\Proyectos\jg-turbo"
git status --short
git log --oneline -5
```

Esperado: árbol limpio en `main`, último commit `5984269`. Si hay cambios sin commitear que no
son tuyos, **detente y avisa al usuario**.

- [ ] **Paso 2: Crear la rama de trabajo**

```bash
git checkout -b lectura-continua-pdf
```

- [ ] **Paso 3: Copiar las pruebas que faltan (sin sobrescribir la que ya está)**

```powershell
$origen = 'C:\Users\juanl\Documents\Proyectos\JG Turbo_OLD\Spech to text App\tests'
$destino = 'C:\Users\juanl\Documents\Proyectos\jg-turbo\tests'
$archivos = @(
  'test_pdf_progreso.mjs','test_pdf_limpieza.mjs','test_pdf_sincronizacion.mjs',
  'test_pdf_pulido_mecanico.mjs','test_pdf_pulido_troceo.mjs','test_pdf_exportar.mjs',
  'test_pdf_busqueda.mjs','test_pdf_traduccion.mjs',
  'verificar_pdf_geometria.mjs','verificar_pdf_navegador.mjs'
)
foreach ($a in $archivos) {
  if (-not (Test-Path "$destino\$a")) { Copy-Item "$origen\$a" "$destino\$a" }
}
Get-ChildItem $destino -Name
```

- [ ] **Paso 4: Copiar la prueba de backend**

```powershell
$o = 'C:\Users\juanl\Documents\Proyectos\JG Turbo_OLD\Spech to text App\backend\tests\test_pdf_ask.py'
$d = 'C:\Users\juanl\Documents\Proyectos\jg-turbo\backend\tests\test_pdf_ask.py'
if (-not (Test-Path $d)) { Copy-Item $o $d }
```

- [ ] **Paso 5: Correr todo y anotar el estado de partida**

```bash
node tests/test_pdf_progreso.mjs
node tests/test_pdf_limpieza.mjs
node tests/test_pdf_sincronizacion.mjs
node tests/test_pdf_pulido_mecanico.mjs
node tests/test_pdf_pulido_troceo.mjs
node tests/test_pdf_exportar.mjs
node tests/test_pdf_busqueda.mjs
node tests/test_pdf_traduccion.mjs
node tests/test_pdf_auditoria_p0.mjs
```

Esperado: todas terminan sin `FALLO:`. **Si alguna falla ahora, anótalo en el commit y avisa
al usuario**: es una regresión que dejó la migración, no la causaste tú. No la arregles dentro
de esta tarea salvo que sea de una línea y evidente.

- [ ] **Paso 6: Commit**

```bash
git add tests/ backend/tests/
git commit -m "test: restaurar las pruebas de PDF que la reestructuracion dejo atras"
```

---

## Tarea 1 · Ancla de texto portable (el corazón del plan)

**Idea en una frase:** en vez de guardar «vas por el 42 % del scroll», guardamos «vas por el
carácter 5820, y por si el texto cambió, ahí decía *y entonces comprendió que*».

Un índice de carácter solo no basta: si el capítulo se re-audita, se pule o se traduce, el
texto cambia de longitud y el índice apunta a otro lado. El fragmento de respaldo permite
**volver a encontrar** la posición buscándolo. Es la técnica que usan los lectores de libros
electrónicos.

**Archivos:**
- Crear: `js/pdf/anclaTexto.js`
- Modificar: `js/pdf/progreso.js:21-23` (`progresoInicial`) y `:94-103` (`avanzarProgreso`)
- Prueba: `tests/test_pdf_ancla.mjs` (nueva) y `tests/test_pdf_progreso.mjs` (ampliar)

**Interfaces:**
- Produce: `construirAncla(texto, caracter)` → `{ caracter, cita, antes }`
- Produce: `resolverAncla(texto, ancla)` → `number` (índice de carácter, siempre válido)
- Produce: `progresoInicial()` con campos nuevos `caracter: 0, cita: '', antes: ''`
- Produce: `avanzarProgreso(progreso, { parte, desplazamiento, caracter, cita, antes })`
- Consume: nadie todavía (la Tarea 2 lo conecta)

- [ ] **Paso 1: Escribir la prueba que falla**

Crea `tests/test_pdf_ancla.mjs`:

```javascript
/* Pruebas del ancla de texto: recuperar la posición de lectura aunque el
 * texto haya cambiado de tamaño (pulido, auditoría, traducción).
 * Ejecutar: node tests/test_pdf_ancla.mjs
 */
import { construirAncla, resolverAncla } from '../js/pdf/anclaTexto.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

const TEXTO = 'Primero vino la duda. Después vino la certeza. Y entonces comprendio que nada volveria a ser igual. Final del capitulo.';

/* ── Construir ────────────────────────────────────────────────────── */
{
  const a = construirAncla(TEXTO, 46);
  comprobar(a.caracter === 46, 'guarda el índice de carácter');
  comprobar(a.cita.length > 0 && TEXTO.includes(a.cita), 'la cita existe en el texto');
  comprobar(typeof a.antes === 'string', 'guarda el fragmento anterior');
}
{
  const a = construirAncla('', 0);
  comprobar(a.caracter === 0 && a.cita === '', 'texto vacío no rompe');
  const b = construirAncla(TEXTO, 99999);
  comprobar(b.caracter <= TEXTO.length, 'un índice fuera de rango se acota');
  const c = construirAncla(TEXTO, -5);
  comprobar(c.caracter === 0, 'un índice negativo se acota a cero');
}

/* ── Resolver sobre el mismo texto ────────────────────────────────── */
{
  const a = construirAncla(TEXTO, 46);
  comprobar(resolverAncla(TEXTO, a) === 46, 'sobre el texto idéntico devuelve el mismo punto');
}

/* ── Resolver cuando el texto cambió ──────────────────────────────── */
{
  /* La auditoría añadió signos: el texto crece y el índice viejo ya no sirve. */
  const a = construirAncla(TEXTO, 46);
  const CAMBIADO = '¡Primero vino la duda! Después, vino la certeza. Y entonces comprendio que nada volveria a ser igual. Final del capitulo.';
  const pos = resolverAncla(CAMBIADO, a);
  const alrededor = CAMBIADO.slice(Math.max(0, pos - 4), pos + 20);
  comprobar(alrededor.includes('Y entonces'), `re-localiza tras cambiar signos (encontró "${alrededor.trim()}")`);
}
{
  /* Un texto completamente distinto: no puede inventar, pero tampoco romper. */
  const a = construirAncla(TEXTO, 46);
  const OTRO = 'Un texto que no tiene absolutamente nada que ver con el anterior.';
  const pos = resolverAncla(OTRO, a);
  comprobar(pos >= 0 && pos <= OTRO.length, 'ante texto distinto devuelve una posición válida');
}
{
  const a = construirAncla(TEXTO, 46);
  comprobar(resolverAncla('', a) === 0, 'texto vacío devuelve 0');
  comprobar(resolverAncla(TEXTO, null) === 0, 'ancla nula devuelve 0');
  comprobar(resolverAncla(TEXTO, { caracter: 20 }) === 20, 'ancla sin cita usa el índice');
}

/* ── El acento y la mayúscula no deben impedir el reencuentro ─────── */
{
  const a = construirAncla(TEXTO, 46);
  const CONTILDES = TEXTO.replace('comprendio', 'comprendió').replace('volveria', 'volvería');
  const pos = resolverAncla(CONTILDES, a);
  comprobar(CONTILDES.slice(pos, pos + 12).includes('Y entonces'), 're-localiza aunque cambien las tildes');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
```

- [ ] **Paso 2: Correr la prueba para verificar que falla**

```bash
node tests/test_pdf_ancla.mjs
```

Esperado: FALLA con `ERR_MODULE_NOT_FOUND` (no existe `anclaTexto.js`).

- [ ] **Paso 3: Escribir la implementación mínima**

Crea `js/pdf/anclaTexto.js`:

```javascript
/* JG Turbo · Dónde estaba leyendo, dicho de una forma que sobrevive a los cambios
 *
 * Guardar «iba por el carácter 5820» funciona hasta que el capítulo cambia de
 * tamaño: la auditoría añade signos, el pulido reacomoda espacios, la traducción
 * lo reescribe entero. Entonces el 5820 apunta a cualquier parte.
 *
 * Por eso el ancla guarda dos cosas: el índice (rápido, casi siempre correcto) y
 * un trocito del texto que había ahí (la «cita»). Si el índice ya no encaja, se
 * busca la cita. Es lo mismo que hace un lector de libros electrónicos cuando
 * cambias el tamaño de la letra.
 *
 * Funciones puras: entran textos, salen números. Se prueban sin navegador.
 */

/* Suficiente para ser único en un capítulo, corto para sobrevivir a retoques. */
const LARGO_CITA = 40;
const LARGO_ANTES = 24;

const acotar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));

/** Quita tildes y mayúsculas: así «comprendio» y «comprendió» son la misma aguja. */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Describe una posición de forma que se pueda recuperar más tarde.
 * @param {string} texto
 * @param {number} caracter
 * @returns {{caracter:number, cita:string, antes:string}}
 */
export function construirAncla(texto, caracter) {
  const t = String(texto || '');
  const pos = acotar(Math.floor(Number(caracter) || 0), 0, t.length);
  return {
    caracter: pos,
    cita: t.slice(pos, pos + LARGO_CITA),
    antes: t.slice(Math.max(0, pos - LARGO_ANTES), pos),
  };
}

/**
 * Devuelve el índice de carácter que corresponde al ancla en este texto.
 * Nunca falla: si no puede encontrar nada, devuelve una posición válida.
 * @param {string} texto
 * @param {{caracter:number, cita:string, antes:string}|null} ancla
 * @returns {number}
 */
export function resolverAncla(texto, ancla) {
  const t = String(texto || '');
  if (!t.length) return 0;
  if (!ancla) return 0;

  const indice = acotar(Math.floor(Number(ancla.caracter) || 0), 0, t.length);
  const cita = String(ancla.cita || '');

  /* Sin cita solo queda el índice: es lo que hacía la versión anterior. */
  if (cita.length < 8) return indice;

  /* 1) ¿El texto no cambió? Comprobación barata primero. */
  if (t.startsWith(cita, indice)) return indice;

  /* 2) Buscar la cita, empezando cerca de donde estaba: en un libro la misma
   *    frase puede repetirse, y la copia correcta es la más cercana. */
  const tn = normalizar(t);
  const cn = normalizar(cita);
  const encontrado = buscarMasCercano(tn, cn, indice);
  if (encontrado >= 0) return encontrado;

  /* 3) La cita completa no aparece (el capítulo se reescribió). Se prueba con
   *    su primera mitad, que aguanta mejor los retoques de puntuación. */
  const mitad = cn.slice(0, Math.max(10, Math.floor(cn.length / 2)));
  const porMitad = buscarMasCercano(tn, mitad, indice);
  if (porMitad >= 0) return porMitad;

  /* 4) Último recurso: el fragmento anterior, por si la cita cambió pero lo
   *    que venía justo antes sobrevivió. */
  const antes = normalizar(ancla.antes || '');
  if (antes.length >= 8) {
    const porAntes = buscarMasCercano(tn, antes, indice);
    if (porAntes >= 0) return acotar(porAntes + antes.length, 0, t.length);
  }

  /* Nada encajó: se conserva el índice acotado. Puede estar desplazado, pero
   * es mejor que mandar al usuario al principio del capítulo. */
  return indice;
}

/** Ocurrencia de `aguja` más cercana a `referencia` (o -1 si no hay ninguna). */
function buscarMasCercano(pajar, aguja, referencia) {
  if (!aguja) return -1;
  let mejor = -1;
  let mejorDistancia = Infinity;
  let desde = 0;
  for (let vueltas = 0; vueltas < 500; vueltas += 1) {
    const donde = pajar.indexOf(aguja, desde);
    if (donde === -1) break;
    const distancia = Math.abs(donde - referencia);
    if (distancia < mejorDistancia) {
      mejor = donde;
      mejorDistancia = distancia;
    }
    desde = donde + 1;
  }
  return mejor;
}
```

- [ ] **Paso 4: Correr la prueba para verificar que pasa**

```bash
node tests/test_pdf_ancla.mjs
```

Esperado: `Todo en verde`.

- [ ] **Paso 5: Extender el modelo de progreso**

En `js/pdf/progreso.js`, reemplaza `progresoInicial()` (líneas 21-23):

```javascript
/** Progreso de un documento recién abierto. */
export function progresoInicial() {
  return {
    parte: 0,
    desplazamiento: 0,
    /* Posición exacta dentro del capítulo, portable entre dispositivos.
     * `desplazamiento` se conserva porque los documentos guardados antes de
     * esta versión solo tienen eso. */
    caracter: 0,
    cita: '',
    antes: '',
    maxParte: 0,
    actualizado: 0,
  };
}
```

Y reemplaza `avanzarProgreso()` (líneas 90-103):

```javascript
/**
 * Nueva posición de lectura. Conserva el capítulo más lejano alcanzado, para
 * que volver atrás a releer no borre lo que ya llevabas.
 *
 * `caracter`, `cita` y `antes` describen el punto exacto (ver anclaTexto.js).
 * Si quien llama no los pasa, se conservan los anteriores en vez de borrarlos:
 * un guardado por scroll no debe perder el punto exacto que dejó la voz.
 */
export function avanzarProgreso(progreso, { parte, desplazamiento, caracter, cita, antes } = {}) {
  const anterior = progreso || progresoInicial();
  const parteLimpia = Math.max(0, Math.floor(Number(parte) || 0));
  const cambioDeParte = parteLimpia !== (anterior.parte ?? 0);
  return {
    parte: parteLimpia,
    desplazamiento: acotar(Number(desplazamiento) || 0, 0, 1),
    /* Al cambiar de capítulo el ancla del anterior ya no sirve. */
    caracter: caracter != null
      ? Math.max(0, Math.floor(Number(caracter) || 0))
      : (cambioDeParte ? 0 : (anterior.caracter ?? 0)),
    cita: cita != null ? String(cita) : (cambioDeParte ? '' : (anterior.cita ?? '')),
    antes: antes != null ? String(antes) : (cambioDeParte ? '' : (anterior.antes ?? '')),
    maxParte: Math.max(anterior.maxParte ?? 0, parteLimpia),
    actualizado: Date.now(),
  };
}
```

- [ ] **Paso 6: Añadir las pruebas del modelo ampliado**

Añade al final de `tests/test_pdf_progreso.mjs`, **antes** de la línea que imprime el resumen:

```javascript
/* ── Ancla de posición exacta (v5) ─────────────────────────────────── */
{
  const base = progresoInicial();
  comprobar(base.caracter === 0 && base.cita === '', 'el progreso inicial trae ancla vacía');

  const conAncla = avanzarProgreso(base, { parte: 1, desplazamiento: 0.5, caracter: 820, cita: 'Y entonces', antes: 'igual. ' });
  comprobar(conAncla.caracter === 820 && conAncla.cita === 'Y entonces', 'guarda el ancla que recibe');

  /* Un guardado por scroll (sin ancla) no puede borrar la posición exacta
   * que acababa de dejar la voz: sería perder el punto justo al desplazarse. */
  const trasScroll = avanzarProgreso(conAncla, { parte: 1, desplazamiento: 0.55 });
  comprobar(trasScroll.caracter === 820 && trasScroll.cita === 'Y entonces', 'un guardado sin ancla conserva la anterior');

  /* Pero al cambiar de capítulo el ancla del anterior ya no significa nada. */
  const otroCapitulo = avanzarProgreso(conAncla, { parte: 2, desplazamiento: 0 });
  comprobar(otroCapitulo.caracter === 0 && otroCapitulo.cita === '', 'cambiar de capítulo limpia el ancla');
}
```

- [ ] **Paso 7: Correr las dos pruebas**

```bash
node tests/test_pdf_ancla.mjs
node tests/test_pdf_progreso.mjs
```

Esperado: ambas en verde. `test_pdf_progreso.mjs` debe seguir pasando **todos** sus casos
antiguos: si alguno falla, tu cambio rompió compatibilidad.

- [ ] **Paso 8: Commit**

```bash
git add js/pdf/anclaTexto.js js/pdf/progreso.js tests/test_pdf_ancla.mjs tests/test_pdf_progreso.mjs
git commit -m "feat(pdf): ancla de texto portable para la posicion de lectura"
```

---

## Tarea 2 · Capturar y restaurar la posición exacta

Ahora se conecta el ancla al lector. Aquí se corrigen las causas **A**, **B** y **C**.

**Archivos:**
- Modificar: `js/pdf/pdfController.js` (importaciones, `:766-779`, `:781-825`, `:940-945`,
  `:1225-1231`, `:1495-1497`, `:2338-2353`, `:2563-2600`)

**Interfaces:**
- Consume: `construirAncla`, `resolverAncla` de `js/pdf/anclaTexto.js`
- Produce: `caracterVisible()` → `number` · `irAPosicion(caracter, { centrar })` →
  `void` · `anotarPosicion({ desplazamiento, caracter })` (firma ampliada) ·
  `restaurarPosicionGuardada()` → `void`

- [ ] **Paso 1: Importar el módulo nuevo**

En `js/pdf/pdfController.js`, junto a los demás `import` de la cabecera (cerca de la línea 23):

```javascript
import { construirAncla, resolverAncla } from './anclaTexto.js';
```

- [ ] **Paso 2: Añadir las funciones de posición**

Reemplaza el bloque `desplazamientoActual()` / `anotarPosicion()`
(`js/pdf/pdfController.js:765-779`) por:

```javascript
  /** Fracción desplazada dentro del capítulo (se conserva por compatibilidad). */
  function desplazamientoActual() {
    const alto = el.salida.scrollHeight - el.salida.clientHeight;
    if (alto <= 0) return 0;
    return Math.max(0, Math.min(1, el.salida.scrollTop / alto));
  }

  /**
   * Carácter que está arriba del todo en la pantalla.
   *
   * Un <textarea> no dice qué carácter se ve, así que se estima por la
   * proporción desplazada y luego se ajusta al comienzo de la frase más
   * cercana: aterrizar a mitad de una frase se siente como un error, y
   * empezar la frase de nuevo se siente natural.
   */
  function caracterVisible() {
    const texto = el.salida.value || '';
    if (!texto) return 0;
    const bruto = Math.round(desplazamientoActual() * texto.length);
    const frases = partirEnFrases(texto);
    if (!frases.length) return Math.max(0, Math.min(texto.length, bruto));
    const rango = fraseEn(frases, Math.max(0, Math.min(texto.length - 1, bruto)));
    return rango ? rango[0] : bruto;
  }

  /**
   * Lleva la vista a un carácter del texto.
   *
   * Se mide sobre `el.realce`, la capa gemela que ya existe para resaltar la
   * frase que suena: tiene el mismo texto, la misma tipografía y los mismos
   * márgenes que el textarea, pero sus nodos SÍ se pueden medir. Sin ella
   * habría que adivinar.
   */
  function irAPosicion(caracter, { centrar = true } = {}) {
    const texto = el.salida.value || '';
    if (!texto) return;
    const pos = Math.max(0, Math.min(texto.length, Math.floor(Number(caracter) || 0)));
    const alto = el.salida.scrollHeight - el.salida.clientHeight;
    if (alto <= 0) return;

    let destino = null;
    if (el.realce) {
      /* Se pinta el texto partido en el punto buscado y se mide dónde cae. */
      const marca = document.createElement('span');
      marca.textContent = '\u200b';           /* invisible, pero ocupa una posición */
      el.realce.textContent = '';
      el.realce.append(
        document.createTextNode(texto.slice(0, pos)),
        marca,
        document.createTextNode(texto.slice(pos)),
      );
      destino = marca.offsetTop - (centrar ? el.salida.clientHeight * 0.30 : 0);
      /* La guía se limpia: quien la necesite la volverá a pintar. */
      limpiarGuia();
    }
    if (destino == null) destino = alto * (pos / Math.max(1, texto.length));
    el.salida.scrollTop = Math.max(0, Math.min(alto, destino));
    sincronizarRealce();
  }

  /**
   * Restaura la posición guardada del capítulo abierto.
   *
   * Se llama en cada momento en que el texto del textarea se reemplaza (montar,
   * pulir, traducir, volver al original): reemplazar el contenido de un
   * <textarea> lo devuelve al principio, y ese era el motivo por el que un
   * libro «volvía a empezar el capítulo» al reabrirlo.
   *
   * Se intenta en dos tiempos porque la primera vez el navegador todavía no ha
   * terminado de maquetar y `scrollHeight` aún no es el definitivo.
   */
  function restaurarPosicionGuardada() {
    const progreso = estado.progreso;
    if (!progreso) return;
    const aplicar = () => {
      const texto = el.salida.value || '';
      if (!texto) return;
      if (progreso.cita || progreso.caracter) {
        irAPosicion(resolverAncla(texto, progreso));
      } else {
        /* Documento guardado antes de esta versión: solo hay la fracción. */
        const alto = el.salida.scrollHeight - el.salida.clientHeight;
        if (alto > 0) el.salida.scrollTop = alto * Math.max(0, Math.min(1, progreso.desplazamiento || 0));
      }
    };
    requestAnimationFrame(() => {
      aplicar();
      /* Segundo intento tras la maquetación real (fuentes, imágenes, envolturas). */
      setTimeout(aplicar, 120);
    });
  }

  function anotarPosicion({ desplazamiento, caracter } = {}) {
    const texto = el.salida.value || '';
    /* Si quien llama sabe el carácter exacto (la voz lo sabe), se usa; si no,
     * se deduce de la pantalla. */
    const punto = caracter != null ? caracter : caracterVisible();
    const ancla = construirAncla(texto, punto);
    estado.progreso = avanzarProgreso(estado.progreso, {
      parte: estado.parteActual,
      desplazamiento: desplazamiento != null ? desplazamiento : desplazamientoActual(),
      caracter: ancla.caracter,
      cita: ancla.cita,
      antes: ancla.antes,
    });
    actualizarBarraDoc();
    guardarProgresoPronto();
  }
```

> **Nota para quien implementa:** `partirEnFrases`, `fraseEn`, `limpiarGuia` y
> `sincronizarRealce` están declaradas más abajo en el archivo (líneas ~2468-2510). En
> JavaScript las declaraciones `function` se elevan dentro del mismo ámbito, así que llamarlas
> desde aquí funciona. **Verifícalo** ejecutando el lector: si la consola muestra
> `is not defined`, mueve estas cuatro funciones por encima de `caracterVisible()`.

- [ ] **Paso 3: Que `mostrarParte` restaure por ancla**

En `js/pdf/pdfController.js:781`, cambia la firma y el bloque de restauración.
Reemplaza las líneas 802-811 (el `requestAnimationFrame` y el `avanzarProgreso` que le sigue):

```javascript
    /* Restaurar el punto exacto donde se quedó la lectura. */
    estado.progreso = avanzarProgreso(estado.progreso, {
      parte: nuevo,
      desplazamiento,
      /* Al llegar a un capítulo nuevo (no al reabrir el que se leía) no hay
       * ancla que conservar: se entra por el principio. */
      ...(indiceEsElGuardado ? {} : { caracter: 0, cita: '', antes: '' }),
    });
    restaurarPosicionGuardada();
    actualizarBarraDoc();
    pintarIndice();
    guardarProgresoPronto();
```

Y al comienzo de `mostrarParte` (justo después de calcular `nuevo`, línea 783), añade:

```javascript
    /* ¿Estamos volviendo al capítulo que el progreso dice que se estaba
     * leyendo? Solo entonces hay una posición guardada que respetar. */
    const indiceEsElGuardado = nuevo === (estado.progreso?.parte ?? -1);
```

- [ ] **Paso 4: Que el pulido y la traducción NO borren la posición**

Esta es la corrección de la causa A. En `js/pdf/pdfController.js`, en la función que muestra el
pulido (líneas 1224-1231), **añade `restaurarPosicionGuardada()` después de cada asignación**
a `el.salida.value`:

```javascript
    if (progAprobado) {
      el.salida.value = progAprobado;
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
      actualizarContador();
      restaurarPosicionGuardada();   /* reemplazar el texto manda el scroll a 0 */
      return;
    }
    const seguro = estado.textoSeguroPorBloque.get(`cap_${indice}`);
    if (seguro) {
      el.salida.value = seguro;
      el.salida.dispatchEvent(new Event('input', { bubbles: true }));
      actualizarContador();
      restaurarPosicionGuardada();
      return;
    }
    el.salida.value = estado.pulido.get(indice) || el.salida.value;
    el.salida.dispatchEvent(new Event('input', { bubbles: true }));
    actualizarContador();
    restaurarPosicionGuardada();
  }
```

Haz **exactamente lo mismo** en los otros tres lugares donde se reemplaza el texto del capítulo
actual: `:1241-1244` (volver al original), `:1256-1259` (desactivar pulido) y `:1495-1497`
(mostrar traducción). En los cuatro casos, la línea nueva va justo después de
`actualizarContador()`.

> **Cómo encontrarlos sin equivocarte:** busca `el.salida.value =` en el archivo. Hay 6
> apariciones. Se excluyen la de `mostrarParte` (`:795`, ya lo hace) y la de cerrar documento
> (`:881`, deja el textarea vacío). Las otras cuatro llevan `restaurarPosicionGuardada()`.

- [ ] **Paso 5: Que el scroll del usuario guarde el carácter**

En el listener de scroll (`js/pdf/pdfController.js:2345-2352`), reemplaza el cuerpo del
`setTimeout`:

```javascript
    temporizadorScroll = setTimeout(() => {
      if (!hayDocumento()) return;
      const fraccion = desplazamientoActual();
      /* Sin `caracter`: `anotarPosicion` lo deduce de lo que se ve. */
      anotarPosicion({ desplazamiento: fraccion });
      if (fraccion > 0.995 && estado.parteActual + 1 < estado.partes.length) {
        mostrarParte(estado.parteActual + 1);
      }
    }, 220);
```

- [ ] **Paso 6: Que la voz guarde el carácter exacto**

En el listener `jg-tts-avance` (`js/pdf/pdfController.js:2573-2574`), reemplaza:

```javascript
    /* El progreso del libro se anota siempre que suene, se siga el texto o no.
     * Cuando la guía pudo situar el bloque, se conoce el carácter EXACTO que
     * está sonando: es la mejor posición que puede guardarse. */
    const exacto = datos.bloque >= 0 ? posicionDeVoz(datos) : null;
    anotarPosicion({ desplazamiento: datos.fraccion, caracter: exacto != null ? exacto : undefined });
```

> **Ojo al orden:** `posicionDeVoz()` usa `guia.anclas`, que se rellena dentro de
> `marcarFrase()`. En la primera llamada tras iniciar la lectura las anclas aún no existen y
> devolverá `null`; se guarda entonces por fracción, y desde la siguiente llamada ya es exacto.
> Es correcto: no hace falta reordenar nada.

- [ ] **Paso 7: Probar a mano en el navegador (esta parte no la cubre una prueba automática)**

Sirve el proyecto y comprueba los seis casos:

```bash
npx serve . -l 3000
```

1. Abre un PDF de varios capítulos, ve al capítulo 3, desplázate a la mitad.
2. Recarga la página (F5) y vuelve a abrir el libro → **debe aparecer en la mitad del
   capítulo 3**, no al principio.
3. Con el pulido activado, repite → **también** debe respetar la posición (esta es la
   corrección de la causa A; antes fallaba justo aquí).
4. Pon a leer en voz alta, deja avanzar un minuto, cierra la pestaña sin pulsar nada.
   Reabre → debe aterrizar en la frase que estaba sonando.
5. Abre el mismo libro en una ventana angosta (simula celular con F12 → modo dispositivo) y
   luego en una ancha → la posición debe ser **la misma frase**, no el mismo porcentaje.
6. Abre la consola del navegador: **cero errores**.

- [ ] **Paso 8: Correr la regresión**

```bash
node tests/test_pdf_progreso.mjs
node tests/test_pdf_ancla.mjs
node tests/test_pdf_auditoria_p0.mjs
node tests/test_pdf_limpieza.mjs
```

- [ ] **Paso 9: Commit**

```bash
git add js/pdf/pdfController.js
git commit -m "fix(pdf): la posicion de lectura sobrevive al pulido, la traduccion y el cambio de pantalla"
```

---

## Tarea 3 · Guardar antes de que la app desaparezca

Corrige la causa **D**. Sin esto, todo lo anterior sigue sin llegar al otro dispositivo.

**Archivos:**
- Modificar: `js/pdf/pdfController.js` (añadir al final del bloque de listeners, cerca de `:2782`)

**Interfaces:**
- Consume: `anotarPosicion()`, `sincronizarAhora()`, `almacen.guardarProgreso()`
- Produce: `guardarYaMismo()` → `Promise<void>`

- [ ] **Paso 1: Añadir el guardado inmediato y los disparadores**

Añade este bloque en `js/pdf/pdfController.js`, junto a los demás listeners globales
(después de la función `sincronizarAhora`, cerca de la línea 2990):

```javascript
  /* ── Que no se pierda nada al desaparecer la app ────────────────────
   *
   * El guardado normal espera 900 ms por si llegan más cambios
   * (`guardarProgresoPronto`). Cuando el sistema se lleva la app —el usuario
   * cambia de aplicación, bloquea el celular, o el celular se apaga— esos
   * 900 ms no llegan a cumplirse y el avance se pierde.
   *
   * `visibilitychange` es el único evento fiable en móvil: `beforeunload` no
   * se dispara en Android ni en iOS cuando el sistema mata la pestaña.
   */
  async function guardarYaMismo() {
    if (!hayDocumento() || !estado.id) return;
    clearTimeout(temporizadorGuardado);
    anotarPosicion();
    try {
      await almacen.guardarProgreso(estado.id, estado.progreso, estado.partes);
    } catch (_) { /* si IndexedDB falla, lo local sigue en memoria */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    guardarYaMismo().then(() => sincronizarAhora({ silencioso: true }));
  });

  /* Respaldo para navegadores de escritorio, donde sí es fiable. */
  window.addEventListener('pagehide', () => { guardarYaMismo(); });

  /* Mientras se lee, un latido tranquilo: si alguien lee dos horas seguidas sin
   * salir de la app, su avance ya está en la nube por si cambia de dispositivo.
   * Un minuto es suficiente y no molesta a la batería ni a la cuota. */
  const LATIDO_SYNC_MS = 60000;
  setInterval(() => {
    if (!hayDocumento()) return;
    if (document.visibilityState !== 'visible') return;
    guardarYaMismo().then(() => sincronizarAhora({ silencioso: true }));
  }, LATIDO_SYNC_MS);
```

- [ ] **Paso 2: Sincronizar también al pausar o detener la voz**

Quien pausa el audiolibro muchas veces es porque va a dejar de leer. En el listener
`jg-tts-avance` (`js/pdf/pdfController.js:2570`), donde hoy dice `if (datos.estado === 'paused') return;`,
reemplaza por:

```javascript
    /* En pausa la guía se queda donde está: quien pausa quiere justamente
     * volver a ese punto, y borrar la marca sería perderlo. Solo desaparece
     * cuando la lectura termina o se detiene.
     * Además, pausar suele significar «lo dejo aquí»: buen momento para que
     * el punto llegue a los demás dispositivos. */
    if (datos.estado === 'paused') {
      guardarYaMismo().then(() => sincronizarAhora({ silencioso: true }));
      return;
    }
```

> **Cuidado con el orden de declaración:** `guardarYaMismo` se declara con `async function`
> dentro del mismo ámbito, así que se eleva y puede usarse desde aquí aunque esté escrita más
> abajo. Si al probar sale `guardarYaMismo is not defined`, muévela por encima del listener.

- [ ] **Paso 3: Probar a mano**

1. Abre un libro, avanza, y **sin pulsar «volver»** cambia de pestaña.
   En la pestaña de red (F12 → Network) debe aparecer una llamada a `/api/sync/...`.
2. Con el móvil real (o modo dispositivo), pon a leer, bloquea la pantalla, desbloquea:
   el progreso debe estar guardado.
3. Deja el libro abierto y quieto 70 segundos: debe dispararse una sincronización sola.

- [ ] **Paso 4: Commit**

```bash
git add js/pdf/pdfController.js
git commit -m "feat(pdf): guardar y sincronizar el avance al ocultar la app, al pausar y cada minuto"
```

---

## Tarea 4 · Que sincronizar el avance no cueste subir el libro entero

Corrige la causa **E**. Es lo que hace que la Tarea 3 sea viable: sin esto, sincronizar cada
minuto significaría resubir 40 capítulos cada minuto.

**Archivos:**
- Modificar: `js/pdf/biblioteca.js:284-297` (`guardarProgreso`) y el registro de documento
  (`:186-198`)
- Modificar: `js/pdf/nube.js:142-192` (bucle de subida)
- Prueba: `tests/test_pdf_sincronizacion.mjs` (ampliar)

**Interfaces:**
- Produce: el registro de documento gana el campo `contenidoActualizado: number`
- Produce: `biblioteca.partesParaSubir(id)` se sigue llamando igual, pero `nube.js` solo la
  invoca cuando el contenido cambió de verdad

- [ ] **Paso 1: Escribir la prueba que falla**

Añade al final de `tests/test_pdf_sincronizacion.mjs`, antes del resumen:

```javascript
/* ── Avanzar leyendo no es «cambió el libro» ───────────────────────── */
{
  /* Un documento cuyo texto no se ha tocado desde la última subida, pero
   * cuyo progreso sí avanzó, no debe arrastrar sus capítulos otra vez. */
  const soloProgreso = { id: 'lib1', actualizado: 5000, contenidoActualizado: 1000, sincronizado: 3000 };
  comprobar(necesitaSubirContenido(soloProgreso) === false,
    'avanzar en la lectura NO obliga a resubir los capitulos');

  const textoEditado = { id: 'lib2', actualizado: 5000, contenidoActualizado: 4000, sincronizado: 3000 };
  comprobar(necesitaSubirContenido(textoEditado) === true,
    'editar el texto SI obliga a resubir los capitulos');

  /* Un libro que nunca se subió sube todo, aunque no tenga la marca nueva. */
  const nuevo = { id: 'lib3', actualizado: 5000, sincronizado: 0 };
  comprobar(necesitaSubirContenido(nuevo) === true,
    'un libro nunca sincronizado sube su contenido');

  /* Documentos guardados antes de esta version no tienen la marca: por
   * seguridad se comportan como antes (suben todo). */
  const viejo = { id: 'lib4', actualizado: 5000, sincronizado: 3000 };
  comprobar(necesitaSubirContenido(viejo) === true,
    'un documento sin la marca nueva sube todo (compatibilidad)');
}
```

Y añade `necesitaSubirContenido` al `import` que ya tiene el archivo desde
`../js/pdf/sincronizacion.js`.

- [ ] **Paso 2: Correr la prueba para verificar que falla**

```bash
node tests/test_pdf_sincronizacion.mjs
```

Esperado: FALLA con `necesitaSubirContenido is not a function`.

- [ ] **Paso 3: Añadir la regla al módulo con pruebas**

En `js/pdf/sincronizacion.js`, añade al final:

```javascript
/**
 * ¿Hace falta volver a subir el TEXTO de este documento, o basta con el
 * registro ligero?
 *
 * Avanzar en la lectura cambia `actualizado` (para que el progreso viaje),
 * pero no cambia `contenidoActualizado`. Distinguirlos es lo que permite
 * sincronizar el avance cada minuto sin resubir un libro de 40 capítulos
 * cada minuto.
 *
 * Un documento sin `contenidoActualizado` es anterior a esta versión: se
 * comporta como antes y sube todo. Preferimos gastar de más una vez a
 * dejar un libro sin texto en el otro dispositivo.
 */
export function necesitaSubirContenido(documento) {
  if (!documento) return false;
  const sincronizado = Number(documento.sincronizado) || 0;
  if (!sincronizado) return true;                       /* nunca se subió */
  const contenido = Number(documento.contenidoActualizado) || 0;
  if (!contenido) return true;                          /* registro antiguo */
  return contenido > sincronizado;
}
```

- [ ] **Paso 4: Correr la prueba para verificar que pasa**

```bash
node tests/test_pdf_sincronizacion.mjs
```

Esperado: `Todo en verde`.

- [ ] **Paso 5: Que `guardarProgreso` no marque el contenido como cambiado**

En `js/pdf/biblioteca.js:284-297`, reemplaza el cuerpo:

```javascript
export async function guardarProgreso(id, progreso, partes) {
  try {
    return await conAlmacenes([DOCUMENTOS], 'readwrite', async (docs) => {
      const doc = await esperar(docs.get(id));
      if (!doc) return false;
      doc.progreso = progreso;
      /* El estado se recalcula aquí para que la biblioteca no tenga que
       * abrir cada libro para saber si está terminado. */
      if (partes) doc.estado = estadoDeLectura(calcularPorcentaje(progreso, partes));
      doc.actualizado = Date.now();
      /* `contenidoActualizado` NO se toca: leer no cambia el libro. Gracias a
       * esto la sincronización manda solo el registro ligero (unos bytes) en
       * vez de los capítulos enteros. */
      await esperar(docs.put(doc));
      return true;
    });
  } catch (_) {
    return false;
  }
}
```

- [ ] **Paso 6: Marcar el contenido cuando SÍ cambia**

En `js/pdf/biblioteca.js`, en el registro que se arma al guardar un documento (línea ~192),
añade el campo:

```javascript
        progreso: meta.progreso || previo.progreso || progresoInicial(),
        estado: meta.estado || previo.estado || 'sin-empezar',
        creado: previo.creado || meta.creado || ahora,
        actualizado: meta.actualizado || ahora,
        /* Momento en que cambió el TEXTO (no la lectura). Guardar un documento
         * siempre implica contenido nuevo o editado. */
        contenidoActualizado: meta.contenidoActualizado || meta.actualizado || ahora,
        sincronizado: meta.sincronizado !== undefined ? meta.sincronizado : (previo.sincronizado || 0),
```

Busca además las funciones que guardan **texto editado del capítulo** (la que usa
`guardarEdicionActual` en el controlador, `js/pdf/pdfController.js:531`) y las de traducción y
pulido persistido: todas deben actualizar `contenidoActualizado`. Si esas escrituras pasan por
la misma función de `put` del registro, con el paso anterior ya queda cubierto; **verifícalo**
leyendo el archivo y, si alguna escribe el documento por otra vía, añade allí
`doc.contenidoActualizado = Date.now();`.

- [ ] **Paso 7: Que la nube respete la distinción**

En `js/pdf/nube.js`, importa la función nueva (línea 13):

```javascript
import { decidir, marcarBorrado, necesitaSubirContenido } from './sincronizacion.js';
```

Y en el bucle de subida (líneas 158-188), envuelve el envío de partes:

```javascript
        /* Los capítulos solo viajan si el texto cambió. Si lo único nuevo es
         * por dónde va la lectura, con el registro ligero de arriba basta:
         * así se puede sincronizar el avance cada minuto sin coste. */
        if (!paquete.borrado && necesitaSubirContenido(resumen)) {
          const partes = await biblioteca.partesParaSubir(resumen.id);
          for (let i = 0; i < partes.length; i += 1) {
            /* ... el bucle interno queda EXACTAMENTE igual que ahora,
                   incluida la compatibilidad del campo `pulido` ... */
          }
        }
```

> **No reescribas el bucle interno.** Solo cambia la condición del `if` que lo envuelve, de
> `if (!paquete.borrado)` a `if (!paquete.borrado && necesitaSubirContenido(resumen))`. Todo lo
> de dentro —incluido el `try/catch` que reintenta sin el campo `pulido`— se conserva tal cual.

- [ ] **Paso 8: Comprobar que `exportarParaSincronizar` incluye el campo nuevo**

Abre `js/pdf/biblioteca.js` y busca `exportarParaSincronizar`. El resumen que devuelve **debe
incluir `contenidoActualizado` y `sincronizado`**, o `necesitaSubirContenido()` recibirá
`undefined` y subirá todo siempre (comportamiento antiguo: seguro, pero pierde la mejora).
Añade el campo si falta.

- [ ] **Paso 9: Probar a mano el ahorro**

1. Abre un libro de varios capítulos que ya esté sincronizado.
2. Abre F12 → Network, filtra por `sync`.
3. Avanza leyendo y espera el latido de 60 s.
4. Esperado: **una** llamada a `/api/sync/subir` y **ninguna** a `/api/sync/parte`.
5. Ahora edita el texto de un capítulo y sincroniza: **ahí sí** deben aparecer llamadas a
   `/api/sync/parte`.

- [ ] **Paso 10: Regresión y commit**

```bash
node tests/test_pdf_sincronizacion.mjs
node tests/test_pdf_progreso.mjs
git add js/pdf/sincronizacion.js js/pdf/biblioteca.js js/pdf/nube.js tests/test_pdf_sincronizacion.mjs
git commit -m "perf(pdf): avanzar leyendo ya no resube los capitulos del libro"
```

---

## Tarea 5 · Decir dónde quedó la lectura, con palabras

Ahora que la posición es fiable, hay que **mostrarla**. Hoy el usuario no tiene forma de saber
que la app recordó dónde iba.

**Archivos:**
- Modificar: `js/pdf/progreso.js` (añadir `etiquetaReanudar`)
- Modificar: `js/pdf/pdfController.js` (`montarDocumento`, cerca de `:940`)
- Modificar: `index.html` (aviso de reanudación en el lector)
- Prueba: `tests/test_pdf_progreso.mjs`

**Interfaces:**
- Produce: `etiquetaReanudar(progreso, partes, ahora)` → `string`

- [ ] **Paso 1: Escribir la prueba**

Añade a `tests/test_pdf_progreso.mjs`:

```javascript
/* ── Frase de reanudación ──────────────────────────────────────────── */
{
  const AHORA = 1_700_000_000_000;
  const hace = (ms) => ({ parte: 1, desplazamiento: 0.5, caracter: 100, actualizado: AHORA - ms });

  comprobar(etiquetaReanudar(hace(30 * 1000), PARTES, AHORA).includes('hace un momento'),
    'medio minuto es "hace un momento"');
  comprobar(etiquetaReanudar(hace(20 * 60 * 1000), PARTES, AHORA).includes('hace 20 minutos'),
    'veinte minutos se dicen en minutos');
  comprobar(etiquetaReanudar(hace(3 * 3600 * 1000), PARTES, AHORA).includes('hace 3 horas'),
    'tres horas se dicen en horas');
  comprobar(etiquetaReanudar(hace(2 * 86400 * 1000), PARTES, AHORA).includes('hace 2 días'),
    'dos dias se dicen en dias');
  comprobar(etiquetaReanudar(hace(60 * 1000), PARTES, AHORA).includes('CAPÍTULO II'),
    'nombra el capitulo donde quedo');
  comprobar(etiquetaReanudar(null, PARTES, AHORA) === '',
    'sin progreso no dice nada');
  comprobar(etiquetaReanudar(progresoInicial(), PARTES, AHORA) === '',
    'un libro sin empezar no dice nada');
}
```

Añade `etiquetaReanudar` al `import` de la cabecera del archivo de pruebas.

- [ ] **Paso 2: Correr y ver que falla**

```bash
node tests/test_pdf_progreso.mjs
```

Esperado: FALLA con `etiquetaReanudar is not a function`.

- [ ] **Paso 3: Implementar**

Añade a `js/pdf/progreso.js`:

```javascript
/**
 * «Seguías en CAPÍTULO II, hace 20 minutos».
 *
 * Es la frase que le dice a la persona que la app se acordó de ella. Sin
 * esto, reanudar bien es invisible: parece que el libro se abrió donde le
 * dio la gana.
 *
 * @param {{parte:number, actualizado:number}|null} progreso
 * @param {{titulo?:string, texto:string}[]} partes
 * @param {number} [ahora] – inyectable para poder probarlo
 * @returns {string} vacío si no hay nada que reanudar
 */
export function etiquetaReanudar(progreso, partes, ahora = Date.now()) {
  if (!progreso || !progreso.actualizado) return '';
  if (calcularPorcentaje(progreso, partes) <= 0) return '';

  const lista = Array.isArray(partes) ? partes : [];
  const indice = acotar(Math.floor(progreso.parte ?? 0), 0, Math.max(0, lista.length - 1));
  const titulo = lista[indice]?.titulo;

  const transcurrido = Math.max(0, ahora - Number(progreso.actualizado));
  const minutos = Math.floor(transcurrido / 60000);
  const horas = Math.floor(minutos / 60);
  const dias = Math.floor(horas / 24);

  let cuando;
  if (minutos < 1) cuando = 'hace un momento';
  else if (minutos < 60) cuando = `hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
  else if (horas < 24) cuando = `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  else cuando = `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;

  if (lista.length > 1 && titulo) return `Seguías en ${titulo}, ${cuando}`;
  return `Seguías leyendo ${cuando}`;
}
```

- [ ] **Paso 4: Correr y ver que pasa**

```bash
node tests/test_pdf_progreso.mjs
```

- [ ] **Paso 5: Mostrarlo al abrir el libro**

En `index.html`, dentro del lector y justo debajo de la cabecera del documento (busca
`pdf-doc-cab`, cerca de la línea 4618, donde está `pdfDocTapa`), añade:

```html
<div class="pdf-reanudar" id="pdfReanudar" hidden role="status" aria-live="polite">
  <span class="pdf-reanudar-txt" id="pdfReanudarTxt"></span>
  <button type="button" class="mini-btn" id="btnPdfReanudarInicio">Empezar de cero</button>
</div>
```

Y el CSS, junto a las demás reglas de `.pdf-doc-cab` (cerca de `index.html:1943`):

```css
  /* Aviso de reanudación: aparece unos segundos al abrir un libro empezado.
     Sin él, aterrizar a mitad de un capítulo parece un error de la app. */
  .pdf-reanudar{
    display:flex;align-items:center;gap:10px;flex-wrap:wrap;
    margin:6px 0 0;padding:8px 12px;
    background:color-mix(in srgb, var(--acc) 12%, transparent);
    border:1px solid color-mix(in srgb, var(--acc) 34%, transparent);
    border-radius:10px;
    font-size:13px;line-height:1.4;
    animation:pdfReanudarEntra .28s ease both;
  }
  .pdf-reanudar-txt{flex:1 1 auto;min-width:0}
  .pdf-reanudar .mini-btn{flex:0 0 auto;min-height:var(--h-touch)}
  @keyframes pdfReanudarEntra{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.pdf-reanudar{animation:none}}
  @media (max-width:640px){ .pdf-reanudar{font-size:12.5px;padding:8px 10px} }
```

- [ ] **Paso 6: Conectarlo en el controlador**

En `js/pdf/pdfController.js`, añade los elementos al objeto `el` (cerca de `:104`):

```javascript
    reanudar: $('pdfReanudar'), reanudarTxt: $('pdfReanudarTxt'),
    reanudarInicio: $('btnPdfReanudarInicio'),
```

Importa `etiquetaReanudar` junto a las otras funciones de `progreso.js` (línea 23), y al final
de `montarDocumento()` (después de `mostrarParte`, línea ~945) añade:

```javascript
    /* Decirle a la persona que la app se acordó de dónde iba. Se retira solo:
     * es una confirmación, no un cartel permanente. */
    if (el.reanudar && el.reanudarTxt) {
      const frase = etiquetaReanudar(estado.progreso, estado.partes);
      el.reanudar.hidden = !frase;
      el.reanudarTxt.textContent = frase;
      if (frase) {
        clearTimeout(estado.temporizadorReanudar);
        estado.temporizadorReanudar = setTimeout(() => {
          if (el.reanudar) el.reanudar.hidden = true;
        }, 9000);
      }
    }
```

Y el botón «Empezar de cero», junto a los demás listeners:

```javascript
  if (el.reanudarInicio) el.reanudarInicio.addEventListener('click', () => {
    if (!hayDocumento()) return;
    el.reanudar.hidden = true;
    mostrarParte(0, { desplazamiento: 0 });
    estado.progreso = avanzarProgreso(estado.progreso, { parte: 0, desplazamiento: 0, caracter: 0, cita: '', antes: '' });
    irAPosicion(0, { centrar: false });
    guardarProgresoPronto();
  });
```

Añade `temporizadorReanudar: null` al objeto `estado` (cerca de `:133`) y limpia el temporizador
en `cerrarDocumento()` (`:842`) con `clearTimeout(estado.temporizadorReanudar);`.

- [ ] **Paso 7: Probar a mano**

Abre un libro empezado → debe aparecer el aviso, desaparecer solo a los 9 s, y el botón
«Empezar de cero» debe llevar al principio del capítulo 1. Abre un libro nuevo → **no** debe
aparecer nada.

- [ ] **Paso 8: Commit**

```bash
git add js/pdf/progreso.js js/pdf/pdfController.js index.html tests/test_pdf_progreso.mjs
git commit -m "feat(pdf): avisar donde quedo la lectura al reabrir un libro"
```

---

## Tarea 6 · Tocar el texto para leer desde ahí

Esta es, de todo el plan, la mejora que más cambia la sensación de uso: resuelve el
«no sé dónde darle play» de raíz. Y la pieza difícil ya existe (`situarBloques`).

**Archivos:**
- Modificar: `index.html` (exponer `ttsIrACaracter`, cerca de `:13443`)
- Modificar: `js/pdf/pdfController.js` (listener de doble toque sobre `el.salida`)

**Interfaces:**
- Consume: `ttsBuscar(segundos)` y `ttsDuracionBloque()` de `index.html`
- Produce: `window.ttsIrABloque(indiceBloque, dentro)` → `void`
- Produce: `caracterATiempo(caracter)` → `number|null` en el controlador

- [ ] **Paso 1: Exponer el salto por bloque en el motor TTS**

En `index.html`, junto a `ttsSaltar` (línea 13443), añade:

```javascript
/* Salto a un bloque concreto de la cola, no a un segundo.
 *
 * El reproductor razona en segundos, pero el lector razona en frases. Esta
 * función es el puente: le dices «bloque 7, al 30 % de su contenido» y ella
 * calcula el segundo que corresponde. La usa el lector de PDF cuando tocas
 * un párrafo para empezar a leer ahí.
 */
function ttsIrABloque(indiceBloque, dentro = 0){
  if(!ttsState.queue.length) return;
  const i = Math.max(0, Math.min(ttsState.queue.length - 1, Math.floor(indiceBloque) || 0));
  let acumulado = 0;
  for(let k = 0; k < i; k++) acumulado += ttsDuracionBloque(ttsState.queue[k]);
  const dur = ttsDuracionBloque(ttsState.queue[i]);
  const proporcion = Math.max(0, Math.min(1, Number(dentro) || 0));
  ttsBuscar(acumulado + dur * proporcion);
}
window.ttsIrABloque = ttsIrABloque;
```

- [ ] **Paso 2: Traducir carácter → bloque en el controlador**

En `js/pdf/pdfController.js`, junto a `posicionDeVoz()` (después de la línea 2465), añade:

```javascript
  /**
   * Camino inverso de `posicionDeVoz`: de un punto del texto al bloque de
   * audio que lo contiene.
   *
   * `guia.anclas` dice en qué carácter empieza cada bloque de la cola. Con eso
   * basta para saber a qué bloque saltar y en qué proporción de él caemos.
   * Devuelve null si la guía todavía no está situada (no hay lectura en curso).
   */
  function bloqueDeCaracter(caracter) {
    const anclas = guia.anclas;
    if (!anclas || !anclas.length || !guia.mapa || !guia.mapa.length) return null;
    /* Las anclas están en el texto compacto; el carácter viene del texto real. */
    let enCompacto = guia.mapa.indexOf(Math.floor(caracter));
    if (enCompacto < 0) {
      /* El carácter puede ser un espacio o un signo, que no está en el mapa:
       * se busca el siguiente que sí lo esté. */
      for (let c = Math.floor(caracter); c < guia.mapa.length + Math.floor(caracter); c += 1) {
        const donde = guia.mapa.indexOf(c);
        if (donde >= 0) { enCompacto = donde; break; }
      }
    }
    if (enCompacto < 0) return null;

    let i = 0;
    while (i + 1 < anclas.length && anclas[i + 1] <= enCompacto) i += 1;
    const inicio = anclas[i];
    const fin = i + 1 < anclas.length ? anclas[i + 1] : guia.compacto.length;
    const dentro = fin > inicio ? (enCompacto - inicio) / (fin - inicio) : 0;
    return { bloque: i, dentro: Math.max(0, Math.min(1, dentro)) };
  }
```

- [ ] **Paso 3: Escuchar el doble toque sobre el texto**

Añade junto a los demás listeners de `el.salida` (después del de scroll, `:2353`):

```javascript
  /* ── Tocar dos veces el texto: leer desde ahí ───────────────────────
   *
   * Doble toque y no toque simple: el textarea es editable y seleccionable, y
   * un toque simple tiene que seguir sirviendo para poner el cursor. El doble
   * toque no compite con nada y es el gesto que la gente ya usa para
   * seleccionar una palabra, así que se descubre solo.
   */
  el.salida.addEventListener('dblclick', () => {
    if (!hayDocumento()) return;
    const punto = el.salida.selectionStart;
    if (punto == null) return;

    /* Se ancla al comienzo de la frase: empezar a media frase suena a error. */
    const frases = partirEnFrases(el.salida.value || '');
    const rango = frases.length ? fraseEn(frases, punto) : null;
    const desde = rango ? rango[0] : punto;

    anotarPosicion({ caracter: desde });

    /* Si ya hay voz sonando en este capítulo, se salta ahí al instante. */
    const destino = bloqueDeCaracter(desde);
    if (destino && ttsSonandoAqui() && typeof window.ttsIrABloque === 'function') {
      window.ttsIrABloque(destino.bloque, destino.dentro);
      avisar('Leyendo desde aquí.', 'info');
      return;
    }
    /* Si no había voz, se marca el punto y se ofrece empezar. */
    irAPosicion(desde);
    avisar('Marcado. Pulsa Escuchar para leer desde aquí.', 'info');
  });
```

- [ ] **Paso 4: Hacerlo descubrible**

Un gesto que nadie conoce no existe. En `index.html`, en el panel de opciones del lector
(junto al interruptor «Seguir con la voz», busca `seguirSi`), añade una línea de ayuda:

```html
<p class="pdf-ayuda-gesto">Toca dos veces cualquier párrafo para leer desde ahí.</p>
```

```css
  .pdf-ayuda-gesto{
    margin:4px 0 0;font-size:12px;line-height:1.45;
    color:var(--muted);
  }
```

- [ ] **Paso 5: Probar a mano**

1. Pon a leer en voz alta. Espera a que suene.
2. Toca dos veces un párrafo muy posterior → la voz debe saltar ahí en menos de 2 segundos.
3. Sin voz sonando, toca dos veces un párrafo → debe centrarse ahí y avisar.
4. En móvil (modo dispositivo), comprueba que el doble toque funciona y que el toque simple
   sigue poniendo el cursor.

- [ ] **Paso 6: Commit**

```bash
git add index.html js/pdf/pdfController.js
git commit -m "feat(pdf): tocar dos veces un parrafo para leer desde ahi"
```

---

## Tarea 7 · Navegar por contenido, no por segundos

Corrige lo de «adelantar es engorroso». Los `±10 s` pasan a ser **frase anterior / frase
siguiente**, y se añade el salto de capítulo.

**Decisión de diseño:** en móvil no cabe una fila más de botones (el dock ya usa una rejilla de
dos filas exactas, `index.html:1721-1762`, y crecer se comía 250 px de pantalla en la v3.1).
Por eso **no se añaden botones nuevos a la fila de controles**: se cambia el *significado* de
los dos que ya existen y el salto de capítulo se pone en la barra superior, que tiene sitio.

**Archivos:**
- Modificar: `index.html:13740-13748` (botones de la barra), `:11524` (constante)
- Modificar: `js/pdf/pdfController.js` (manejo de los saltos cuando la fuente es el PDF)

- [ ] **Paso 1: Cambiar los botones de la barra de transporte**

En `index.html`, dentro de `ttsMontarTransporte()` (línea 13739), reemplaza el `innerHTML`:

```javascript
  fila.innerHTML =
    '<button type="button" class="tts-nav" data-tts-action="back" title="Frase anterior" aria-label="Frase anterior">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg>' +
    '</button>' +
    '<input type="range" class="tts-seek" data-tts-seek min="0" max="100" step="0.1" value="0" aria-label="Posición de la lectura">' +
    '<button type="button" class="tts-nav" data-tts-action="fwd" title="Frase siguiente" aria-label="Frase siguiente">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/></svg>' +
    '</button>' +
    '<span class="tts-time" data-tts-time aria-live="off">0:00 / 0:00</span>';
```

> Se retiran los `<span class="tts-nav-num">10</span>`: el número ya no significa nada y
> ocupaba espacio que en celular hace falta.

- [ ] **Paso 2: Que los botones salten por frase cuando se lee un PDF**

En `index.html`, busca el manejador de acciones (línea ~14054, `const action = actionBtn.getAttribute('data-tts-action')`).
En las ramas `back` y `fwd`, antepón la vía nueva:

```javascript
    if(action === 'back' || action === 'fwd'){
      const haciaDelante = action === 'fwd';
      /* En el PDF se salta por frases: es como piensa quien escucha un libro.
       * El lector responde a este evento porque es el único que sabe dónde
       * empieza y acaba cada frase del capítulo abierto. */
      if(ttsState.sourceId === 'pdf'){
        const ev = new CustomEvent('jg-tts-salto-frase', { detail: { haciaDelante } });
        document.dispatchEvent(ev);
        if(ev.detail.atendido) return;
      }
      /* Fuera del PDF (micrófono, archivo, YouTube) se conserva el salto por
       * tiempo: ahí no hay un texto estructurado al que agarrarse. */
      ttsSaltar(haciaDelante ? TTS_SALTO_SEG : -TTS_SALTO_SEG);
      return;
    }
```

> **Nota:** `TTS_SALTO_SEG` se mantiene en 10 y se sigue usando fuera del PDF. No lo borres.

- [ ] **Paso 3: Atender el salto en el lector**

En `js/pdf/pdfController.js`, junto al listener de `jg-tts-avance` (después de `:2600`):

```javascript
  /* ── Saltar de frase en frase ───────────────────────────────────────
   *
   * El reproductor pide el salto; aquí se resuelve, porque este módulo es el
   * que conoce el texto del capítulo. Si no se puede atender (todavía no hay
   * guía situada), se deja `atendido` en falso y el reproductor salta por
   * tiempo como antes: nunca se queda sin respuesta.
   */
  document.addEventListener('jg-tts-salto-frase', (evento) => {
    const detalle = evento.detail || {};
    if (!hayDocumento()) return;

    const texto = el.salida.value || '';
    const frases = partirEnFrases(texto);
    if (!frases.length) return;

    /* De dónde partimos: de lo que suena si hay voz, de lo que se ve si no. */
    const actual = ttsSonandoAqui() && guia.desde >= 0 ? guia.desde : caracterVisible();
    let i = frases.findIndex(([desde, hasta]) => actual >= desde && actual < hasta);
    if (i < 0) i = 0;

    const destinoIdx = Math.max(0, Math.min(frases.length - 1, i + (detalle.haciaDelante ? 1 : -1)));
    const caracter = frases[destinoIdx][0];

    anotarPosicion({ caracter });
    const destino = bloqueDeCaracter(caracter);
    if (destino && typeof window.ttsIrABloque === 'function' && ttsSonandoAqui()) {
      window.ttsIrABloque(destino.bloque, destino.dentro);
      detalle.atendido = true;
      return;
    }
    /* Sin voz sonando, el salto es visual. */
    irAPosicion(caracter);
    detalle.atendido = true;
  });
```

- [ ] **Paso 4: Añadir el salto de capítulo donde sí hay sitio**

En `index.html`, en la barra superior del lector (la que tiene el título y el porcentaje, busca
`pdf-doc-cab`), añade junto a los controles existentes:

```html
<button type="button" class="mini-btn" id="btnPdfCapPrev" title="Capítulo anterior" aria-label="Capítulo anterior">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:15px;height:15px"><polyline points="15 18 9 12 15 6"/></svg>
</button>
<button type="button" class="mini-btn" id="btnPdfCapNext" title="Capítulo siguiente" aria-label="Capítulo siguiente">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="width:15px;height:15px"><polyline points="9 18 15 12 9 6"/></svg>
</button>
```

Y en el controlador, junto a los demás listeners:

```javascript
  if (el.capPrev) el.capPrev.addEventListener('click', () => {
    if (hayDocumento() && estado.parteActual > 0) mostrarParte(estado.parteActual - 1);
  });
  if (el.capNext) el.capNext.addEventListener('click', () => {
    if (hayDocumento() && estado.parteActual + 1 < estado.partes.length) mostrarParte(estado.parteActual + 1);
  });
```

Regístralos en `el` (cerca de `:104`): `capPrev: $('btnPdfCapPrev'), capNext: $('btnPdfCapNext'),`
y desactívalos cuando no apliquen dentro de `pintarIndice()` o `actualizarBarraDoc()`:

```javascript
    if (el.capPrev) el.capPrev.disabled = estado.parteActual <= 0;
    if (el.capNext) el.capNext.disabled = estado.parteActual + 1 >= estado.partes.length;
```

- [ ] **Paso 5: Que la barra diga en qué capítulo va**

En `index.html`, dentro de `ttsActualizarProgreso()` (línea ~13809), donde se escribe la
etiqueta de tiempo, añade el contexto del capítulo cuando la fuente es el PDF:

```javascript
    if(etiqueta && !ttsState.arrastrando){
      let txt = ttsFormatearTiempo(tActual) + ' / ' + ttsFormatearTiempo(tTotal);
      /* En un libro, «12:30 de 48:00» no ubica a nadie. El capítulo sí. */
      if(id === 'pdf' && window.jgPdfContexto){
        const ctx = window.jgPdfContexto();
        if(ctx) txt = ctx + ' · ' + txt;
      }
      etiqueta.textContent = txt;
```

Y expón el contexto desde el controlador (junto a `window.jgMostrarPulidoEstado`, `:996`):

```javascript
  if (typeof window !== 'undefined') {
    window.jgPdfContexto = () => {
      if (!hayDocumento() || estado.partes.length <= 1) return '';
      return `Cap. ${estado.parteActual + 1}/${estado.partes.length}`;
    };
  }
```

- [ ] **Paso 6: Probar a mano, con el celular primero**

1. En modo dispositivo (390 px de ancho), abre un libro y pon a leer.
2. La barra debe caber en una línea, sin desbordes, con el texto `Cap. 3/12 · 2:14 / 41:03`.
3. Los botones ‹‹ y ›› deben saltar **una frase**, audible al instante.
4. Los botones de capítulo de la barra superior deben desactivarse en el primero y el último.
5. Verifica que en **Micrófono, Archivo y YouTube** los botones siguen saltando ±10 s
   (no deben cambiar de comportamiento).
6. Corre `node tests/verificar_pdf_geometria.mjs` para confirmar que no hay desbordes.

- [ ] **Paso 7: Commit**

```bash
git add index.html js/pdf/pdfController.js
git commit -m "feat(pdf): navegar por frases y capitulos en vez de por segundos"
```

---

## Tarea 8 · Que la auditoría deje de pegar los títulos

Corrige la causa **F**, que es un bug de integridad: hoy `aplicarSignos()` destruye los saltos
de párrafo y el guardián no lo detecta.

**Archivos:**
- Modificar: `js/pdf/pulido.js:166-187` (`aplicarSignos`) y `:60-101` (`mismasPalabras`)
- Prueba: `tests/test_pdf_auditoria_p0.mjs` (ampliar)

- [ ] **Paso 1: Escribir la prueba que falla**

Añade a `tests/test_pdf_auditoria_p0.mjs`, antes del resumen final:

```javascript
console.log('--- 6) aplicarSignos conserva la forma del texto ---');
{
  /* Un título seguido de su párrafo. Si los saltos se pierden, la voz lee
   * «CAPITULO PRIMERO En un lugar...» de corrido, que es exactamente lo que
   * el usuario reporta como «se lee raro». */
  const texto = 'CAPITULO PRIMERO\n\nEn un lugar de la Mancha vivia un hidalgo\n\nY tenia una espada';
  const toks = tokenizarExacto(texto);
  const res = aplicarSignos(texto, toks, [{ pos: toks.length - 1, tipo: 'punto', texto: '.' }]);

  comprobar(typeof res === 'string', 'devuelve texto');
  comprobar(res.includes('\n\n'), 'conserva los saltos de parrafo');
  comprobar((res.match(/\n\n/g) || []).length === 2, 'conserva LOS DOS saltos, no uno');
  comprobar(res.startsWith('CAPITULO PRIMERO\n\n'), 'el titulo sigue separado del parrafo');
  comprobar(res.trim().endsWith('.'), 'y aun asi aplica el signo pedido');
  comprobar(mismasPalabras(texto, res).igual, 'las palabras se conservan al 100 %');
}
{
  /* El salto simple (dentro de un verso, por ejemplo) también cuenta. */
  const texto = 'Verso primero\nVerso segundo';
  const toks = tokenizarExacto(texto);
  const res = aplicarSignos(texto, toks, [{ pos: 1, tipo: 'coma', texto: ',' }]);
  comprobar(res && res.includes('\n'), 'conserva el salto simple');
  comprobar(res && res.includes('primero,'), 'y coloca la coma donde se pidio');
}
{
  /* El guardián debe DETECTAR que se perdieron los saltos, no aprobarlo. */
  const original = 'TITULO\n\nParrafo del cuerpo';
  const aplastado = 'TITULO Parrafo del cuerpo';
  comprobar(mismasPalabras(original, aplastado).igual === false,
    'mismasPalabras rechaza un texto al que le quitaron los saltos');
}
```

- [ ] **Paso 2: Correr y ver que falla**

```bash
node tests/test_pdf_auditoria_p0.mjs
```

Esperado: FALLAN los casos nuevos (`conserva los saltos de parrafo`, etc.).

- [ ] **Paso 3: Arreglar `aplicarSignos`**

En `js/pdf/pulido.js`, reemplaza `aplicarSignos()` (líneas 166-187):

```javascript
/**
 * Aplica los signos validados de la IA al bloque sin tocar palabras.
 * Devuelve el texto con puntuación, o null si algo no cuadra (y entonces
 * el bloque se queda en su capa local, jamás con texto inventado).
 * Cada signo viene como { pos, tipo, texto }: pos es el índice del token;
 * «apertura» se antepone al token (¿ ¡), el resto va pegado detrás.
 *
 * IMPORTANTE — la forma del texto se conserva. La versión anterior rearmaba
 * el bloque con `tokens.join(' ')`, lo que borraba todos los saltos de línea:
 * un título quedaba pegado a su párrafo y la voz los leía de corrido. Ahora se
 * recorre el texto ORIGINAL y solo se insertan los signos en su sitio, así que
 * los espacios, los saltos y la sangría siguen siendo los del autor.
 */
export function aplicarSignos(textoBase, tokens, signos) {
  const base = String(textoBase || '');
  const toks = Array.isArray(tokens) && tokens.length ? [...tokens] : tokenizarExacto(base);
  if (!Array.isArray(signos)) return null;

  const antesDe = new Map();
  const despuesDe = new Map();
  for (const s of signos) {
    const pos = typeof s?.pos === 'number' ? Math.trunc(s.pos) : NaN;
    if (!Number.isFinite(pos) || pos < -1 || pos >= toks.length) return null;
    const sig = String(s?.texto ?? '');
    if (!sig || sig.length > 3 || ![...sig].every((c) => SIGNOS_VALIDOS.has(c))) return null;
    /* Un signo sin token detrás (pos -1) solo tiene sentido como apertura. */
    const mapa = (s?.tipo === 'apertura' || pos === -1) ? antesDe : despuesDe;
    mapa.set(pos, (mapa.get(pos) || '') + sig);
  }

  /* Localizar cada token dentro del texto original, avanzando siempre hacia
   * delante. Los tokens vienen sin signos pegados (los quita `tokenizarExacto`),
   * así que se busca el núcleo de la palabra. */
  let salida = '';
  let cursor = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const tok = toks[i];
    const donde = base.indexOf(tok, cursor);
    if (donde === -1) return null;          /* los tokens no son de este texto */
    /* Todo lo que hay entre el token anterior y este (espacios, saltos,
     * signos que ya estaban) se copia tal cual. */
    salida += base.slice(cursor, donde);
    salida += (antesDe.get(i) || '') + tok + (despuesDe.get(i) || '');
    cursor = donde + tok.length;
  }
  /* Y la cola: lo que venga después del último token. */
  salida += base.slice(cursor);

  const chequeo = mismasPalabras(base, salida);
  return chequeo.igual ? salida : null;
}
```

- [ ] **Paso 4: Que el guardián detecte la pérdida de estructura**

En `js/pdf/pulido.js`, dentro de `mismasPalabras()`, justo antes del `return` final de éxito
(línea 100), añade la comprobación de estructura:

```javascript
  /* Las palabras coinciden, pero un texto no es solo sus palabras: perder los
   * saltos de párrafo pega el título al cuerpo y arruina la lectura en voz
   * alta. Se exige que la cantidad de saltos no disminuya. Que aumente sí se
   * permite: separar mejor un párrafo es una mejora, no una pérdida. */
  const saltosOrig = (String(original).match(/\n/g) || []).length;
  const saltosPul = (String(pulido).match(/\n/g) || []).length;
  if (saltosPul < saltosOrig) {
    return { igual: false, parecido: 0.99, motivo: 'estructura_perdida' };
  }

  return { igual: true, parecido: 1, motivo: 'exacto' };
```

- [ ] **Paso 5: Correr y ver que pasa**

```bash
node tests/test_pdf_auditoria_p0.mjs
node tests/test_pdf_pulido_troceo.mjs
node tests/test_pdf_pulido_mecanico.mjs
```

Esperado: todo en verde, incluidos los 18 casos originales de `test_pdf_auditoria_p0.mjs`.

> **Si `test_pdf_pulido_troceo.mjs` falla** en algún caso que compara textos de una sola línea,
> revisa que la comprobación de estructura no sea demasiado estricta: un texto sin `\n` tiene
> 0 saltos en ambos lados y debe seguir pasando.

- [ ] **Paso 6: Commit**

```bash
git add js/pdf/pulido.js tests/test_pdf_auditoria_p0.mjs
git commit -m "fix(pdf): la auditoria ya no aplasta los saltos de parrafo (titulos pegados)"
```

---

## Tarea 9 · Reconocer los títulos que hoy se escapan

Corrige la causa **G**: dos definiciones de título distintas y una demasiado estrecha.

**Archivos:**
- Modificar: `js/pdf/limpiezaTexto.js:174-183` (`pareceTitulo`), `:291-298` (`clasificarBloque`)
- Prueba: `tests/test_pdf_limpieza.mjs` (ampliar)

- [ ] **Paso 1: Escribir la prueba**

Añade a `tests/test_pdf_limpieza.mjs`, antes del resumen:

```javascript
/* ── Detección de títulos: un criterio único ───────────────────────── */
{
  const modal = 10;   /* altura de línea típica del cuerpo */
  const linea = (texto, extra = {}) => ({ texto, altura: modal, x: 50, ancho: 200, y: 700, ...extra });

  /* Los que ya funcionaban deben seguir funcionando. */
  comprobar(pareceTitulo(linea('CAPÍTULO PRIMERO'), modal), 'reconoce "CAPÍTULO PRIMERO"');
  comprobar(pareceTitulo(linea('Prólogo'), modal), 'reconoce "Prólogo"');
  comprobar(pareceTitulo(linea('Texto grande', { altura: modal * 1.4 }), modal), 'reconoce por tamaño mayor');

  /* Los que se escapaban. */
  comprobar(pareceTitulo(linea('LA CASA DE LOS ESPÍRITUS'), modal),
    'reconoce un titulo en mayusculas del mismo tamaño');
  comprobar(pareceTitulo(linea('II'), modal), 'reconoce un numero romano solo');
  comprobar(pareceTitulo(linea('3. El regreso'), modal), 'reconoce "3. El regreso"');

  /* Y lo que NO debe confundirse con un título. */
  comprobar(!pareceTitulo(linea('En un lugar de la Mancha vivia un hidalgo de los de lanza en astillero.'), modal),
    'una frase larga no es titulo');
  comprobar(!pareceTitulo(linea('dijo el hombre,'), modal), 'algo que acaba en coma no es titulo');
  comprobar(!pareceTitulo(linea('Y entonces se fue.'), modal), 'algo que acaba en punto no es titulo');
  comprobar(!pareceTitulo(linea('12'), modal), 'un numero de pagina no es titulo');

  /* Los dos criterios del archivo deben coincidir: antes no lo hacían. */
  comprobar(clasificarBloque('CAPÍTULO PRIMERO', { altura: modal }) === 'titulo',
    'clasificarBloque coincide con pareceTitulo en un titulo claro');
  comprobar(clasificarBloque('LA CASA DE LOS ESPÍRITUS', { altura: modal }) === 'titulo',
    'clasificarBloque tambien reconoce mayusculas');
}
```

Asegúrate de que `pareceTitulo` y `clasificarBloque` estén exportados y en el `import` del
archivo de pruebas.

- [ ] **Paso 2: Correr y ver que falla**

```bash
node tests/test_pdf_limpieza.mjs
```

Esperado: falla en «mayusculas del mismo tamaño», «numero romano solo», «3. El regreso» y
posiblemente en el `import` si `pareceTitulo` no estaba exportada.

- [ ] **Paso 3: Unificar y ampliar la detección**

En `js/pdf/limpiezaTexto.js`, reemplaza `pareceTitulo()` (líneas 174-183) y **expórtala**:

```javascript
/* Un título numerado: «II», «3.», «IV. El regreso». */
const PATRON_TITULO_NUMERADO = /^(?:\d{1,3}|[IVXLCDM]{1,7})\s*[.\-–—:]?\s*(?:[A-ZÁÉÍÓÚÜÑ].{0,60})?$/;

/**
 * ¿Esta línea es un título de capítulo o de sección?
 *
 * Único criterio del archivo: `clasificarBloque()` lo reutiliza, para que un
 * texto no pueda ser título para una función y párrafo para la otra. Antes
 * había dos reglas distintas y los bloques salían mal tipados.
 *
 * Se reconoce un título por cualquiera de estas señales:
 *   1. Empieza por una palabra de capítulo («Capítulo», «Prólogo», «Anexo»…).
 *   2. Está impreso más grande que el cuerpo.
 *   3. Va TODO EN MAYÚSCULAS y es corto (los libros lo usan constantemente,
 *      y era el caso que más se escapaba).
 *   4. Es una numeración de capítulo («II», «3. El regreso»).
 *
 * Y se descarta si acaba en un signo que solo aparece a mitad de frase, si es
 * demasiado largo, o si es un número de página.
 */
export function pareceTitulo(linea, alturaModal) {
  const texto = String(linea?.texto || '').trim();
  if (!texto || texto.length > MAX_LARGO_TITULO) return false;
  /* Un título no termina en coma, punto y coma, dos puntos ni punto final. */
  if (/[,;:]$/.test(texto)) return false;
  if (esNumeroDePagina(texto)) return false;

  if (PATRON_TITULO.test(texto)) return true;
  if (alturaModal > 0 && (linea.altura || 0) >= alturaModal * 1.25) return true;

  /* Todo en mayúsculas y corto: el caso más común en libros impresos. Se
   * exige al menos dos letras para no confundirlo con una inicial suelta. */
  const letras = texto.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length >= 2 && texto === texto.toUpperCase() && texto.length <= 60 && !/[.!?]$/.test(texto)) {
    return true;
  }

  if (PATRON_TITULO_NUMERADO.test(texto) && !/[.!?]$/.test(texto)) return true;

  return false;
}
```

Y reemplaza `clasificarBloque()` (líneas 291-298) para que **reutilice** la misma regla:

```javascript
export function clasificarBloque(texto, linea) {
  const t = String(texto || '').trim();
  if (!t) return 'nota';
  if (/^(tabla|cuadro|figura)\s*\d*/i.test(t)) return 'tabla';
  if (/^[-•●]\s+/.test(t) || /^\d+\.\s+\S/.test(t) && t.length > 90) return 'lista';
  /* Mismo criterio que el resto del archivo: una sola definición de título. */
  if (pareceTitulo({ texto: t, altura: linea?.altura || 0 }, linea?.alturaModal || 0)) return 'titulo';
  return 'parrafo';
}
```

> **Cuidado con el orden de `lista` y `titulo`:** «3. El regreso» debe ser título, pero
> «1. Comprar pan» dentro de una enumeración debe ser lista. La regla de arriba resuelve el
> empate por longitud: los ítems de lista suelen ser frases, los títulos numerados son cortos.
> Si la prueba de listas de `test_pdf_limpieza.mjs` falla, ajusta ese umbral y **añade un caso
> de prueba** que fije el criterio que elijas.

- [ ] **Paso 4: Correr y ver que pasa**

```bash
node tests/test_pdf_limpieza.mjs
```

Esperado: los 38 casos originales **más** los nuevos, todos en verde. Si alguno de los 38
originales falla, tu regla es demasiado amplia: acótala, no cambies la prueba vieja.

- [ ] **Paso 5: Commit**

```bash
git add js/pdf/limpiezaTexto.js tests/test_pdf_limpieza.mjs
git commit -m "fix(pdf): un unico criterio de titulo, que reconoce mayusculas y numeracion"
```

---

## Tarea 10 · Que la voz respire: pausas efímeras

Corrige la causa **H**. Aquí está la decisión clave del plan, tomada con el usuario:
**las pausas se aplican solo en la capa que va al motor de voz**. El texto que se ve, se guarda,
se exporta y se sincroniza **no cambia ni un carácter**.

**Archivos:**
- Modificar: `js/pdf/vozTexto.js` (`prepararParaVoz`)
- Prueba: `tests/test_pdf_voz.mjs` (nueva)

**Interfaces:**
- Produce: `prepararParaVoz(texto, idioma, { neural, pausarTitulos, comasProsodicas })`

- [ ] **Paso 1: Escribir la prueba**

Crea `tests/test_pdf_voz.mjs`:

```javascript
/* Pruebas de la capa de voz: pausas que suenan bien SIN tocar el texto real.
 * Ejecutar: node tests/test_pdf_voz.mjs
 */
import { prepararParaVoz } from '../js/pdf/vozTexto.js';

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}

/* ── Lo que ya funcionaba debe seguir funcionando ──────────────────── */
{
  comprobar(prepararParaVoz('Vivió en el S. XIX tranquilo', 'es').includes('siglo diecinueve'),
    'sigue expandiendo los siglos romanos');
  comprobar(prepararParaVoz('Fui a EE. UU. de vacaciones', 'es').includes('Estados Unidos'),
    'sigue expandiendo las siglas');
  comprobar(!prepararParaVoz('Párrafo.\n\nSiguiente', 'es').includes('..'),
    'sigue sin generar el doble punto');
  comprobar(prepararParaVoz('', 'es') === '', 'texto vacío devuelve vacío');
  comprobar(prepararParaVoz(null, 'es') === '', 'null no rompe');
}

/* ── Pausa después de un título ────────────────────────────────────── */
{
  /* Sin punto, el motor lee «CAPITULO PRIMERO En un lugar» de corrido. */
  const entra = 'CAPITULO PRIMERO\n\nEn un lugar de la Mancha vivia un hidalgo.';
  const sale = prepararParaVoz(entra, 'es');
  comprobar(/CAPITULO PRIMERO[.:]/.test(sale), 'cierra el titulo para que la voz haga pausa');
  comprobar(sale.includes('En un lugar'), 'el cuerpo sigue intacto');

  /* Un título que YA tiene punto no recibe otro. */
  const conPunto = prepararParaVoz('CAPITULO PRIMERO.\n\nEn un lugar.', 'es');
  comprobar(!conPunto.includes('..'), 'no duplica el punto de un titulo que ya lo tenia');

  /* Un párrafo normal no se toca: solo las líneas cortas y sueltas. */
  const parrafo = 'En un lugar de la Mancha de cuyo nombre no quiero acordarme vivia un hidalgo\n\nY tenia una espada.';
  const salida = prepararParaVoz(parrafo, 'es');
  comprobar(!/hidalgo\./.test(salida), 'un parrafo largo sin punto no recibe punto inventado');
}

/* ── Comas prosódicas: solo para la voz ────────────────────────────── */
{
  const entra = 'Quiso llegar temprano pero el tren se retraso una hora entera.';
  const sale = prepararParaVoz(entra, 'es');
  comprobar(sale.includes(', pero'), 'inserta pausa antes de "pero"');
  /* Y no la duplica si ya estaba. */
  const yaTenia = prepararParaVoz('Quiso llegar, pero no pudo.', 'es');
  comprobar(!yaTenia.includes(',, pero') && !yaTenia.includes(', , pero'),
    'no duplica una coma existente');
}

/* ── La invariante que no se puede romper ──────────────────────────── */
{
  /* Las mismas palabras, en el mismo orden. Solo cambian signos y espacios. */
  const entra = 'CAPITULO II\n\nQuiso llegar temprano pero el tren se retraso.';
  const sale = prepararParaVoz(entra, 'es');
  const palabras = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  comprobar(JSON.stringify(palabras(entra)) === JSON.stringify(palabras(sale)),
    'NO cambia ninguna palabra del texto: solo signos');
}

/* ── Se puede desactivar ───────────────────────────────────────────── */
{
  const entra = 'CAPITULO PRIMERO\n\nQuiso llegar pero no pudo.';
  const crudo = prepararParaVoz(entra, 'es', { pausarTitulos: false, comasProsodicas: false });
  comprobar(!/CAPITULO PRIMERO\./.test(crudo), 'se puede desactivar la pausa de titulo');
  comprobar(!crudo.includes(', pero'), 'se puede desactivar la coma prosodica');
}

/* ── Otros idiomas no se tocan ─────────────────────────────────────── */
{
  const en = prepararParaVoz('CHAPTER ONE\n\nHe wanted to arrive but the train was late.', 'en');
  comprobar(!en.includes(', but'), 'no aplica reglas del español a otro idioma');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
```

- [ ] **Paso 2: Correr y ver que falla**

```bash
node tests/test_pdf_voz.mjs
```

Esperado: fallan los casos de pausa de título y coma prosódica.

- [ ] **Paso 3: Implementar las pausas efímeras**

En `js/pdf/vozTexto.js`, amplía la firma y añade las reglas **al final** de la rama del
español, justo antes del `return salida` (línea 182):

```javascript
/* Conectores que en español piden una pausa antes: sin ella, el partidor de
 * bloques corta donde le toca y la frase se parte a mitad de idea. Se aplica
 * SOLO aquí, en la capa que se le entrega al motor de voz. */
const CONECTORES_PAUSA = /\s+(pero|aunque|sino|porque|mientras|entonces|además|sin embargo|no obstante|es decir|por tanto|por lo tanto)\s+/gi;

/**
 * ¿Esta línea suelta es un título? Versión mínima para la capa de voz: aquí
 * no hay geometría del PDF, solo el texto. Una línea corta, sola entre saltos
 * y sin signo final es, casi siempre, un título o un encabezado.
 */
function pareceTituloSuelto(linea) {
  const t = linea.trim();
  if (!t || t.length > 70) return false;
  if (/[.!?…:;,»)]$/.test(t)) return false;      /* ya cierra: no hace falta */
  const palabras = t.split(/\s+/).filter(Boolean);
  if (palabras.length > 10) return false;
  const letras = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length < 2) return false;
  /* Mayúsculas, o empieza con palabra de capítulo, o es numeración. */
  if (t === t.toUpperCase()) return true;
  if (/^(cap[íi]tulo|parte|secci[óo]n|libro|tomo|ep[íi]logo|pr[óo]logo|introducci[óo]n|conclusi[óo]n|anexo|ap[ée]ndice|prefacio)\b/i.test(t)) return true;
  if (/^(?:\d{1,3}|[IVXLCDM]{1,7})\s*[.\-–—:]?\s*\S*/.test(t) && palabras.length <= 6) return true;
  return false;
}
```

Y dentro de `prepararParaVoz`, cambia la firma y añade el bloque final:

```javascript
export function prepararParaVoz(texto, idioma = 'es', opts = {}) {
  if (!texto || typeof texto !== 'string') return '';
  const neural = opts.neural !== false;              // por defecto true
  const pausarTitulos = opts.pausarTitulos !== false; // por defecto true
  const comasProsodicas = opts.comasProsodicas !== false;
  let salida = texto;
  // ... TODO EL CUERPO ACTUAL SIN CAMBIOS, hasta justo antes del `return salida` ...
```

Y **antes** del `return salida` final:

```javascript
  /* ── Respiración: pausas que solo existen para el oído ──────────────
   *
   * Nada de lo que sigue toca el texto que la persona ve, guarda o exporta:
   * esta cadena se genera justo antes de hablar y se descarta. Por eso se
   * puede añadir puntuación aquí sin romper la promesa de original inmutable.
   */
  if (pausarTitulos) {
    salida = salida.split(/\n\n+/).map((bloque) => {
      const t = bloque.trim();
      if (!t) return '';
      /* Un título sin cierre hace que la voz siga de largo hasta el párrafo
       * siguiente. Los dos puntos suenan mejor que el punto: dejan la
       * entonación abierta, como cuando alguien anuncia un capítulo. */
      return pareceTituloSuelto(t) ? `${t}:` : t;
    }).filter(Boolean).join('\n\n');
  }

  if (comasProsodicas) {
    /* Coma antes del conector solo si no había ya un signo delante. */
    salida = salida.replace(CONECTORES_PAUSA, (coincidencia, conector, desplazamiento, completo) => {
      const anterior = completo[desplazamiento - 1] || '';
      if (/[,;:.!?…]/.test(anterior)) return coincidencia;
      return `, ${conector} `;
    });
  }

  return salida;
```

> **Dónde colocarlo exactamente:** el bloque va dentro de la rama del español, después de la
> normalización de `neural` (líneas 174-181) y antes del `return salida` de la línea 182. Los
> idiomas distintos del español salen antes por el `return` de la línea 93, así que no les
> afecta: la prueba `no aplica reglas del español a otro idioma` lo verifica.

- [ ] **Paso 4: Correr y ver que pasa**

```bash
node tests/test_pdf_voz.mjs
```

- [ ] **Paso 5: Verificar que nada del texto visible cambió**

```bash
node tests/test_pdf_limpieza.mjs
node tests/test_pdf_pulido_mecanico.mjs
node tests/test_pdf_exportar.mjs
```

Esperado: verde. Si `test_pdf_exportar.mjs` fallara, es señal de que las pausas se colaron en
la exportación — sería una violación de la invariante 2 y hay que corregirlo **antes** de
seguir.

- [ ] **Paso 6: Escuchar de verdad (esto ninguna prueba lo cubre)**

Abre un PDF español con capítulos y escucha dos minutos. Comprueba:
- El título se anuncia y hay una pausa antes del cuerpo.
- Las frases largas respiran; no se cortan a mitad de idea.
- No hay pausas dobles ni tartamudeos («..», «, ,»).
- El texto en pantalla **no muestra** los dos puntos ni las comas añadidas.

Anota el resultado en `CAMBIOS_PDF.md`. Si suena mal, ajusta `CONECTORES_PAUSA` antes de
seguir: el objetivo es que suene bien, y eso solo se confirma escuchando.

- [ ] **Paso 7: Commit**

```bash
git add js/pdf/vozTexto.js tests/test_pdf_voz.mjs
git commit -m "feat(pdf): pausas de titulo y respiracion en la voz, sin tocar el texto"
```

---

## Tarea 11 · Explicar qué hace la auditoría mientras la hace

Corrige lo del «puntico verde». El usuario dijo: *no importa si se demora, con tal de que quede
bien — pero quiero saber qué está pasando*. Así que esta tarea **no acelera nada**: hace la
auditoría comprensible y controlable.

**Archivos:**
- Modificar: `js/pdf/auditoria.js:54-65` (estados honestos)
- Modificar: `js/pdf/pdfController.js:998-1025` (estado y consentimiento)
- Modificar: `index.html` (hoja explicativa)
- Prueba: `tests/test_pdf_auditoria_p0.mjs`

- [ ] **Paso 1: Escribir la prueba de los estados**

Añade a `tests/test_pdf_auditoria_p0.mjs`:

```javascript
console.log('--- 7) estados de auditoria honestos ---');
{
  comprobar(estadoAuditoriaTexto(10, 0, 0, 10, false) === 'Esperando permiso',
    'sin consentimiento lo dice claro');
  comprobar(estadoAuditoriaTexto(0, 0, 0, 0, true) === 'Solo local',
    'sin bloques es solo local');
  comprobar(estadoAuditoriaTexto(10, 3, 0, 7, true).includes('3 de 10'),
    'muestra el avance real');

  /* Esto es lo que estaba mal: decia "Cambios por revisar" aunque no hubiera
   * ninguno. Ahora hay que decirle cuantas propuestas hay. */
  comprobar(estadoAuditoriaTexto(10, 10, 0, 0, true, 0) === 'Revisada, sin cambios',
    'terminar sin propuestas NO dice "cambios por revisar"');
  comprobar(estadoAuditoriaTexto(10, 10, 0, 0, true, 4) === '4 sugerencias por revisar',
    'con propuestas dice cuantas');
  comprobar(estadoAuditoriaTexto(10, 10, 0, 0, true, 1) === '1 sugerencia por revisar',
    'una sola sugerencia va en singular');
}
```

- [ ] **Paso 2: Correr y ver que falla**

```bash
node tests/test_pdf_auditoria_p0.mjs
```

- [ ] **Paso 3: Estados honestos**

En `js/pdf/auditoria.js`, reemplaza `estadoAuditoriaTexto()` (líneas 54-61):

```javascript
/**
 * Qué decir en el indicador de la cabecera.
 *
 * `propuestas` es el número de sugerencias pendientes de revisar. Antes no se
 * recibía y la función devolvía «Cambios por revisar» como caso por defecto,
 * aunque no hubiera ninguna: el usuario buscaba cambios que no existían.
 */
export function estadoAuditoriaTexto(numBloques, completados, fallos, pendientes, consentido, propuestas = null) {
  if (!consentido) return 'Esperando permiso';
  if (numBloques === 0) return 'Solo local';
  if (fallos > 0 && completados + fallos < numBloques) return `Parcial ${completados} de ${numBloques}`;
  if (completados < numBloques) return `Revisando ${completados} de ${numBloques}`;
  if (propuestas === 0) return 'Revisada, sin cambios';
  if (propuestas === 1) return '1 sugerencia por revisar';
  if (propuestas > 1) return `${propuestas} sugerencias por revisar`;
  return 'Revisión terminada';
}
```

> Se cambia «Auditando» por «Revisando»: *auditar* es una palabra de contador, y quien lee un
> libro no sabe qué le están auditando. *Revisar* se entiende sin explicación.

- [ ] **Paso 4: Pasarle el número de propuestas**

En `js/pdf/pdfController.js`, dentro de `actualizarEstadoAuditoria()` (líneas 998-1009), calcula
las propuestas pendientes y pásalas:

```javascript
  function actualizarEstadoAuditoria() {
    const total = estado.auditoriaProgreso.total || estado.bloques.length || 0;
    const comp = estado.auditoriaProgreso.completados || 0;
    const fallos = estado.auditoriaProgreso.fallos || 0;
    /* Cuántas sugerencias esperan decisión: solo así el indicador puede decir
     * la verdad en vez de «cambios por revisar» siempre. */
    let pendientesRevision = 0;
    for (const [, lista] of estado.propuestasPorBloque || []) {
      pendientesRevision += Array.isArray(lista) ? lista.length : 0;
    }
    for (const [, decs] of estado.decisionesPorBloque || []) {
      pendientesRevision -= decs ? decs.size : 0;
    }
    pendientesRevision = Math.max(0, pendientesRevision);

    const est = estadoAuditoriaTexto(total, comp, fallos, total - comp, estado.consentido,
      comp >= total ? pendientesRevision : null);
    estado.auditoriaEstado = est;
    if (estado.consentido === false && total > 0) estado.auditoriaEstado = 'Esperando permiso';
    else if (!estado.bloques.length) estado.auditoriaEstado = 'Solo local';
    mostrarPulidoEstado(estado.auditoriaEstado, comp === total && fallos === 0 && total ? 'ok' : '');
    /* Se oculta solo cuando no queda nada por hacer. Si hay sugerencias
     * esperando, el aviso se queda: es una tarea pendiente del usuario. */
    if (estado.auditoriaEstado === 'Revisada, sin cambios') ocultarPulidoEstado(4000);
    actualizarBotonRevision();
  }
```

> **Verifica los nombres:** `estado.propuestasPorBloque` y `estado.decisionesPorBloque` se
> inicializan en `prepararPulidor()` (`:1032-1033`). Confirma que `decisionesPorBloque` guarda
> un `Map` por bloque (por eso el `.size`); si guarda otra cosa, ajusta el conteo y **añade una
> prueba** que lo fije.

- [ ] **Paso 5: Sustituir el `window.confirm` por una hoja que explique**

En `index.html`, junto a las demás hojas del lector (busca `pdfRevisionHoja`), añade:

```html
<div class="pdf-hoja" id="pdfAuditoriaHoja" hidden role="dialog" aria-modal="true" aria-labelledby="pdfAuditoriaTitulo">
  <div class="pdf-hoja-cab">
    <h3 id="pdfAuditoriaTitulo">Revisar la puntuación de este libro</h3>
    <button type="button" class="mini-btn" id="btnPdfAuditoriaCerrar" aria-label="Cerrar">✕</button>
  </div>
  <div class="pdf-hoja-cuerpo">
    <p><strong>Qué hace.</strong> Un PDF no guarda puntos ni comas: guarda letras con
    coordenadas. Al extraer el texto, muchas frases quedan sin puntuación y la voz las lee de
    corrido. Esta revisión propone dónde faltan signos para que el libro se escuche bien.</p>

    <p><strong>Qué NO hace.</strong> No cambia, quita ni añade ni una sola palabra del libro.
    Solo propone signos de puntuación, y cada propuesta la apruebas tú. Si el resultado no
    conserva exactamente tus palabras, se descarta solo.</p>

    <p><strong>Qué se envía.</strong> El <em>texto</em> extraído del PDF, por trozos, al
    proveedor de IA que tengas configurado (<span id="pdfAuditoriaProveedor">—</span>).
    <strong>El archivo PDF nunca sale de tu dispositivo.</strong></p>

    <p><strong>Cuánto tarda.</strong> Depende del tamaño del libro. Empieza por el capítulo que
    estás leyendo, así que puedes seguir leyendo mientras trabaja. Puedes pausarla cuando
    quieras y continuar después: lo ya revisado no se vuelve a pedir.</p>

    <p class="pdf-hoja-nota">Si prefieres no enviar nada, el modo local sigue funcionando: junta
    las líneas, arregla los guiones de corte y quita cabeceras repetidas, todo en tu
    dispositivo.</p>
  </div>
  <div class="pdf-hoja-pie">
    <button type="button" class="btn" id="btnPdfAuditoriaAceptar">Sí, revisar la puntuación</button>
    <button type="button" class="btn ghost" id="btnPdfAuditoriaRechazar">No, solo modo local</button>
  </div>
</div>
```

Reutiliza las clases `.pdf-hoja*` que ya usa `pdfRevisionHoja`. Si sus nombres son otros,
**cópialos de ahí**: no inventes un estilo nuevo, la app ya tiene el suyo.

- [ ] **Paso 6: Conectar la hoja**

En `js/pdf/pdfController.js`, reemplaza `pedirConsentimientoAuditoria()` (líneas 1011-1025):

```javascript
  /**
   * Pide permiso para enviar el texto a la IA, explicando de verdad qué pasa.
   *
   * Antes era un `window.confirm` con un párrafo dentro: bloqueante, feo en
   * celular, y sin espacio para explicar qué se envía y qué no. Ahora es una
   * hoja de la propia app, con el mismo aspecto que el resto.
   */
  function pedirConsentimientoAuditoria() {
    if (estado.consentido) return Promise.resolve(true);
    if (!el.auditoriaHoja) {
      /* Sin la hoja (HTML antiguo en caché), no se envía nada: ante la duda,
       * la opción segura es no mandar el texto a ningún sitio. */
      return Promise.resolve(false);
    }
    const prov = (typeof window.jgCfgGet === 'function' ? window.jgCfgGet('jg_provider', 'gemini') : deps.provider || 'gemini');
    if (el.auditoriaProveedor) el.auditoriaProveedor.textContent = prov;

    return new Promise((resolver) => {
      const cerrar = (ok) => {
        el.auditoriaHoja.hidden = true;
        el.auditoriaAceptar.removeEventListener('click', alAceptar);
        el.auditoriaRechazar.removeEventListener('click', alRechazar);
        if (el.auditoriaCerrar) el.auditoriaCerrar.removeEventListener('click', alRechazar);
        estado.consentido = ok;
        try { localStorage.setItem(`jg_pdf_consent_${estado.id}`, ok ? '1' : '0'); } catch (_) {}
        if (ok) mostrarPulidoEstado('Revisando la puntuación…', '');
        else { mostrarPulidoEstado('Solo local', 'mecanico'); ocultarPulidoEstado(2600); }
        resolver(ok);
      };
      const alAceptar = () => cerrar(true);
      const alRechazar = () => cerrar(false);
      el.auditoriaAceptar.addEventListener('click', alAceptar);
      el.auditoriaRechazar.addEventListener('click', alRechazar);
      if (el.auditoriaCerrar) el.auditoriaCerrar.addEventListener('click', alRechazar);
      el.auditoriaHoja.hidden = false;
      el.auditoriaAceptar.focus();
    });
  }
```

Registra los elementos en `el` (cerca de `:104`):

```javascript
    auditoriaHoja: $('pdfAuditoriaHoja'), auditoriaProveedor: $('pdfAuditoriaProveedor'),
    auditoriaAceptar: $('btnPdfAuditoriaAceptar'), auditoriaRechazar: $('btnPdfAuditoriaRechazar'),
    auditoriaCerrar: $('btnPdfAuditoriaCerrar'),
```

> **Comprueba las llamadas:** `pedirConsentimientoAuditoria` ya era `async` y se llamaba con
> `await`. Ahora devuelve una promesa igualmente, así que los sitios que la usan no cambian.
> Verifícalo buscando `pedirConsentimientoAuditoria` en el archivo.

- [ ] **Paso 7: Que el indicador se pueda abrir para saber más**

El chip `#pdfPulidoEstado` debe poder pulsarse para reabrir la explicación. En `index.html`,
conviértelo en `<button>` (o añádele `role="button"` y `tabindex="0"`), y en el controlador:

```javascript
  if (el.pulidoEstado) el.pulidoEstado.addEventListener('click', () => {
    if (!el.auditoriaHoja) return;
    el.auditoriaHoja.hidden = false;
    if (el.auditoriaProveedor && typeof window.jgCfgGet === 'function') {
      el.auditoriaProveedor.textContent = window.jgCfgGet('jg_provider', 'gemini');
    }
  });
```

Añade `cursor:pointer` y un `title="Ver qué está haciendo"` para que se vea que es pulsable.

- [ ] **Paso 8: Probar a mano**

1. Abre un PDF nuevo → debe aparecer **la hoja**, no el `confirm` del navegador.
2. Pulsa «No, solo modo local» → el chip dice `Solo local` y **no** hay ninguna llamada a
   `/api/improve` (compruébalo en la pestaña Network).
3. Vuelve a abrir y acepta → el chip dice `Revisando 3 de 47…` y va subiendo.
4. Al terminar sin sugerencias → `Revisada, sin cambios`, y se oculta a los 4 s.
5. Al terminar con sugerencias → `4 sugerencias por revisar`, y **no** se oculta.
6. Pulsa el chip en cualquier momento → reabre la explicación.
7. En celular (390 px), la hoja debe caber, con scroll propio y sin desbordes.

- [ ] **Paso 9: Regresión y commit**

```bash
node tests/test_pdf_auditoria_p0.mjs
node tests/verificar_pdf_geometria.mjs
git add js/pdf/auditoria.js js/pdf/pdfController.js index.html tests/test_pdf_auditoria_p0.mjs
git commit -m "feat(pdf): explicar que hace la revision de puntuacion y decir la verdad en el indicador"
```

---

## Tarea 12 · Cierre: pruebas completas, documentación y despliegue

- [ ] **Paso 1: Correr absolutamente todo**

```bash
node tests/test_pdf_ancla.mjs
node tests/test_pdf_progreso.mjs
node tests/test_pdf_limpieza.mjs
node tests/test_pdf_sincronizacion.mjs
node tests/test_pdf_pulido_mecanico.mjs
node tests/test_pdf_pulido_troceo.mjs
node tests/test_pdf_exportar.mjs
node tests/test_pdf_busqueda.mjs
node tests/test_pdf_traduccion.mjs
node tests/test_pdf_auditoria_p0.mjs
node tests/test_pdf_voz.mjs
node tests/verificar_pdf_geometria.mjs
node tests/verificar_pdf_navegador.mjs
python -m pytest backend/tests -q
```

Todas en verde. **Ninguna excepción.**

- [ ] **Paso 2: Recorrido manual de aceptación**

Con el navegador en modo celular (390×844) y luego en escritorio:

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Abrir libro, ir al cap. 3 a media altura, cerrar pestaña sin pulsar nada, reabrir | Aterriza en el mismo punto |
| 2 | Igual, pero con pulido activado | Igual (aquí fallaba antes) |
| 3 | Escuchar 1 min, cerrar de golpe, reabrir | Aterriza en la frase que sonaba |
| 4 | Leer en ventana angosta, luego abrir en ancha | Misma **frase**, no mismo porcentaje |
| 5 | Avanzar leyendo, esperar 60 s, mirar Network | 1 llamada a `subir`, 0 a `parte` |
| 6 | Doble toque en un párrafo con voz sonando | La voz salta ahí en <2 s |
| 7 | Botones ‹‹ ›› con voz sonando | Salta una frase, no 10 s |
| 8 | Botones ‹‹ ›› en Micrófono/Archivo/YouTube | Siguen saltando 10 s |
| 9 | PDF con títulos en mayúsculas | Se separan y la voz pausa antes del cuerpo |
| 10 | Escuchar 2 min seguidos | Suena fluido, sin cortes a mitad de idea |
| 11 | Abrir PDF nuevo | Hoja explicativa, no `confirm` del navegador |
| 12 | Rechazar la revisión | Cero llamadas a `/api/improve` |
| 13 | Exportar a Word el libro revisado | El texto exportado **no** tiene las comas de voz |
| 14 | Consola del navegador durante todo el recorrido | Cero errores |

- [ ] **Paso 3: Documentar en `CAMBIOS_PDF.md`**

Añade una entrada **al principio del archivo**, siguiendo el formato de las anteriores:

```markdown
## Entrega 2026-XX-XX · v5.0 · Lectura continua: retomar donde quedaste

### Lo pedido
[Copia aquí el pedido del usuario, en sus términos]

### Causas encontradas
[Las ocho causas A-H de la sección 1 de PLAN LECTURA CONTINUA PDF.md, con archivo:línea]

### Corrección aplicada
[Una línea por tarea, con archivo:línea del cambio]

### Pruebas
[Cada archivo de prueba con su resultado: N/N]

### Deploy
- `sw.js` → `jg-turbo-shell-vNN`
- `index.html` → `<!-- vX.Y.Z · ... -->`
- Verificado en https://jg-turbo.vercel.app: marcador + /api/health
```

- [ ] **Paso 4: Actualizar la ficha y las reglas**

1. `FICHA_TECNICA.md`: en la sección de PDF, añade que la lectura se reanuda en la frase
   exacta y se sincroniza entre dispositivos.
2. **`AGENTS.md`: corrige el flujo de despliegue.** Hoy describe `Spech to text App/` →
   `vercel_deploy/`, carpetas que ya no existen. Escribe el flujo real con el repo aplanado.
3. Si `sincronizar_deploy.mjs` ya no sirve, dilo en `AGENTS.md` en vez de borrarlo sin avisar.

- [ ] **Paso 5: Subir la versión y desplegar**

```bash
# 1. Sube el número de caché del service worker en sw.js
# 2. Actualiza el marcador de la línea 1 de index.html
git add -A
git commit -m "docs: entrega v5.0 lectura continua del PDF"
npx vercel --prod --yes --scope jhoncod24s-projects
```

- [ ] **Paso 6: Verificar en producción (obligatorio)**

```bash
curl -s https://jg-turbo.vercel.app | head -1
curl -s https://jg-turbo.vercel.app/sw.js | grep -i "shell-v"
curl -s https://jg-turbo.vercel.app/api/health
```

El marcador de `index.html` y la versión del `sw.js` deben ser los nuevos. **Verifica contra
`jg-turbo.vercel.app`, nunca contra la URL que imprime el CLI.**

- [ ] **Paso 7: Avisar al usuario**

Dile qué quedó, qué probaste, y **qué no pudiste verificar** (por ejemplo: si no pudiste probar
con dos dispositivos reales, dilo — no lo des por hecho).

---

## 3. Repaso del resto de la app

Hallazgos de la revisión general, ordenados por lo que más le duele al usuario. **No forman
parte de las tareas de arriba**: se entregan para que el usuario decida qué entra después.

### Prioridad alta

**R1 · `pdfController.js` tiene 135 KB y ~2 800 líneas.**
Concentra el lector, la biblioteca, la auditoría, la traducción, el audiolibro, la exportación,
la búsqueda, el OCR y la sincronización. Es el archivo que más cambia y el que más riesgo tiene
de romperse por un descuido. Sugerencia: extraer `lectorVista.js` (textarea, scroll, guía,
posición), `auditoriaUI.js` y `bibliotecaUI.js`, dejando el controlador como coordinador. **Es
una refactorización grande: hacerla sola, en su propia entrega, con las pruebas ya restauradas.**

**R2 · La sincronización no tiene reintento.**
Si `sincronizar()` falla a mitad (`js/pdf/nube.js:126-192`), lo bajado se queda a medias hasta la
próxima vez que el usuario vuelva a la biblioteca. Con el latido de la Tarea 3 esto mejora, pero
convendría una cola de reintento con espera creciente.

**R3 · `index.html` pesa 718 KB.**
Es la primera descarga de cada usuario nuevo. En un celular con datos móviles en Colombia, eso
se nota. El CSS y el motor TTS podrían salir a archivos propios cacheables por separado, sin
cambiar la arquitectura de un solo archivo para la lógica.

### Prioridad media

**R4 · Quedan 7 `alert`/`confirm`/`prompt` en `index.html`.**
La Tarea 11 quita el más visible. Los demás siguen siendo diálogos del navegador, que en móvil
se ven fuera de lugar y bloquean la app. Conviene unificarlos con el sistema de hojas que la app
ya tiene.

**R5 · El reloj del dispositivo decide quién gana al sincronizar.**
`js/pdf/sincronizacion.js:19-36` compara `actualizado` (hora local). El propio archivo lo admite
en su cabecera. Si un dispositivo tiene la hora mal, sus cambios ganan o pierden mal. Un
contador que solo sube por documento sería más robusto, pero exige cambio de esquema: solo si
el usuario reporta pérdidas reales.

**R6 · El respaldo `JG Turbo_OLD` ocupa espacio y confunde.**
Tiene el `node_modules` y dos copias del proyecto. Una vez confirmado que `jg-turbo` está
completo (incluidas las pruebas de la Tarea 0), conviene archivarlo comprimido fuera de
`Proyectos\`. **Decisión del usuario: no lo borres tú.**

**R7 · La traducción y el OCR no muestran progreso real en libros largos.**
Un libro de 300 páginas en OCR puede tardar mucho sin decir cuánto falta. Reutilizar el patrón
de estado que la Tarea 11 deja montado para la revisión.

### Prioridad baja

**R8 · `temp.js` (250 KB) en la raíz.** Parece un resto de trabajo. Verificar si algo lo usa y,
si no, retirarlo.

**R9 · Los archivos `debug-*.md`** documentan fallos de junio ya resueltos. Podrían moverse a
una carpeta `docs/historico/`.

**R10 · Fixtures de PDF que faltan.** `PLAN pulir gramatica pdf.md` pedía casos de dos columnas
y de tablas; siguen pendientes (`CAMBIOS_PDF.md` lo reconoce en «Queda pendiente»). Sin ellos,
la mejora de columnas de la v4.0 no tiene red.

---

## 4. Resumen para quien ejecuta

| Tarea | Qué arregla | Riesgo | Depende de |
|---|---|---|---|
| 0 | Restaura las pruebas perdidas | Ninguno | — |
| 1 | Ancla de texto portable | Bajo (módulo nuevo) | 0 |
| 2 | La posición sobrevive al pulido y al cambio de pantalla | **Alto** (toca el corazón del lector) | 1 |
| 3 | Guardar al ocultar la app | Medio | 2 |
| 4 | Sincronizar el avance sin resubir el libro | Medio | 3 |
| 5 | Decir dónde quedó la lectura | Bajo | 2 |
| 6 | Doble toque para leer desde ahí | Bajo | 2 |
| 7 | Navegar por frases y capítulos | Medio | 6 |
| 8 | Títulos que dejan de pegarse | Medio | 0 |
| 9 | Reconocer más títulos | Medio | 8 |
| 10 | La voz respira | Bajo (capa efímera) | 9 |
| 11 | La revisión se explica | Bajo | 0 |
| 12 | Pruebas, documentación y despliegue | — | todas |

**La Tarea 2 es la más delicada de todo el plan.** Toca la función que pinta cada capítulo.
Hazla con calma, prueba los seis casos del Paso 7 uno por uno, y no la agrupes con otra en el
mismo commit: si algo se rompe, tienes que poder revertir solo eso.

**Si algo de este plan no encaja con lo que encuentras en el código**, no fuerces la
implementación: el código manda sobre el plan. Anota la diferencia, resuélvela con el mismo
criterio, y déjalo escrito en `CAMBIOS_PDF.md` para el siguiente.
