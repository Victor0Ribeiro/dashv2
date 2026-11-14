import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, average, teamScore, sectorScore, ledSector } from '../public/js/metrics.js';

const skills = ['A', 'B'];
const sector = { id: 's1', nome: 'Vendas', liderId: 'lider' };
const employees = [
    { id: 'lider', setorId: 's1', notas: { A: 10, B: 10 } },
    { id: 'm1', setorId: 's1', notas: { A: 6, B: 8 } },
    { id: 'm2', setorId: 's1', notas: { A: 4, B: null } },
    { id: 'fora', setorId: 's2', notas: { A: 0, B: 0 } },
];

test('mean ignora valores não numéricos', () => {
    assert.equal(mean([2, null, 4, undefined]), 3);
    assert.equal(mean([null]), null);
});

test('average usa só as habilidades avaliadas', () => {
    assert.equal(average(employees[2], skills), 4);
});

test('nota do time exclui o líder e quem é de outro setor', () => {
    const team = teamScore(sector, employees, skills);
    assert.equal(team.membros, 2);
    assert.deepEqual(team.notas, { A: 5, B: 8 });
    assert.equal(team.media, (7 + 4) / 2); // média das médias individuais
});

test('nota do setor inclui o líder', () => {
    const scores = sectorScore(sector, employees, skills);
    assert.equal(scores.membros, 3);
    assert.equal(scores.notas.A, (10 + 6 + 4) / 3);
});

test('time sem membros além do líder não tem nota', () => {
    const solo = teamScore(sector, employees.slice(0, 1), skills);
    assert.equal(solo.membros, 0);
    assert.equal(solo.media, null);
});

test('ledSector encontra o setor liderado', () => {
    assert.equal(ledSector(employees[0], [sector]), sector);
    assert.equal(ledSector(employees[1], [sector]), null);
});
