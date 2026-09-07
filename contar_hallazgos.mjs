import { execSync } from 'node:child_process';

const out = execSync('"C:/Users/juanl/Documents/Proyectos/Skills/impeccable/scripts/impeccable.cmd" detect --json index.html', {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});

const issues = JSON.parse(out);
console.log('Total hallazgos:', issues.length);
const byPattern = {};
for (const i of issues) {
  byPattern[i.antipattern] = (byPattern[i.antipattern] || 0) + 1;
}
console.log('Por categoría:', byPattern);
