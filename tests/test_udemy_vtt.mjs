import assert from 'node:assert/strict';
const { leerVtt, segmentosDesdeTextTrack } = await import('../extension-udemy/lib/vtt.js');
let ok = 0;
function igual(actual, esperado, mensaje) { assert.deepEqual(actual, esperado, mensaje); console.log(`OK: ${mensaje}`); ok++; }
const cue = (texto, tiempo = '00:01.000 --> 00:03.000') => `WEBVTT\n\n${tiempo}\n${texto}\n`;
igual(leerVtt(cue('Hello')), [{ startTime: 1, endTime: 3, duration: 2, text: 'Hello' }], 'tiempos sin horas');
igual(leerVtt(cue('Hello', '00:00:01.000 --> 00:00:03.000')), leerVtt(cue('Hello')), 'tiempos con horas');
igual(leerVtt(cue('Hello', '00:01.000 --> 00:03.000 align:start position:10%')), leerVtt(cue('Hello')), 'ajustes del cue');
igual(leerVtt(cue('<c.color>Hello</c> <i>world</i><00:00:01.500>'))[0].text, 'Hello world', 'etiquetas de texto y tiempo');
igual(leerVtt(cue('&amp; &gt; &lt; &quot; &#39; &#x41;'))[0].text, '& > < " \' A', 'entidades');
igual(leerVtt(cue('One\ntwo'))[0].text, 'One two', 'cue partido en dos lineas');
igual(leerVtt('\uFEFF' + cue('Hello').replace(/\n/g, '\r\n')), leerVtt(cue('Hello')), 'BOM y CRLF');
igual(leerVtt('WEBVTT\n\nNOTE nota\nignorar\n\nidentificador\n00:01.000 --> 00:03.000\nHello'), leerVtt(cue('Hello')), 'NOTE e identificador');
igual(leerVtt(cue('')), [], 'cue vacio');
igual(leerVtt(cue('Hello', '00:03.000 --> 00:01.000')), [], 'tiempo invertido');
igual(leerVtt('WEBVTT\n\nSTYLE\n::cue { color: red; }\n\n' + cue('Hello').split('\n\n')[1]), leerVtt(cue('Hello')), 'STYLE no se lee');
igual(segmentosDesdeTextTrack({ cues: [{ startTime: 1, endTime: 3, text: '<i>Hello</i>' }] }), leerVtt(cue('Hello')), 'TextTrackCue se convierte');
console.log(`${ok} comprobaciones OK · 0 fallos`);
