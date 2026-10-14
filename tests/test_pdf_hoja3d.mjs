import assert from 'node:assert/strict';
import { geometriaHoja } from '../js/pdf/hoja3d.js';
let ok = 0;
const comprobar = (v, t) => { assert.ok(v, t); console.log('OK: '+t); ok++; };
const cerca = (a,b) => Math.abs(a-b) < .001;
for (const dir of [1,-1]) {
  const inicio = geometriaHoja(390,0,dir);
  comprobar(inicio.piezas.every((t,i)=>cerca(t.x,i*39)&&cerca(t.z,0)&&cerca(t.angulo,0)), `${dir}: la página comienza plana en sus coordenadas`);
  const medio = geometriaHoja(390,.5,dir);
  comprobar(Math.max(...medio.piezas.map(t=>t.angulo))-Math.min(...medio.piezas.map(t=>t.angulo)) > 50, `${dir}: hay curvatura, no un plano rígido`);
  comprobar(medio.piezas.some(t=>t.angulo<90)&&medio.piezas.some(t=>t.angulo>90), `${dir}: en el pliegue se ven zonas de frente y reverso`);
  comprobar(medio.piezas.some(t=>t.z>90), `${dir}: el papel se levanta en profundidad`);
  comprobar(medio.sombra>0, `${dir}: hay sombra durante el giro`);
  const fin=geometriaHoja(390,1,dir);
  comprobar(fin.piezas.every(t=>cerca(t.angulo,180)&&Math.abs(t.z)<.001), `${dir}: finaliza con un giro completo`);
  comprobar(fin.piezas.every(t=>dir>0?t.x<=.001:t.x>=390-.001), `${dir}: la hoja termina fuera del área visible`);
  comprobar(geometriaHoja(390,.5,dir,1).piezas[0].angulo===90, `${dir}: respaldo rígido también gira, no desliza`);
  for(const p of [0,.1,.25,.5,.75,.9,1]){
    const g=geometriaHoja(390,p,dir);
    comprobar(g.piezas.every(t=>[t.x,t.z,t.angulo,t.luz].every(Number.isFinite)), `${dir}: geometría finita en ${p}`);
  }
}
comprobar(geometriaHoja(390,-1).piezas[0].angulo===0,'limita un progreso negativo');
comprobar(cerca(geometriaHoja(390,2).piezas[0].angulo,180),'limita un progreso superior a uno');
console.log(`\n${ok} comprobaciones OK · 0 fallos`);
