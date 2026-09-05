import assert from 'node:assert/strict';
import { crearAtomo } from '../js/pdf/atomos.js';
import { reconstruirDesdeAtomos, invarianteLetras } from '../js/pdf/reconstruccion.js';
import { aplicarDecisionUsuario, expandirManifiesto } from '../js/pdf/limites.js';
import { serializarReconstruccion } from '../js/pdf/manifiesto.js';

// Los átomos de lectura ya excluyen cabeceras. Una segunda detección de
// relleno sobre ellos borraba las nuevas primeras líneas en cada revisión.
const atomos = [];
for (let page=1;page<=4;page++) {
  ['La niebla cubre el camino del bosque.', 'Compren', 'dido por quienes caminan juntos.', `Fin de la página ${page}.`]
    .forEach((str,itemIndex)=>atomos.push(crearAtomo({page,itemIndex,str,x:70,y:700-itemIndex*16,width:230,height:11,hasEOL:true})));
}
const base = reconstruirDesdeAtomos(atomos,{atomosYaFiltrados:true});
assert(invarianteLetras(atomos,base.texto,base.limites));
const serial = JSON.parse(JSON.stringify(serializarReconstruccion(base)));
const limites = expandirManifiesto(serial.manifiesto);
const reconstruir = () => reconstruirDesdeAtomos(serial.atomos,{atomosYaFiltrados:true,limitesPrevios:limites});
assert.equal(reconstruir().texto,base.texto,'guardar/reabrir conserva todo el texto');
const limite=limites.find(l=>l.leftFragment==='Compren');
assert(limite);
const anterior={...limite};
aplicarDecisionUsuario(limite,'space');
const separado=reconstruir();
assert(separado.texto.includes('Compren dido'));
aplicarDecisionUsuario(limite,'join');
const unido=reconstruir();
assert(unido.texto.includes('Comprendido'));
assert(invarianteLetras(atomos,unido.texto,unido.limites));
Object.assign(limite,anterior);
assert.equal(reconstruir().texto,base.texto,'deshacer restaura la decisión y el texto exactos');
// Un ID de otra fuente no autoriza cambios.
limites[0]={...limites[0],leftAtomId:'otro-documento',decision:'join'};
assert(invarianteLetras(atomos,reconstruir().texto,reconstruir().limites));
console.log('OK: 8 comprobaciones de decisiones, persistencia, deshacer y conservación de letras.');
