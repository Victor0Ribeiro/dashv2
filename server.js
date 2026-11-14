'use strict';

const path = require('path');
const express = require('express');
const { createStore, HttpError } = require('./lib/store');
const { createAuth } = require('./lib/auth');

const VIEWS_DIR = path.join(__dirname, 'views');

const PAGES = {
    '/dashboard': 'dashboard.html',
    '/colaboradores': 'manage.html',
    '/habilidades': 'skills.html',
    '/setores': 'sectors.html',
};

// Bibliotecas de front-end servidas do node_modules (versões fixadas no package-lock).
const VENDOR = {
    '/vendor/chart.js': ['chart.js', 'dist'],
    '/vendor/jspdf': ['jspdf', 'dist'],
    '/vendor/jspdf-autotable': ['jspdf-autotable', 'dist'],
};

// Endereços antigos continuam funcionando (ex.: links salvos ou o tutorial do portfólio).
const LEGACY_URLS = {
    '/views/login.html': '/login',
    '/views/dashboard.html': '/dashboard',
    '/views/manage.html': '/colaboradores',
    '/views/skills.html': '/habilidades',
};

const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
].join('; ');

function createApp({
    dataFile = process.env.DATA_FILE || path.join(__dirname, 'funcionarios.xlsx'),
    user = process.env.DASH_USER || 'Victor',
    pass = process.env.DASH_PASS || 'Ribeiro',
    trustProxy = process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production',
} = {}) {
    const store = createStore(dataFile);
    const auth = createAuth({ user, pass });
    const app = express();

    app.disable('x-powered-by');
    // Atrás do proxy da hospedagem: IP real (bloqueio de login) e req.secure (cookie "secure").
    if (trustProxy) app.set('trust proxy', 1);
    app.use((req, res, next) => {
        res.set({
            'Content-Security-Policy': CONTENT_SECURITY_POLICY,
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'same-origin',
        });
        next();
    });
    app.use(express.json({ limit: '50kb' }));
    app.use(express.urlencoded({ extended: false, limit: '10kb' }));

    app.use('/public', express.static(path.join(__dirname, 'public')));
    for (const [route, parts] of Object.entries(VENDOR)) {
        app.use(route, express.static(path.join(__dirname, 'node_modules', ...parts)));
    }
    app.get('/healthz', (req, res) => res.type('text').send('ok'));

    for (const [from, to] of Object.entries(LEGACY_URLS)) {
        app.get(from, (req, res) => res.redirect(to));
    }

    // Páginas
    app.get('/', (req, res) => res.redirect(auth.isAuthenticated(req) ? '/dashboard' : '/login'));

    app.get('/login', (req, res) => {
        if (auth.isAuthenticated(req)) return res.redirect('/dashboard');
        res.sendFile(path.join(VIEWS_DIR, 'login.html'));
    });

    app.post('/login', (req, res) => {
        const ip = req.ip;
        if (auth.isLocked(ip)) return res.redirect('/login?erro=bloqueado');

        const { usuario, senha } = req.body ?? {};
        if (!auth.checkCredentials(usuario, senha)) {
            auth.recordFailure(ip);
            return res.redirect('/login?erro=credenciais');
        }

        auth.clearFailures(ip);
        auth.startSession(req, res);
        res.redirect('/dashboard');
    });

    app.post('/logout', (req, res) => {
        auth.endSession(req, res);
        res.redirect('/login');
    });

    for (const [route, file] of Object.entries(PAGES)) {
        app.get(route, auth.requirePage, (req, res) => res.sendFile(path.join(VIEWS_DIR, file)));
    }

    // API (Express 5 encaminha erros de handlers async para o middleware de erro)
    const api = express.Router();
    api.use(auth.requireApi);

    api.get('/state', async (req, res) => {
        res.json(await store.getState());
    });
    api.post('/employees', async (req, res) => {
        res.status(201).json(await store.createEmployee(req.body));
    });
    api.put('/employees/:id', async (req, res) => {
        res.json(await store.updateEmployee(req.params.id, req.body));
    });
    api.delete('/employees/:id', async (req, res) => {
        await store.deleteEmployee(req.params.id);
        res.status(204).end();
    });
    api.post('/skills', async (req, res) => {
        res.status(201).json({ nome: await store.addSkill(req.body?.nome) });
    });
    api.delete('/skills/:nome', async (req, res) => {
        await store.removeSkill(req.params.nome);
        res.status(204).end();
    });
    api.post('/setores', async (req, res) => {
        res.status(201).json(await store.createSector(req.body));
    });
    api.put('/setores/:id', async (req, res) => {
        res.json(await store.updateSector(req.params.id, req.body));
    });
    api.delete('/setores/:id', async (req, res) => {
        await store.deleteSector(req.params.id);
        res.status(204).end();
    });
    api.use((req, res) => res.status(404).json({ ok: false, error: 'Rota não encontrada.' }));

    app.use('/api', api);

    app.use((req, res) => res.status(404).type('text').send('Página não encontrada.'));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        const known = err instanceof HttpError || err.expose === true;
        const status = known && err.status >= 400 && err.status <= 599 ? err.status : 500;
        if (status === 500) console.error(err);

        let message = known ? err.message : 'Erro interno ao processar a requisição.';
        if (err.type === 'entity.parse.failed') message = 'JSON inválido.';

        if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ ok: false, error: message });
        res.status(status).type('text').send(message);
    });

    return app;
}

if (require.main === module) {
    // Em produção não sobe com as credenciais de demonstração (elas estão no repositório).
    if (process.env.NODE_ENV === 'production' && (!process.env.DASH_USER || !process.env.DASH_PASS)) {
        console.error('Defina DASH_USER e DASH_PASS para rodar em produção.');
        process.exit(1);
    }
    const port = Number(process.env.PORT) || 3001;
    createApp().listen(port, () => console.log(`Servidor rodando em http://localhost:${port}`));
}

module.exports = { createApp };
