// Utilitários de interface compartilhados pelas páginas.
// Todo conteúdo dinâmico é inserido como texto (nunca via innerHTML) para evitar XSS.

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
    radar: ['M12 2 21.5 8.9 17.9 20H6.1L2.5 8.9Z', 'M12 7 16.8 10.5 15 16H9l-1.8-5.5Z', 'M12 2v5', 'M21.5 8.9l-4.7 1.6'],
    chart: ['M3 3v18h18', 'm7 15 4-5 4 3 5-7'],
    users: [
        'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
        'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
        'M22 21v-2a4 4 0 0 0-3-3.87',
        'M16 3.13a4 4 0 0 1 0 7.75',
    ],
    star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
    plus: ['M12 5v14', 'M5 12h14'],
    edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
    trash: [
        'M3 6h18',
        'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
        'M10 11v6',
        'M14 11v6',
        'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    ],
    check: ['M20 6 9 17l-5-5'],
    x: ['M18 6 6 18', 'm6 6 12 12'],
};

export function icon(name, size = 18) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attrs = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false',
    };
    for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, String(value));
    for (const d of ICONS[name] ?? []) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}

/**
 * Cria um elemento. Props especiais: class, text, dataset, style (custom properties),
 * on<Evento> (listeners). Valores false/null/undefined são ignorados.
 */
export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(value));
    }
    el.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
    return el;
}

// ---------- Layout ----------

const NAV_ITEMS = [
    { key: 'dashboard', href: '/dashboard', label: 'Comparação', icon: 'chart' },
    { key: 'colaboradores', href: '/colaboradores', label: 'Colaboradores', icon: 'users' },
    { key: 'habilidades', href: '/habilidades', label: 'Habilidades', icon: 'star' },
];

export function brand() {
    return h(
        'a',
        { class: 'brand', href: '/dashboard' },
        h('span', { class: 'brand-mark' }, icon('radar', 18)),
        h('span', { class: 'brand-text' }, 'Radar de Talentos')
    );
}

export function renderShell(activeKey) {
    const sidebar = document.getElementById('sidebar');
    sidebar.replaceChildren(
        brand(),
        h(
            'ul',
            { class: 'nav' },
            NAV_ITEMS.map(item =>
                h(
                    'li',
                    {},
                    h(
                        'a',
                        {
                            class: 'nav-link',
                            href: item.href,
                            'aria-current': item.key === activeKey ? 'page' : null,
                            title: item.label,
                        },
                        icon(item.icon),
                        h('span', { class: 'nav-label' }, item.label)
                    )
                )
            )
        ),
        h(
            'form',
            { class: 'sidebar-footer', method: 'post', action: '/logout' },
            h(
                'button',
                { type: 'submit', class: 'nav-link', title: 'Sair' },
                icon('logout'),
                h('span', { class: 'nav-label' }, 'Sair')
            )
        )
    );
}

// ---------- Feedback ----------

export function toast(message, type = 'info') {
    let host = document.getElementById('toasts');
    if (!host) {
        host = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
        document.body.append(host);
    }
    const item = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
    host.append(item);
    setTimeout(() => {
        item.classList.add('is-leaving');
        setTimeout(() => item.remove(), 200);
    }, type === 'error' ? 6000 : 3500);
}

/** Diálogo de confirmação acessível. Resolve true se o usuário confirmar. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
    return new Promise(resolve => {
        let confirmed = false;
        const cancelButton = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Cancelar');
        const confirmButton = h(
            'button',
            { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` },
            confirmLabel
        );
        const dialog = h(
            'dialog',
            { class: 'modal modal-sm', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-text' },
            h(
                'div',
                { class: 'modal-body' },
                h('h2', { class: 'modal-title', id: 'confirm-title' }, title),
                h('p', { class: 'modal-text', id: 'confirm-text' }, message)
            ),
            h('div', { class: 'modal-footer' }, cancelButton, confirmButton)
        );

        cancelButton.addEventListener('click', () => dialog.close());
        confirmButton.addEventListener('click', () => {
            confirmed = true;
            dialog.close();
        });
        dialog.addEventListener('close', () => {
            dialog.remove();
            resolve(confirmed);
        });

        document.body.append(dialog);
        dialog.showModal();
        cancelButton.focus();
    });
}

/** Desabilita um botão enquanto uma ação assíncrona roda. */
export async function withBusy(button, task) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
        return await task();
    } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
}

// ---------- Dados ----------

export function average(employee, skills) {
    const values = skills.map(skill => employee.notas[skill]).filter(value => typeof value === 'number');
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function formatScore(value) {
    return typeof value === 'number' ? numberFormat.format(value) : '–';
}

export function scoreLevel(value) {
    if (typeof value !== 'number') return 'none';
    if (value >= 8) return 'high';
    if (value >= 5) return 'mid';
    return 'low';
}

export function scoreBadge(value, extraClass = '') {
    return h(
        'span',
        {
            class: `score ${extraClass}`.trim(),
            dataset: { level: scoreLevel(value) },
            title: typeof value === 'number' ? null : 'Não avaliado',
        },
        formatScore(value)
    );
}

export function initials(name) {
    const parts = name.split(' ').filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
    return letters.toUpperCase();
}

export function normalize(text) {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function byName(a, b) {
    return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
}

export function pluralize(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}
