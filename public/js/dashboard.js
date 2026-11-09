import { api } from './api.js';
import {
    h,
    icon,
    renderShell,
    toast,
    average,
    formatScore,
    scoreBadge,
    initials,
    normalize,
    byName,
    pluralize,
} from './ui.js';

renderShell('dashboard');

const SERIES = {
    dark: ['#a78bfa', '#2dd4bf', '#fbbf24', '#f472b6', '#38bdf8', '#a3e635'],
    light: ['#7c3aed', '#0d9488', '#d97706', '#db2777', '#0284c7', '#65a30d'],
};
const MAX_SELECTED = SERIES.dark.length;

const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const els = {
    statEmployees: document.getElementById('stat-employees'),
    statSkills: document.getElementById('stat-skills'),
    statAverage: document.getElementById('stat-average'),
    search: document.getElementById('employee-search'),
    list: document.getElementById('employee-list'),
    clear: document.getElementById('clear-selection'),
    count: document.getElementById('selection-count'),
    canvas: document.getElementById('radar-chart'),
    chartEmpty: document.getElementById('chart-empty'),
    tableHead: document.querySelector('#compare-table thead'),
    tableBody: document.querySelector('#compare-table tbody'),
    tableWrap: document.getElementById('compare-table-wrap'),
    tableEmpty: document.getElementById('table-empty'),
};

const state = {
    skills: [],
    employees: [],
    selected: new Map(), // id -> índice da cor (estável enquanto selecionado)
    query: '',
};

let chart = null;

const seriesColor = index => (lightQuery.matches ? SERIES.light : SERIES.dark)[index];
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function selectedEmployees() {
    return [...state.selected.keys()]
        .map(id => state.employees.find(emp => emp.id === id))
        .filter(Boolean);
}

function nextFreeColor() {
    const used = new Set(state.selected.values());
    for (let i = 0; i < MAX_SELECTED; i++) if (!used.has(i)) return i;
    return -1;
}

function toggle(id) {
    if (state.selected.has(id)) {
        state.selected.delete(id);
    } else {
        if (state.selected.size >= MAX_SELECTED) {
            toast(`Compare até ${MAX_SELECTED} colaboradores por vez.`, 'warning');
            return;
        }
        state.selected.set(id, nextFreeColor());
    }
    renderList();
    renderComparison();
}

// ---------- Render ----------

function renderStats() {
    const scores = state.employees.flatMap(emp =>
        state.skills.map(skill => emp.notas[skill]).filter(value => typeof value === 'number')
    );
    const overall = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    els.statEmployees.textContent = String(state.employees.length);
    els.statSkills.textContent = String(state.skills.length);
    els.statAverage.textContent = formatScore(overall);
}

function renderList() {
    if (state.employees.length === 0) {
        els.list.replaceChildren(
            h(
                'li',
                { class: 'empty' },
                'Nenhum colaborador cadastrado. ',
                h('a', { href: '/colaboradores' }, 'Cadastrar agora')
            )
        );
        return;
    }

    const query = normalize(state.query.trim());
    const visible = state.employees.filter(emp => normalize(emp.nome).includes(query));
    if (visible.length === 0) {
        els.list.replaceChildren(h('li', { class: 'empty' }, `Nenhum resultado para "${state.query.trim()}".`));
        return;
    }

    els.list.replaceChildren(
        ...visible.map(emp => {
            const colorIndex = state.selected.get(emp.id);
            const selected = colorIndex !== undefined;
            return h(
                'li',
                {},
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'chip',
                        'aria-pressed': String(selected),
                        style: selected ? { '--series': seriesColor(colorIndex) } : null,
                        onClick: () => toggle(emp.id),
                    },
                    h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(emp.nome)),
                    h('span', { class: 'chip-name' }, emp.nome),
                    h(
                        'span',
                        { class: 'chip-meta', 'aria-label': `média ${formatScore(average(emp, state.skills))}` },
                        formatScore(average(emp, state.skills))
                    ),
                    h('span', { class: 'chip-check', 'aria-hidden': 'true' }, icon('check', 14))
                )
            );
        })
    );
}

