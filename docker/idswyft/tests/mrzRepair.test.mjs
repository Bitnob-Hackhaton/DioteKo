// Test de td1RepairCandidates sur des lignes FICTIVES (aucune donnee reelle).
// node --experimental-strip-types --no-warnings docker/idswyft/tests/mrzRepair.test.mjs
import assert from 'node:assert/strict';
import { td1RepairCandidates } from '../overlay/engine/src/services/mrzRepair.ts';

const L1 = 'IDSEN'.padEnd(30, '<'); // 30
const L2 = ('0101015M3001012SEN'.padEnd(29, '<') + '4'); // 30
const L3 = 'DUPONT<<MARIE'.padEnd(30, '<'); // 30
assert.equal(L1.length, 30);
assert.equal(L2.length, 30);
assert.equal(L3.length, 30);

let n = 0;
const check = (label, fn) => { fn(); n += 1; console.log('ok  ' + label); };

check('bloc complet: aucune reparation proposee', () => {
  assert.deepEqual(td1RepairCandidates([L1, L2, L3].join('\n')), []);
});
check('ligne des noms trop courte d un caractere: completee par un filler final', () => {
  const c = td1RepairCandidates([L1, L2, L3.slice(0, 29)].join('\n'));
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], [L1, L2, L3]);
});
check('ligne 2 trop courte: candidats = un filler insere au bord de chaque serie, tous de 30 caracteres', () => {
  const short = L2.slice(0, 20) + L2.slice(21); // perd un '<'
  const c = td1RepairCandidates([L1, short, L3].join('\n'));
  assert.ok(c.length >= 1);
  assert.ok(c.every((t) => t.every((l) => l.length === 30)));
  assert.ok(c.some((t) => t[1] === L2), 'la ligne d origine fait partie des candidats');
});
check('une ligne trop courte de 2 caracteres n est pas reparee', () => {
  assert.deepEqual(td1RepairCandidates([L1, L2, L3.slice(0, 28)].join('\n')), []);
});
check('texte sans MRZ: rien', () => {
  assert.deepEqual(td1RepairCandidates('REPUBLIQUE DU SENEGAL\nCARTE NATIONALE'), []);
  assert.deepEqual(td1RepairCandidates(''), []);
});
check('le nombre de candidats est borne', () => {
  const noisy = 'IDSEN'.padEnd(29, '<');
  assert.ok(td1RepairCandidates([noisy, L2.slice(0, 29), L3.slice(0, 29)].join('\n')).length <= 24);
});
console.log(`\ntout est bon (${n} verifications)`);
