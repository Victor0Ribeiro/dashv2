'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'dashv2_sid';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

function parseCookies(header = '') {
    const cookies = {};
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
    }
    return cookies;
}

/** Comparação em tempo constante (evita descobrir a senha medindo o tempo de resposta). */
function safeEqual(a, b) {
    const digest = value => crypto.createHash('sha256').update(String(value ?? '')).digest();
    return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * Sessões em memória: suficientes para um único processo de demonstração.
 * Reiniciar o servidor desloga todo mundo.
 */
function createAuth({ user, pass }) {
    const sessions = new Map(); // token -> expiração (ms)
    const failures = new Map(); // ip -> { count, since }

    function pruneSessions(now) {
        for (const [token, expires] of sessions) {
            if (expires <= now) sessions.delete(token);
        }
    }

    function currentToken(req) {
        const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
        if (!token) return null;
        const expires = sessions.get(token);
        if (!expires) return null;
        if (expires <= Date.now()) {
            sessions.delete(token);
            return null;
        }
        return token;
    }

    return {
        checkCredentials(usuario, senha) {
            // Tolerante a erros comuns de digitação: usuário sem diferenciar maiúsculas e
            // espaços nas pontas (ex.: ao copiar e colar a senha).
            const normalizeUser = value => String(value ?? '').trim().toLowerCase();
            const userOk = safeEqual(normalizeUser(usuario), normalizeUser(user));
            const passOk = safeEqual(String(senha ?? '').trim(), String(pass).trim());
            return userOk && passOk;
        },

        isLocked(ip) {
            const entry = failures.get(ip);
            if (!entry) return false;
            if (Date.now() - entry.since > LOCK_WINDOW_MS) {
                failures.delete(ip);
                return false;
            }
            return entry.count >= MAX_FAILURES;
        },

        recordFailure(ip) {
            const now = Date.now();
            const entry = failures.get(ip);
            if (!entry || now - entry.since > LOCK_WINDOW_MS) failures.set(ip, { count: 1, since: now });
            else entry.count += 1;
        },

        clearFailures(ip) {
            failures.delete(ip);
        },

        startSession(req, res) {
            const now = Date.now();
            pruneSessions(now);
            const token = crypto.randomBytes(32).toString('base64url');
            sessions.set(token, now + SESSION_TTL_MS);
            res.cookie(COOKIE_NAME, token, {
                httpOnly: true,
                sameSite: 'lax',
                secure: req.secure,
                maxAge: SESSION_TTL_MS,
                path: '/',
            });
        },

        endSession(req, res) {
            const token = currentToken(req);
            if (token) sessions.delete(token);
            res.clearCookie(COOKIE_NAME, { path: '/' });
        },

        isAuthenticated: req => currentToken(req) !== null,

        requirePage(req, res, next) {
            if (currentToken(req)) return next();
            res.redirect('/login');
        },

        requireApi(req, res, next) {
            if (currentToken(req)) return next();
            res.status(401).json({ ok: false, error: 'Sessão expirada. Faça login novamente.' });
        },
    };
}

module.exports = { createAuth };
