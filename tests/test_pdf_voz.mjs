/* Pruebas de la capa de voz: pausas que suenan bien SIN tocar el texto real.
 * Ejecutar: node tests/test_pdf_voz.mjs
 */
import { prepararParaVoz, textoVozParaAncla, elegirCompactoVoz } from '../js/pdf/vozTexto.js';
import { compactarTexto } from '../js/pdf/guiaAnclas.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fallos = 0;
function comprobar(condicion, mensaje) {
  if (condicion) console.log(`OK: ${mensaje}`);
  else { fallos += 1; console.error(`FALLO: ${mensaje}`); }
}
/* Pausa estructural (plan §4): en neural la pausa tras un título es la marca
 * §P0700§ (silencio real en la cola); en navegador, los dos puntos. */
const conPausaTitulo = (sale, titulo) =>
  sale.includes('§P0700§') || new RegExp(titulo + '[.:]').test(sale);

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
  comprobar(conPausaTitulo(sale, 'CAPITULO PRIMERO'), 'cierra el titulo para que la voz haga pausa');
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
  const palabras = (t) => t.replace(/§P\d+§/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

/* ══════════════════════════════════════════════════════════════════════
 * v5.1 · Que un libro suene a libro, no a base de datos
 * ══════════════════════════════════════════════════════════════════════ */

/* ── Referencias entre corchetes: la voz no debe decirlas ──────────── */
{
  const sale = prepararParaVoz('La teoría se consolidó pronto [12] y nadie la discutió.', 'es');
  comprobar(!sale.includes('12'), 'una referencia [12] no se lee');
  comprobar(sale.includes('consolidó pronto') && sale.includes('y nadie'),
    'el texto alrededor de la referencia queda intacto');
  comprobar(!/\s{2,}/.test(sale), 'no deja un hueco doble donde estaba la referencia');
  comprobar(!/\s+[.,;:]/.test(sale), 'no deja un espacio suelto antes del signo');
}
{
  comprobar(!prepararParaVoz('Varios autores [3, 4, 5] coinciden.', 'es').includes('3'),
    'una lista de referencias [3, 4, 5] no se lee');
  comprobar(!prepararParaVoz('Ver los trabajos [12-15] del periodo.', 'es').includes('12'),
    'un rango de referencias [12-15] no se lee');
  comprobar(!prepararParaVoz('Como sostiene el autor [ii] en su obra.', 'es').includes('ii'),
    'una referencia romana [ii] no se lee');
  comprobar(!prepararParaVoz('Nota al margen [*] del editor.', 'es').includes('*'),
    'una llamada [*] no se lee');
  /* La misma convención con paréntesis o llaves. */
  comprobar(!prepararParaVoz('Lo dijo antes (12) y lo repitió.', 'es').match(/\(12\)/),
    'una referencia (12) entre paréntesis tampoco se lee');
}
{
  /* Pero un corchete con palabras es una acotación editorial: se conserva. */
  const sale = prepararParaVoz('Dijo que [el rey] había muerto.', 'es');
  comprobar(sale.includes('el rey'), 'una acotación [el rey] SÍ se lee');
  const sic = prepararParaVoz('Escribió «haiga» [sic] en la carta.', 'es');
  comprobar(sic.includes('sic'), 'la acotación [sic] se conserva');
  const puntos = prepararParaVoz('La cita continúa [...] y termina aquí.', 'es');
  comprobar(!puntos.includes('[') && !puntos.includes(']'),
    'la elipsis editorial [...] no deja corchetes sueltos');
}

/* ── Números de nota pegados a la palabra ──────────────────────────── */
{
  /* Al extraer un PDF, los superíndices de nota quedan pegados: «estudio12».
   * El motor lo lee «estudio doce» y, peor, lo toma por término técnico
   * inglés y CAMBIA DE VOZ a media frase. */
  const sale = prepararParaVoz('Según el estudio12 más reciente del grupo.', 'es');
  comprobar(sale.includes('estudio') && !sale.includes('estudio12'),
    'separa el número de nota pegado a la palabra');
  comprobar(!/estudio\s+12/.test(sale), 'y no lo deja suelto como número aparte');

  const varios = prepararParaVoz('La evolución3 de la especie4 fue lenta.', 'es');
  comprobar(!varios.includes('3') && !varios.includes('4'),
    'quita varios números de nota en la misma frase');

  /* Pero un número que es parte de la palabra NO se toca. */
  comprobar(prepararParaVoz('El compuesto H2O es agua.', 'es').includes('H2O'),
    'no rompe una fórmula como H2O');
  comprobar(prepararParaVoz('Usamos el modelo GPT4 hoy.', 'es').includes('GPT4'),
    'no rompe un nombre técnico como GPT4');
  comprobar(prepararParaVoz('Vivió en 1914 tranquilo.', 'es').includes('1914'),
    'no toca un año suelto');
  comprobar(prepararParaVoz('Costó 45 pesos.', 'es').includes('45'),
    'no toca una cifra normal');
}

/* ── Abreviaturas académicas ───────────────────────────────────────── */
{
  const sale = prepararParaVoz('Véase cf. la obra citada.', 'es');
  comprobar(sale.includes('compárese') || sale.includes('confróntese'),
    'expande «cf.» en vez de deletrearlo');
  comprobar(/en la misma obra/i.test(prepararParaVoz('Ibíd., p. 45.', 'es')),
    'expande «ibíd.»');
  comprobar(prepararParaVoz('García et al. lo demostraron.', 'es').includes('y otros'),
    'expande «et al.» (que además sonaba a latín mal leído)');
  comprobar(prepararParaVoz('Ver op. cit. para el detalle.', 'es').includes('obra citada'),
    'expande «op. cit.»');
  comprobar(/n[uú]mero/i.test(prepararParaVoz('El n.º 7 del catálogo.', 'es')),
    'expande «n.º»');
  comprobar(prepararParaVoz('Ver fig. 3 arriba.', 'es').includes('figura'),
    'expande «fig.»');
  /* Y las que ya funcionaban siguen igual. */
  comprobar(prepararParaVoz('Ver pág. 12 del libro.', 'es').includes('página'),
    'sigue expandiendo «pág.»');
}

/* ── Direcciones web y correos ─────────────────────────────────────── */
{
  /* Leer una URL letra a letra es insoportable en un audiolibro. */
  const sale = prepararParaVoz('Consulta https://www.ejemplo.com/ruta/larga para más datos.', 'es');
  comprobar(!sale.includes('https'), 'no deletrea el protocolo de una URL');
  comprobar(sale.includes('enlace web'), 'la sustituye por «enlace web»');
  const correo = prepararParaVoz('Escribe a contacto@ejemplo.com hoy.', 'es');
  comprobar(!correo.includes('@'), 'no deletrea un correo');
  comprobar(correo.includes('dirección de correo'), 'lo sustituye por «dirección de correo»');
}

/* ── Iniciales de nombres ──────────────────────────────────────────── */
{
  /* «J. R. R. Tolkien» tiene tres puntos: el partidor de oraciones cree que
   * son tres frases y la voz hace tres caídas tonales seguidas. */
  const sale = prepararParaVoz('Lo escribió J. R. R. Tolkien en su juventud.', 'es');
  comprobar(sale.includes('Tolkien'), 'conserva el apellido');
  comprobar(!/J\.\s+R\.\s+R\./.test(sale), 'junta las iniciales para no cortar la oración');
}

/* ── Concordancia y forma después de sustituir ─────────────────────── */
{
  /* Al juntar las iniciales no puede perderse el espacio del apellido:
   * «J.R.R.Malthus» se lee como una sola palabra inventada. */
  const sale = prepararParaVoz('Lo dijo J. R. R. Malthus en su ensayo.', 'es');
  comprobar(/J\.R\.R\.\s+Malthus/.test(sale), 'las iniciales se juntan pero el apellido queda separado');

  /* Una abreviatura que abre la frase debe expandirse con mayúscula. */
  const abre = prepararParaVoz('Todo cambió. Cf. la obra citada.', 'es');
  comprobar(/\.\s+[A-ZÁÉÍÓÚÑ]/.test(abre), 'tras un punto la frase empieza en mayúscula');
  comprobar(!abre.includes('. compárese'), 'no deja la expansión en minúscula tras el punto');

  /* «el § 4» no puede convertirse en «el sección 4». */
  const parrafo = prepararParaVoz('Ver el § 4 del reglamento.', 'es');
  comprobar(!parrafo.includes('el sección'), 'no rompe la concordancia con el artículo');
  comprobar(/par[áa]grafo|secci[óo]n/.test(parrafo), 'y aun así dice el símbolo con palabras');
}

/* ── Símbolos que no se dicen ──────────────────────────────────────── */
{
  comprobar(/secci[óo]n|par[áa]grafo/.test(prepararParaVoz('Según § 4 del texto.', 'es')),
    'el símbolo de sección se dice con palabras');
  comprobar(!prepararParaVoz('Un guion — largo — aquí.', 'es').includes('~'),
    'no aparecen símbolos sueltos');
  const barras = prepararParaVoz('La relación autor/lector cambia.', 'es');
  comprobar(barras.includes('autor') && barras.includes('lector'),
    'la barra entre palabras no rompe la frase');
}

/* ── La invariante sigue en pie ────────────────────────────────────── */
{
  /* Quitar referencias SÍ quita "palabras" (los números de nota), y eso es
   * exactamente lo pedido. Lo que no puede pasar es que se pierda una
   * palabra real del autor. */
  const entra = 'El autor sostiene [12] que la teoría es correcta y la defiende.';
  const sale = prepararParaVoz(entra, 'es');
  for (const palabra of ['autor', 'sostiene', 'teoría', 'correcta', 'defiende']) {
    comprobar(sale.includes(palabra), `conserva la palabra «${palabra}» del autor`);
  }
}

/* ── Se puede desactivar la limpieza ───────────────────────────────── */
{
  const crudo = prepararParaVoz('La teoría [12] es correcta.', 'es', { limpiarReferencias: false });
  comprobar(crudo.includes('[12]'), 'se puede desactivar la limpieza de referencias');
}

/* ── Casos límite: nada de esto puede romper ───────────────────────── */
{
  comprobar(prepararParaVoz('[12]', 'es').trim() === '', 'un texto que es solo una referencia queda vacío');
  comprobar(typeof prepararParaVoz('[[[', 'es') === 'string', 'corchetes sin cerrar no rompen');
  comprobar(typeof prepararParaVoz('a'.repeat(50000), 'es') === 'string', 'un texto larguísimo no rompe');
  comprobar(prepararParaVoz('   ', 'es').trim() === '', 'solo espacios queda vacío');
  comprobar(typeof prepararParaVoz('[1] [2] [3] [4] [5]', 'es') === 'string',
    'muchas referencias seguidas no rompen');
}

/* ── `#` de conteo se dice con palabras (biblioteca pública, 2026-09-09) ──
 * Medido: `Secreto #1`…`#32`, `Principle #1`, `Ad Agency Secret #18`,
 * `LF8 #2`, `The #1 brand`. Cero etiquetas sociales. Fish/Edge lo leían
 * como «hashtag». Solo capa voz: el texto visible/guardado no se toca. */
{
  const s1 = prepararParaVoz('Secreto #1: ¿Qué es el copywriting?', 'es');
  comprobar(s1.includes('número 1') && !s1.includes('#') && !/hashtag/i.test(s1),
    '«Secreto #1» suena «número 1», sin hashtag');
  const s10 = prepararParaVoz('Secreto #10: Lo que de VERDAD vende a la gente', 'es');
  comprobar(s10.includes('número 10') && !s10.includes('#'),
    '«Secreto #10» suena «número 10»');
  comprobar(prepararParaVoz('Ver el # 12 del conteo', 'es').includes('número 12'),
    '«# 12» con espacio también es conteo');
  comprobar(prepararParaVoz('Nivel (LF#8) y zona LF8 #2', 'es').includes('número 8')
    && prepararParaVoz('Nivel (LF#8) y zona LF8 #2', 'es').includes('número 2'),
    '«LF#8» pegado sin espacio también es conteo');
  comprobar(prepararParaVoz('El capítulo # cierra aquí', 'es').includes('número')
    && !prepararParaVoz('El capítulo # cierra aquí', 'es').includes('#'),
    'un «#» solo suena «número»');
  const etiqueta = prepararParaVoz('Síguenos en #lectura diaria', 'es');
  comprobar(/hashtag lectura/i.test(etiqueta) && !etiqueta.includes('#'),
    '«#lectura» pegado a letras se conserva como etiqueta social');
  const url = prepararParaVoz('Consulta https://www.ejemplo.com/page4#reference4.2 para más', 'es');
  comprobar(url.includes('enlace web') && !url.includes('#') && !/número|hashtag/i.test(url),
    'el «#» dentro de una URL no se vuelve conteo (ya es «enlace web»)');
  const en = prepararParaVoz('Principle #1: The Fear Factor', 'en');
  comprobar(en.includes('number 1') && !en.includes('#') && !/hashtag/i.test(en),
    'en inglés suena «number 1»');
  const enMarca = prepararParaVoz('The #1 brand in vended water', 'en');
  comprobar(enMarca.includes('number 1') && !enMarca.includes('#'),
    '«The #1 brand» suena «number 1»');
  const enUrl = prepararParaVoz('See https://example.com/a#b2 here', 'en');
  comprobar(enUrl.includes('web link') && !enUrl.includes('#'),
    'en inglés la URL con «#» tampoco se vuelve conteo');
  comprobar(!/  /.test(prepararParaVoz('The #1 brand here', 'en')),
    'la rama inglesa no deja dobles espacios');
  const cuerpo = prepararParaVoz('Secreto #5: La habilidad más valiosa.', 'es');
  for (const palabra of ['Secreto', 'habilidad', 'valiosa']) {
    comprobar(cuerpo.includes(palabra), `con «#» se conserva «${palabra}» del autor`);
  }
  comprobar(prepararParaVoz('Secreto ＃1 del índice', 'es').includes('número 1'),
    'el «#» de ancho completo de un PDF también es conteo');
}

/* ── La guía debe compactar la voz SIN las palabras que se insertaron ──
 * Visible `Secreto #1` → `secreto1`. Voz `Secreto número 1` → si se compacta
 * tal cual, `secretonumero1` no aparece y la marca se va dos párrafos abajo. */
{
  const visible = 'Secreto #1: ¿Qué es el copywriting? El resto del párrafo sigue aquí con calma.';
  const voz = prepararParaVoz(visible, 'es');
  comprobar(voz.includes('número 1'), 'la voz sigue diciendo «número 1»');
  const visC = compactarTexto(visible).texto;
  const crudo = compactarTexto(voz).texto;
  const alin = compactarTexto(textoVozParaAncla(voz)).texto;
  comprobar(!visC.includes('numero'), 'el visible compacto no tiene «numero» (el # se tira)');
  comprobar(crudo.includes('numero'), 'el compacto crudo de la voz sí tiene «numero»');
  comprobar(alin === visC.slice(0, alin.length) || visC.startsWith(alin.slice(0, 12)),
    'alineado, el arranque de la voz coincide con el visible');
  comprobar(elegirCompactoVoz(crudo, alin, visC) === alin,
    'con `#1` se elige el compacto alineado, no el crudo');
  const autor = 'Había el número 1 en la lista de espera aquella mañana fría del pueblo.';
  const autorC = compactarTexto(autor).texto;
  const autorVoz = prepararParaVoz(autor, 'es');
  const autorCrudo = compactarTexto(autorVoz).texto;
  const autorAlin = compactarTexto(textoVozParaAncla(autorVoz)).texto;
  comprobar(elegirCompactoVoz(autorCrudo, autorAlin, autorC) === autorCrudo,
    'si el autor escribió «número 1», se conserva el compacto crudo');
  const ctrl = fs.readFileSync(path.join(__dirname, '../js/pdf/pdfController.js'), 'utf8');
  comprobar(ctrl.includes('textoVozParaAncla') && ctrl.includes('elegirCompactoVoz'),
    'situarBloques alinea la voz con el visible (no compacta el crudo a ciegas)');
}

/* ── Pausa tras títulos breves sin palabra clave (auditoría 2026-09-10) ──
 * «Una decisión radical», «El placebo eres tú» o «Jim Edwards» no están en
 * la lista de palabras clave y la voz los leía de corrido con el párrafo
 * siguiente. Solo capa voz: el visible no se toca. */
{
  const t1 = prepararParaVoz('Una decisión radical\n\nA pesar de que el equipo médico me lo desaconsejara.', 'es');
  comprobar(conPausaTitulo(t1, 'Una decisión radical'), '«Una decisión radical» recibe pausa antes del cuerpo');
  const t2 = prepararParaVoz('El placebo eres tú\n\nDescubre el poder de tu mente.', 'es');
  comprobar(conPausaTitulo(t2, 'El placebo eres tú'), '«El placebo eres tú» recibe pausa');
  const t3 = prepararParaVoz('Jim Edwards\n\nSecretos de Copywriting.', 'es');
  comprobar(conPausaTitulo(t3, 'Jim Edwards'), 'el nombre del autor suelto recibe pausa');
  /* Y no se traga una frase corta real: con conjunción inicial no es título. */
  const frase = prepararParaVoz('Y en algún momento del recorrido me di cuenta de algo importante aquí.', 'es');
  comprobar(!/^Y en algún momento del recorrido[^:]*:/.test(frase.split('\n\n')[0] || ''),
    'una frase con conjunción inicial no se marca como título');
}

/* ── Nombres propios en minúscula (auditoría 2026-09-10, «El placebo») ──
 * Solo cambia la caja: el compacto de la guía (minúsculas sin tildes) queda
 * idéntico, así que el ancla no se mueve. */
{
  comprobar(prepararParaVoz('Traducción: núria Martí pérez.', 'es').includes('Núria Martí Pérez'),
    '«núria Martí pérez» suena con mayúsculas');
  comprobar(prepararParaVoz('Editor original: Hay House, california.', 'es').includes('California'),
    '«california» suena «California»');
  comprobar(prepararParaVoz('Te presentaré a candace hoy.', 'es').includes('Candace')
    && !prepararParaVoz('Te presentaré a candace hoy.', 'es').includes('candace'),
    '«candace» suena «Candace»');
  comprobar(prepararParaVoz('Con la colaboración de Jeffrey Fannin ph. D.', 'es').includes('Ph. D.'),
    '«ph. D.» suena «Ph. D.»');
  const voz = prepararParaVoz('Te presentaré a candace hoy mismo aquí.', 'es');
  comprobar(compactarTexto(voz).texto === compactarTexto('Te presentaré a candace hoy mismo aquí.').texto,
    'el cambio de caja no mueve el compacto de la guía');
}

/* ── Secretos de Copywriting (2026-09-10): chatter + títulos con paréntesis ──
 * La frase «no hay texto para traducir, por favor proporciona el bloque…»
 * venía de párrafos dummy del Bookey y se colaba en la narración. Y los
 * títulos viejos sin punto que cierran con «)» («Definir a tu cliente ideal
 * (FRED)») se leían de corrido porque el «)» se tomaba por cierre. */
{
  const frase = 'no hay texto para traducir, por favor proporciona el bloque de texto que necesitas convertir al español siguiendo las instrucciones dadas';
  const vozChatter = prepararParaVoz(`Hola mundo. ${frase} Siguiente párrafo.`, 'es');
  comprobar(!vozChatter.toLowerCase().includes('no hay texto') && !vozChatter.toLowerCase().includes('bloque de texto'),
    'el chatter de traducción no llega a la voz');
  comprobar(vozChatter.includes('Hola mundo') && vozChatter.includes('Siguiente párrafo'),
    'el texto real alrededor del chatter queda intacto');
  const tParentesis = prepararParaVoz('Definir a tu cliente ideal (FRED)\n\nConocer a tu cliente es fundamental.', 'es');
  comprobar(conPausaTitulo(tParentesis, '\\(FRED\\)'),
    'un título que cierra con paréntesis recibe pausa antes del cuerpo');
  const tLargo = prepararParaVoz('Cómo colaboran las historias y el texto de ventas\n\nLas historias despiertan la sed.', 'es');
  comprobar(conPausaTitulo(tLargo, 'ventas'),
    'un título de sección largo sin punto recibe pausa');
  const tConPunto = prepararParaVoz('Definir a tu cliente ideal (FRED).\n\nCuerpo.', 'es');
  comprobar(!/\(FRED\)\.:/.test(tConPunto) && !tConPunto.includes('..'),
    'un título que ya trae punto no recibe pausa doble');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