function chartOptions() {
    const grid = cssVar('--chart-grid');
    const compact = context => context.chart.width < 480;
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion.matches ? false : { duration: 350 },
        layout: { padding: context => (compact(context) ? 0 : 8) },
        scales: {
            r: {
                min: 0,
                max: 10,
                ticks: {
                    stepSize: 2,
                    color: cssVar('--chart-tick'),
                    backdropColor: 'transparent',
                    font: { size: 10 },
                },
                grid: { color: grid },
                angleLines: { color: grid },
                pointLabels: {
                    color: cssVar('--chart-label'),
                    padding: 6,
                    // Em telas estreitas os rótulos longos encolhem o radar; abrevia (nome completo na tabela).
                    callback: label =>
                        els.canvas.clientWidth < 480 && label.length > 8 ? `${label.slice(0, 6)}.` : label,
                    font: context => ({
                        size: compact(context) ? 11 : 13,
                        weight: '600',
                        family: cssVar('--font'),
                    }),
                },
            },
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: item => ` ${item.dataset.label}: ${formatScore(item.raw)}`,
                },
            },
        },
    };
}

function datasets(employees) {
    return employees.map(emp => {
        const color = seriesColor(state.selected.get(emp.id));
        return {
            label: emp.nome,
            data: state.skills.map(skill => emp.notas[skill]),
            borderColor: color,
            backgroundColor: `${color}26`, // ~15% de opacidade
            pointBackgroundColor: color,
            pointBorderColor: color,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
        };
    });
}

function renderChart(employees) {
    if (typeof window.Chart === 'undefined') {
        els.chartEmpty.hidden = false;
        els.chartEmpty.replaceChildren(h('p', {}, 'Não foi possível carregar o gráfico.'));
        return;
    }
    els.chartEmpty.hidden = employees.length > 0;

    const data = { labels: state.skills, datasets: datasets(employees) };
    if (chart) {
        chart.data = data;
        chart.update();
    } else {
        chart = new window.Chart(els.canvas, { type: 'radar', data, options: chartOptions() });
    }
}

function renderTable(employees) {
    const hasSelection = employees.length > 0;
    els.tableWrap.hidden = !hasSelection;
    els.tableEmpty.hidden = hasSelection;
    if (!hasSelection) return;

    const columns = [...state.skills, 'Média'];
    const valueOf = (emp, column) => (column === 'Média' ? average(emp, state.skills) : emp.notas[column]);

    // Destaca o melhor valor de cada coluna quando há mais de uma pessoa.
    const best = new Map();
    if (employees.length > 1) {
        for (const column of columns) {
            const values = employees.map(emp => valueOf(emp, column)).filter(v => typeof v === 'number');
            if (values.length) best.set(column, Math.max(...values));
        }
    }

    els.tableHead.replaceChildren(
        h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Colaborador'),
            columns.map(column => h('th', { scope: 'col' }, column))
        )
    );
    els.tableBody.replaceChildren(
        ...employees.map(emp =>
            h(
                'tr',
                {},
                h(
                    'th',
                    { scope: 'row' },
                    h(
                        'span',
                        { class: 'person' },
                        h('span', {
                            class: 'series-dot',
                            style: { '--series': seriesColor(state.selected.get(emp.id)) },
                            'aria-hidden': 'true',
                        }),
                        emp.nome
                    )
                ),
                columns.map(column => {
                    const value = valueOf(emp, column);
                    const isBest = best.has(column) && value === best.get(column);
                    return h('td', {}, scoreBadge(value, isBest ? 'is-best' : ''));
                })
            )
        )
    );
}

function renderComparison() {
    const employees = selectedEmployees();
    els.count.textContent = pluralize(employees.length, 'selecionado', 'selecionados');
    els.clear.disabled = employees.length === 0;
    renderChart(employees);
    renderTable(employees);
}

function renderAll() {
    renderStats();
    renderList();
    renderComparison();
}

// ---------- Eventos ----------

els.search.addEventListener('input', () => {
    state.query = els.search.value;
    renderList();
});

els.clear.addEventListener('click', () => {
    state.selected.clear();
    renderList();
    renderComparison();
});

lightQuery.addEventListener('change', () => {
    if (chart) chart.options = chartOptions();
    renderAll();
});

// ---------- Início ----------

try {
    const data = await api.getState();
    state.skills = data.skills;
    state.employees = [...data.employees].sort(byName);
    renderAll();
} catch (err) {
    els.list.replaceChildren(h('li', { class: 'empty' }, 'Não foi possível carregar os colaboradores.'));
    toast(err.message, 'error');
}
