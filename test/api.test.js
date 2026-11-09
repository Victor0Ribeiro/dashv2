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
            employees: [],
        });

        const created = await call('POST', '/api/employees', { nome: '  Ana   Souza ', notas: notas(8, 7, 6, 9) });
        assert.equal(created.status, 201);
        assert.equal(created.data.nome, 'Ana Souza');
        assert.match(created.data.id, /^func_/);

        const updated = await call('PUT', `/api/employees/${created.data.id}`, {
            nome: 'Ana S.',
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

        const outOfRange = await call('POST', '/api/employees', { nome: 'Bia', notas: notas(11, 1, 1, 1) });
        assert.equal(outOfRange.status, 400);
        assert.match(outOfRange.data.error, /Área/);

        const missing = await call('POST', '/api/employees', { nome: 'Bia', notas: { Área: 5 } });
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
        await call('POST', '/api/employees', { nome: 'Caio', notas: notas(5, 5, 5, 5) });

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
            assert.deepEqual(state.employees, [{ id: 'func1', nome: 'João', notas: notas(8, 9, 6, 9) }]);

            await call('POST', '/api/skills', { nome: 'Liderança' });
            assert.ok(fs.existsSync(`${legacy}.bak`));

            const migrated = new ExcelJS.Workbook();
            await migrated.xlsx.readFile(legacy);
            assert.ok(migrated.getWorksheet('Habilidades'));
        } finally {
            await stop(legacyCtx);
        }
    });

    test('gravações simultâneas não se perdem', async () => {
        const call = client(ctx.base, await login(ctx.base));
        await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                call('POST', '/api/employees', { nome: `P${i}`, notas: notas(i, i, i, i) })
            )
        );
        assert.equal((await call('GET', '/api/state')).data.employees.length, 8);
    });
});
