'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { createApp } = require('../server');

const USER = 'tester';
const PASS = 'segredo';

async function start(dataFile) {
    const app = createApp({ dataFile, user: USER, pass: PASS });
    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function stop(ctx) {
    return new Promise(resolve => ctx.server.close(resolve));
}

function postLogin(base, usuario, senha) {
    return fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ usuario, senha }),
        redirect: 'manual',
    });
}

async function login(base) {
    const res = await postLogin(base, USER, PASS);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/dashboard');
    return res.headers.get('set-cookie').split(';')[0];
}

function client(base, cookie) {
    return async (method, url, body) => {
        const res = await fetch(base + url, {
            method,
            headers: { Cookie: cookie, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            redirect: 'manual',
        });
        const data = res.status === 204 ? null : await res.json();
        return { status: res.status, data };
    };
}

const notas = (area, paciencia, versatilidade, comunicacao) => ({
    Área: area,
    Paciência: paciencia,
    Versatilidade: versatilidade,
    Comunicação: comunicacao,
});

describe('API', () => {
    let dir;
    let dataFile;
    let ctx;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashv2-'));
        dataFile = path.join(dir, 'funcionarios.xlsx');
        ctx = await start(dataFile);
    });

    afterEach(async () => {
        await stop(ctx);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('páginas e API exigem login', async () => {
        const page = await fetch(`${ctx.base}/dashboard`, { redirect: 'manual' });
        assert.equal(page.status, 302);
        assert.equal(page.headers.get('location'), '/login');

        const api = await fetch(`${ctx.base}/api/state`);
        assert.equal(api.status, 401);
        assert.equal((await api.json()).ok, false);
    });

    test('URLs antigas redirecionam para as novas', async () => {
        const res = await fetch(`${ctx.base}/views/manage.html`, { redirect: 'manual' });
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/colaboradores');
    });

    test('credenciais inválidas não criam sessão', async () => {
        const res = await postLogin(ctx.base, USER, 'errada');
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/login?erro=credenciais');
        assert.equal(res.headers.get('set-cookie'), null);
    });

    test('login aceita usuário em qualquer caixa e ignora espaços nas pontas', async () => {
        const res = await postLogin(ctx.base, `  ${USER.toUpperCase()} `, ` ${PASS}  `);
        assert.equal(res.headers.get('location'), '/dashboard');
        const wrongCase = await postLogin(ctx.base, USER, PASS.toUpperCase());
        assert.equal(wrongCase.headers.get('location'), '/login?erro=credenciais');
    });

    test('bloqueia após várias tentativas erradas', async () => {
        for (let i = 0; i < 5; i++) await postLogin(ctx.base, USER, 'errada');
        const res = await postLogin(ctx.base, USER, PASS);
        assert.equal(res.headers.get('location'), '/login?erro=bloqueado');
    });

    test('logout invalida a sessão', async () => {
        const cookie = await login(ctx.base);
        await fetch(`${ctx.base}/logout`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
        const res = await fetch(`${ctx.base}/api/state`, { headers: { Cookie: cookie } });
        assert.equal(res.status, 401);
    });

    test('CRUD de colaboradores persiste na planilha', async () => {
        const call = client(ctx.base, await login(ctx.base));

        const initial = await call('GET', '/api/state');
        assert.deepEqual(initial.data, {
            skills: ['Área', 'Paciência', 'Versatilidade', 'Comunicação'],
            setores: [],
            employees: [],
        });

        const created = await call('POST', '/api/employees', {
            nome: '  Ana   Souza ',
            cracha: ' A-001 ',
            notas: notas(8, 7, 6, 9),
        });
        assert.equal(created.status, 201);
        assert.equal(created.data.nome, 'Ana Souza');
        assert.equal(created.data.cracha, 'A-001');
        assert.equal(created.data.setorId, null);
        assert.match(created.data.id, /^func_/);

        const updated = await call('PUT', `/api/employees/${created.data.id}`, {
            nome: 'Ana S.',
            cracha: 'A-001',
            notas: notas(10, 7, 6, 9),
        });
        assert.equal(updated.status, 200);
        assert.equal(updated.data.notas['Área'], 10);

        // Uma nova instância lendo o mesmo arquivo enxerga os dados gravados.
        const other = await start(dataFile);
        try {
            const state = await client(other.base, await login(other.base))('GET', '/api/state');
            assert.equal(state.data.employees.length, 1);
            assert.deepEqual(state.data.employees[0], updated.data);
        } finally {
            await stop(other);
        }

        const removed = await call('DELETE', `/api/employees/${created.data.id}`);
        assert.equal(removed.status, 204);
        assert.equal((await call('GET', '/api/state')).data.employees.length, 0);
    });

    test('valida os dados do colaborador', async () => {
        const cookie = await login(ctx.base);
        const call = client(ctx.base, cookie);

        const noName = await call('POST', '/api/employees', { nome: ' ', notas: notas(1, 1, 1, 1) });
        assert.equal(noName.status, 400);
        assert.match(noName.data.error, /nome/);

        const outOfRange = await call('POST', '/api/employees', {
            nome: 'Bia',
            cracha: 'B1',
            notas: notas(11, 1, 1, 1),
        });
        assert.equal(outOfRange.status, 400);
        assert.match(outOfRange.data.error, /Área/);

        const missing = await call('POST', '/api/employees', { nome: 'Bia', cracha: 'B1', notas: { Área: 5 } });
        assert.equal(missing.status, 400);

        const notFound = await call('PUT', '/api/employees/nao-existe', { nome: 'X', notas: notas(1, 1, 1, 1) });
        assert.equal(notFound.status, 404);

        const res = await fetch(`${ctx.base}/api/employees`, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: '{quebrado',
        });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error, 'JSON inválido.');
    });

    test('adiciona e remove habilidades', async () => {
        const call = client(ctx.base, await login(ctx.base));
        await call('POST', '/api/employees', { nome: 'Caio', cracha: 'C1', notas: notas(5, 5, 5, 5) });

        const added = await call('POST', '/api/skills', { nome: 'Liderança' });
        assert.equal(added.status, 201);

        let state = (await call('GET', '/api/state')).data;
        assert.ok(state.skills.includes('Liderança'));
        assert.equal(state.employees[0].notas['Liderança'], null);

        assert.equal((await call('POST', '/api/skills', { nome: 'liderança' })).status, 409);
        assert.equal((await call('POST', '/api/skills', { nome: '__proto__' })).status, 400);
        assert.equal((await call('POST', '/api/skills', { nome: '' })).status, 400);

        const removed = await call('DELETE', `/api/skills/${encodeURIComponent('Paciência')}`);
        assert.equal(removed.status, 204);
        state = (await call('GET', '/api/state')).data;
        assert.ok(!state.skills.includes('Paciência'));
        assert.ok(!('Paciência' in state.employees[0].notas));

        for (const skill of ['Área', 'Versatilidade', 'Comunicação']) {
            await call('DELETE', `/api/skills/${encodeURIComponent(skill)}`);
        }
        const last = await call('DELETE', `/api/skills/${encodeURIComponent('Liderança')}`);
        assert.equal(last.status, 400);
    });

    test('habilidade com caracteres especiais pode ser removida', async () => {
        const call = client(ctx.base, await login(ctx.base));
        const nome = 'UX/UI & Design?';
        assert.equal((await call('POST', '/api/skills', { nome })).status, 201);
        assert.equal((await call('DELETE', `/api/skills/${encodeURIComponent(nome)}`)).status, 204);
        assert.ok(!(await call('GET', '/api/state')).data.skills.includes(nome));
    });

    test('migra planilha no formato antigo e faz backup', async () => {
        const legacy = path.join(dir, 'legado.xlsx');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Funcionarios');
        sheet.addRow(['ID', 'Nome', 'Área', 'Paciência', 'Versatilidade', 'Comunicação']);
        sheet.addRow(['func1', 'João', 8, 9, 6, 9]);
        await workbook.xlsx.writeFile(legacy);

        const legacyCtx = await start(legacy);
        try {
            const call = client(legacyCtx.base, await login(legacyCtx.base));
            const state = (await call('GET', '/api/state')).data;
            assert.deepEqual(state.skills, ['Área', 'Paciência', 'Versatilidade', 'Comunicação']);
            assert.deepEqual(state.employees, [
                { id: 'func1', nome: 'João', cracha: null, setorId: null, notas: notas(8, 9, 6, 9) },
            ]);

            await call('POST', '/api/skills', { nome: 'Liderança' });
            assert.ok(fs.existsSync(`${legacy}.v1.bak`));

            const migrated = new ExcelJS.Workbook();
            await migrated.xlsx.readFile(legacy);
            assert.ok(migrated.getWorksheet('Habilidades'));
            assert.ok(migrated.getWorksheet('Setores'));
        } finally {
            await stop(legacyCtx);
        }
    });

    test('gravações simultâneas não se perdem', async () => {
        const call = client(ctx.base, await login(ctx.base));
        await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                call('POST', '/api/employees', { nome: `P${i}`, cracha: `P-${i}`, notas: notas(i, i, i, i) })
            )
        );
        assert.equal((await call('GET', '/api/state')).data.employees.length, 8);
    });

    test('crachá é obrigatório em novos cadastros e único', async () => {
        const call = client(ctx.base, await login(ctx.base));

        const noBadge = await call('POST', '/api/employees', { nome: 'Davi', notas: notas(1, 1, 1, 1) });
        assert.equal(noBadge.status, 400);
        assert.match(noBadge.data.error, /crachá/);

        const first = await call('POST', '/api/employees', { nome: 'Davi', cracha: 'x-10', notas: notas(1, 1, 1, 1) });
        assert.equal(first.status, 201);

        const duplicate = await call('POST', '/api/employees', { nome: 'Eva', cracha: 'X-10', notas: notas(1, 1, 1, 1) });
        assert.equal(duplicate.status, 409);
        assert.match(duplicate.data.error, /Davi/);

        // O próprio dono pode reenviar o mesmo crachá; mas não pode apagá-lo.
        const same = await call('PUT', `/api/employees/${first.data.id}`, {
            nome: 'Davi',
            cracha: 'X-10',
            notas: notas(2, 2, 2, 2),
        });
        assert.equal(same.status, 200);
        const cleared = await call('PUT', `/api/employees/${first.data.id}`, { nome: 'Davi', notas: notas(2, 2, 2, 2) });
        assert.equal(cleared.status, 400);
    });

    test('setores: CRUD, líder do próprio setor e remoções em cascata', async () => {
        const call = client(ctx.base, await login(ctx.base));

        const vendas = (await call('POST', '/api/setores', { nome: 'Vendas' })).data;
        assert.match(vendas.id, /^setor_/);
        assert.equal(vendas.liderId, null);
        assert.equal((await call('POST', '/api/setores', { nome: 'vendas' })).status, 409);
        const ti = (await call('POST', '/api/setores', { nome: 'TI' })).data;

        const invalidSector = await call('POST', '/api/employees', {
            nome: 'Fábio',
            cracha: 'F1',
            setorId: 'setor_inexistente',
            notas: notas(5, 5, 5, 5),
        });
        assert.equal(invalidSector.status, 400);

        const fabio = (await call('POST', '/api/employees', {
            nome: 'Fábio',
            cracha: 'F1',
            setorId: vendas.id,
            notas: notas(5, 5, 5, 5),
        })).data;
        const gabi = (await call('POST', '/api/employees', {
            nome: 'Gabi',
            cracha: 'G1',
            setorId: ti.id,
            notas: notas(7, 7, 7, 7),
        })).data;

        // Líder precisa ser do setor.
        const wrongLeader = await call('PUT', `/api/setores/${vendas.id}`, { nome: 'Vendas', liderId: gabi.id });
        assert.equal(wrongLeader.status, 400);
        const leader = await call('PUT', `/api/setores/${vendas.id}`, { nome: 'Vendas B2B', liderId: fabio.id });
        assert.equal(leader.status, 200);
        assert.deepEqual(leader.data, { id: vendas.id, nome: 'Vendas B2B', liderId: fabio.id });

        // Líder que muda de setor perde a liderança.
        await call('PUT', `/api/employees/${fabio.id}`, {
            nome: 'Fábio',
            cracha: 'F1',
            setorId: ti.id,
            notas: notas(5, 5, 5, 5),
        });
        let state = (await call('GET', '/api/state')).data;
        assert.equal(state.setores.find(s => s.id === vendas.id).liderId, null);

        // Líder removido deixa o setor sem líder.
        await call('PUT', `/api/setores/${ti.id}`, { nome: 'TI', liderId: gabi.id });
        await call('DELETE', `/api/employees/${gabi.id}`);
        state = (await call('GET', '/api/state')).data;
        assert.equal(state.setores.find(s => s.id === ti.id).liderId, null);

        // Setor removido: membros ficam sem setor.
        assert.equal((await call('DELETE', `/api/setores/${ti.id}`)).status, 204);
        state = (await call('GET', '/api/state')).data;
        assert.equal(state.employees.find(e => e.id === fabio.id).setorId, null);
        assert.equal((await call('DELETE', `/api/setores/${ti.id}`)).status, 404);
    });

    test('migra planilha do formato 2 (sem setores) mantendo colaboradores sem crachá editáveis', async () => {
        const v2 = path.join(dir, 'v2.xlsx');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Funcionarios');
        sheet.addRow(['ID', 'Nome', 'Área', 'Paciência']);
        sheet.addRow(['func_a', 'Helena', 9, 8]);
        const skills = workbook.addWorksheet('Habilidades');
        skills.addRow(['Habilidade']);
        skills.addRow(['Área']);
        skills.addRow(['Paciência']);
        await workbook.xlsx.writeFile(v2);

        const v2Ctx = await start(v2);
        try {
            const call = client(v2Ctx.base, await login(v2Ctx.base));
            const state = (await call('GET', '/api/state')).data;
            assert.deepEqual(state.setores, []);
            assert.equal(state.employees[0].cracha, null);

            // Colaborador antigo pode ser editado sem crachá.
            const edited = await call('PUT', '/api/employees/func_a', {
                nome: 'Helena',
                notas: { Área: 10, Paciência: 8 },
            });
            assert.equal(edited.status, 200);
            assert.ok(fs.existsSync(`${v2}.v2.bak`));
        } finally {
            await stop(v2Ctx);
        }
    });
});
