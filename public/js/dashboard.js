import { api } from './api.js';
import { average, ledSector, mean, sectorScore, teamScore } from './metrics.js';
import { exportReport, reportFilename } from './pdf.js';
import {
    h,
    icon,
    renderShell,
    toast,
    withBusy,
    formatScore,
    scoreBadge,
    initials,
    normalize,
    byName,
    pluralize,
    sectorOptions,
    matchesSector,
    ALL_SECTORS,
    NO_SECTOR,
} from './ui.js';

renderShell('dashboard');

const SERIES = {
    dark: ['#a78bfa', '#2dd4bf', '#fbbf24', '#f472b6', '#38bdf8', '#a3e635'],
    light: ['#7c3aed', '#0d9488', '#d97706', '#db2777', '#0284c7', '#65a30d'],
};
const MAX_SELECTED = SERIES.dark.length;

// Cores fixas para impressão (PDF sempre com fundo branco, independente do tema da tela).
const PRINT_THEME = {
    grid: 'rgba(28, 23, 38, 0.14)',
    label: '#1c1726',
    tick: '#7a7390',
    font: 'Helvetica, Arial, sans-serif',
    palette: SERIES.light,
};

const MODES = {
    pessoas: { title: 'Radar de habilidades', listTitle: 'Colaboradores', search: 'Buscar por nome ou crachá' },
    setores: { title: 'Radar por setor', listTitle: 'Setores', search: 'Buscar setor' },
};

const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const els = {
    statEmployees: document.getElementById('stat-employees'),
    statSectors: document.getElementById('stat-sectors'),
    statSkills: document.getElementById('stat-skills'),
    statAverage: document.getElementById('stat-average'),
    modeButtons: document.querySelectorAll('[data-mode]'),
    listTitle: document.getElementById('list-title'),
    sectorFilter: document.getElementById('sector-filter'),
    search: document.getElementById('employee-search'),
    list: document.getElementById('employee-list'),
    selectSector: document.getElementById('select-sector'),
    clear: document.getElementById('clear-selection'),
    count: document.getElementById('selection-count'),
    chartTitle: document.getElementById('chart-title'),
    canvas: document.getElementById('radar-chart'),
    chartEmpty: document.getElementById('chart-empty'),
    showTeamsWrap: document.getElementById('show-teams-wrap'),
    showTeams: document.getElementById('show-teams'),
    exportButton: document.getElementById('export-pdf'),
    tableHead: document.querySelector('#compare-table thead'),
    tableBody: document.querySelector('#compare-table tbody'),
    tableWrap: document.getElementById('compare-table-wrap'),
    tableEmpty: document.getElementById('table-empty'),
    tableNote: document.getElementById('table-note'),
};

const state = {
    skills: [],
    sectors: [],
    employees: [],
    mode: 'pessoas',
    sectorFilter: ALL_SECTORS,
    query: '',
    // Seleção por modo: id -> índice da cor (estável enquanto selecionado)
    selected: { pessoas: new Map(), setores: new Map() },
    showTeams: true,
};

let chart = null;

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const selection = () => state.selected[state.mode];
const sectorById = id => state.sectors.find(sector => sector.id === id) ?? null;
const byNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });

function screenTheme() {
    return {
        grid: cssVar('--chart-grid'),
        label: cssVar('--chart-label'),
        tick: cssVar('--chart-tick'),
        font: cssVar('--font'),
        palette: lightQuery.matches ? SERIES.light : SERIES.dark,
    };
}

// ---------- Itens comparáveis (pessoa ou setor) ----------

function personItem(emp) {
    const led = ledSector(emp, state.sectors);
    return {
        id: emp.id,
        nome: emp.nome,
        notas: emp.notas,
        media: average(emp, state.skills),
        cracha: emp.cracha,
        setor: sectorById(emp.setorId)?.nome ?? null,
        led,
        team: led ? teamScore(led, state.employees, state.skills) : null,
    };
}

function sectorItem(sector) {
    const scores = sectorScore(sector, state.employees, state.skills);
    return {
        id: sector.id,
        nome: sector.nome,
        notas: scores.notas,
        media: scores.media,
        membros: scores.membros,
        leader: state.employees.find(emp => emp.id === sector.liderId) ?? null,
    };
}

function listItems() {
    const query = normalize(state.query.trim());
    if (state.mode === 'setores') {
        return [...state.sectors].sort(byNome).filter(s => normalize(s.nome).includes(query)).map(sectorItem);
    }
    return state.employees
        .filter(
            emp =>
                matchesSector(emp, state.sectorFilter) &&
                (normalize(emp.nome).includes(query) || normalize(emp.cracha ?? '').includes(query))
        )
        .map(personItem);
}

function selectedItems() {
    return [...selection().keys()]
        .map(id => {
            if (state.mode === 'setores') {
                const sector = sectorById(id);
                return sector && sectorItem(sector);
            }
            const emp = state.employees.find(e => e.id === id);
            return emp && personItem(emp);
        })
        .filter(Boolean);
}

function nextFreeColor() {
    const used = new Set(selection().values());
    for (let i = 0; i < MAX_SELECTED; i++) if (!used.has(i)) return i;
    return -1;
}

function toggle(id) {
    const selected = selection();
    if (selected.has(id)) {
        selected.delete(id);
    } else {
        if (selected.size >= MAX_SELECTED) {
            toast(`Compare até ${MAX_SELECTED} itens por vez.`, 'warning');
            return;
        }
        selected.set(id, nextFreeColor());
    }
    renderList();
    renderComparison();
}

/** Seleciona todos os colaboradores do setor filtrado (até o limite). */
function selectFilteredSector() {
    const items = listItems();
    const selected = selection();
    selected.clear();
    items.slice(0, MAX_SELECTED).forEach((item, index) => selected.set(item.id, index));
    if (items.length > MAX_SELECTED) {
        toast(`O filtro tem ${items.length} pessoas; comparando as ${MAX_SELECTED} primeiras.`, 'warning');
    }
    renderList();
    renderComparison();
}

// ---------- Gráfico ----------

function chartOptions(theme, { legend = false, screen = true } = {}) {
    const compact = context => screen && context.chart.width < 480;
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion.matches ? false : { duration: 350 },
        layout: { padding: context => (compact(context) ? 0 : 8) },
        scales: {
            r: {
                min: 0,
                max: 10,
                ticks: { stepSize: 2, color: theme.tick, backdropColor: 'transparent', font: { size: 10 } },
                grid: { color: theme.grid },
                angleLines: { color: theme.grid },
                pointLabels: {
                    color: theme.label,
                    padding: 6,
                    // Em telas estreitas os rótulos longos encolhem o radar; abrevia (nome completo na tabela).
                    callback: label =>
                        screen && els.canvas.clientWidth < 480 && label.length > 8 ? `${label.slice(0, 6)}.` : label,
                    font: context => ({ size: compact(context) ? 11 : 13, weight: '600', family: theme.font }),
                },
            },
        },
        plugins: {
            legend: {
                display: legend,
                position: 'bottom',
                labels: { color: theme.label, usePointStyle: true, padding: 16, font: { family: theme.font } },
            },
            tooltip: { callbacks: { label: item => ` ${item.dataset.label}: ${formatScore(item.raw)}` } },
        },
    };
}

function datasets(items, theme) {
    return items.flatMap(item => {
        const color = theme.palette[selection().get(item.id)];
        const main = {
            label: item.nome,
            data: state.skills.map(skill => item.notas[skill]),
            borderColor: color,
            backgroundColor: `${color}26`, // ~15% de opacidade
            pointBackgroundColor: color,
            pointBorderColor: color,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
        };
        // Líder: a nota do time aparece como linha tracejada da mesma cor.
        if (state.mode !== 'pessoas' || !state.showTeams || !item.team?.membros) return [main];
        return [
            main,
            {
                label: `Time de ${item.led.nome} (líder: ${item.nome})`,
                data: state.skills.map(skill => item.team.notas[skill]),
                borderColor: color,
                backgroundColor: 'transparent',
                pointBackgroundColor: color,
                borderDash: [6, 4],
                borderWidth: 1.5,
                pointRadius: 2,
            },
        ];
    });
}

function chartConfig(items, theme, options) {
    return {
        type: 'radar',
        data: { labels: [...state.skills], datasets: datasets(items, theme) },
        options: chartOptions(theme, options),
    };
}

function renderChart(items) {
    if (typeof window.Chart === 'undefined') {
        els.chartEmpty.hidden = false;
        els.chartEmpty.replaceChildren(h('p', {}, 'Não foi possível carregar o gráfico.'));
        return;
    }
    els.chartEmpty.hidden = items.length > 0;
    const config = chartConfig(items, screenTheme());
    if (chart) {
        chart.data = config.data;
        chart.update();
    } else {
        chart = new window.Chart(els.canvas, config);
    }
}

// ---------- Tabela (tela e PDF usam as mesmas colunas) ----------

function tableColumns(items) {
    const scoreColumns = state.skills.map(skill => ({ label: skill, score: true, value: item => item.notas[skill] }));
    if (state.mode === 'setores') {
        return [
            { label: 'Líder', value: item => item.leader?.nome ?? 'Sem líder' },
            { label: 'Membros', value: item => String(item.membros) },
            ...scoreColumns,
            { label: 'Média', score: true, value: item => item.media },
        ];
    }
    const columns = [{ label: 'Setor', value: item => item.setor ?? 'Sem setor' }, ...scoreColumns];
    columns.push({ label: 'Média', score: true, value: item => item.media });
    if (items.some(item => item.led)) {
        columns.push({ label: 'Nota do time', score: true, value: item => (item.led ? item.team.media : null) });
    }
    return columns;
}

const firstColumnLabel = () => (state.mode === 'setores' ? 'Setor' : 'Colaborador');
const rowLabel = item => (item.led ? `${item.nome} (líder de ${item.led.nome})` : item.nome);

function renderTable(items) {
    const hasSelection = items.length > 0;
    els.tableWrap.hidden = !hasSelection;
    els.tableEmpty.hidden = hasSelection;
    els.tableNote.hidden = !items.some(item => item.led);
    if (!hasSelection) return;

    const columns = tableColumns(items);

    // Destaca o melhor valor de cada coluna de nota quando há mais de um item.
    const best = new Map();
    if (items.length > 1) {
        columns
            .filter(column => column.score)
            .forEach(column => {
                const values = items.map(column.value).filter(v => typeof v === 'number');
                if (values.length) best.set(column, Math.max(...values));
            });
    }

    const palette = screenTheme().palette;
    els.tableHead.replaceChildren(
        h(
            'tr',
            {},
            h('th', { scope: 'col' }, firstColumnLabel()),
            columns.map(column => h('th', { scope: 'col' }, column.label))
        )
    );
    els.tableBody.replaceChildren(
        ...items.map(item =>
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
                            style: { '--series': palette[selection().get(item.id)] },
                            'aria-hidden': 'true',
                        }),
                        h(
                            'span',
                            {},
                            item.nome,
                            item.cracha ? h('span', { class: 'person-sub' }, `Crachá ${item.cracha}`) : null
                        ),
                        item.led
                            ? h(
                                  'span',
                                  { class: 'tag tag-leader', title: `Líder de ${item.led.nome}` },
                                  icon('crown', 12),
                                  'Líder'
                              )
                            : null
                    )
                ),
                columns.map(column => {
                    const value = column.value(item);
                    if (!column.score) return h('td', {}, value);
                    const isBest = best.has(column) && value === best.get(column);
                    return h('td', {}, scoreBadge(value, isBest ? 'is-best' : ''));
                })
            )
        )
    );
}

// ---------- Lista lateral ----------

function chip(item, palette) {
    const colorIndex = selection().get(item.id);
    const selected = colorIndex !== undefined;
    const isSector = state.mode === 'setores';
    const sub = isSector
        ? `${pluralize(item.membros, 'membro', 'membros')} · ${item.leader ? `líder ${item.leader.nome}` : 'sem líder'}`
        : [item.cracha, item.setor ?? 'sem setor'].filter(Boolean).join(' · ');

    return h(
        'li',
        {},
        h(
            'button',
            {
                type: 'button',
                class: 'chip',
                'aria-pressed': String(selected),
                style: selected ? { '--series': palette[colorIndex] } : null,
                onClick: () => toggle(item.id),
            },
            h('span', { class: 'avatar', 'aria-hidden': 'true' }, isSector ? icon('building', 14) : initials(item.nome)),
            h(
                'span',
                { class: 'chip-body' },
                h(
                    'span',
                    { class: 'chip-name' },
                    item.nome,
                    item.led
                        ? h(
                              'span',
                              { class: 'tag tag-leader', title: `Líder de ${item.led.nome}` },
                              icon('crown', 11),
                              h('span', { class: 'sr-only' }, 'líder')
                          )
                        : null
                ),
                h('span', { class: 'chip-sub' }, sub)
            ),
            h('span', { class: 'chip-meta', 'aria-label': `média ${formatScore(item.media)}` }, formatScore(item.media)),
            h('span', { class: 'chip-check', 'aria-hidden': 'true' }, icon('check', 14))
        )
    );
}

function renderList() {
    const isSector = state.mode === 'setores';
    if (isSector && state.sectors.length === 0) {
        els.list.replaceChildren(
            h('li', { class: 'empty' }, 'Nenhum setor cadastrado. ', h('a', { href: '/setores' }, 'Criar setores'))
        );
        return;
    }
    if (!isSector && state.employees.length === 0) {
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
    const items = listItems();
    const palette = screenTheme().palette;
    els.list.replaceChildren(
        ...(items.length
            ? items.map(item => chip(item, palette))
            : [h('li', { class: 'empty' }, 'Nenhum resultado com esses filtros.')])
    );
}

// ---------- Render geral ----------

function renderStats() {
    const allScores = state.employees.flatMap(emp => state.skills.map(skill => emp.notas[skill]));
    els.statEmployees.textContent = String(state.employees.length);
    els.statSectors.textContent = String(state.sectors.length);
    els.statSkills.textContent = String(state.skills.length);
    els.statAverage.textContent = formatScore(mean(allScores));
}

function renderControls() {
    const mode = MODES[state.mode];
    const isPeople = state.mode === 'pessoas';
    els.modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
    els.listTitle.textContent = mode.listTitle;
    els.chartTitle.textContent = mode.title;
    els.search.placeholder = mode.search;
    els.sectorFilter.hidden = !isPeople;
    els.selectSector.hidden = !isPeople;
    els.selectSector.disabled = state.sectorFilter === ALL_SECTORS;
    els.showTeamsWrap.hidden = !isPeople;
}

function renderComparison() {
    const items = selectedItems();
    els.count.textContent = pluralize(items.length, 'selecionado', 'selecionados');
    els.clear.disabled = items.length === 0;
    els.exportButton.disabled = items.length === 0 || typeof window.Chart === 'undefined';
    renderChart(items);
    renderTable(items);
}

function renderAll() {
    renderStats();
    renderControls();
    renderList();
    renderComparison();
}

// ---------- Exportação ----------

function filterDescription() {
    if (state.sectorFilter === ALL_SECTORS) return 'todos os setores';
    if (state.sectorFilter === NO_SECTOR) return 'sem setor';
    return sectorById(state.sectorFilter)?.nome ?? 'todos os setores';
}

async function exportPdf() {
    const items = selectedItems();
    if (items.length === 0) return;

    await withBusy(els.exportButton, async () => {
        try {
            const isPeople = state.mode === 'pessoas';
            const title = isPeople ? 'Comparação de colaboradores' : 'Comparação de setores';
            const columns = tableColumns(items);
            const hasLeaders = items.some(item => item.led);
            const details = [
                isPeople
                    ? `Filtro de setor: ${filterDescription()}`
                    : 'Médias de todos os membros de cada setor (líder incluído)',
                `${pluralize(items.length, 'item comparado', 'itens comparados')}: ${items.map(item => item.nome).join(', ')}`,
            ];
            if (hasLeaders && state.showTeams) details.push('Linhas tracejadas: nota do time de cada líder.');

            await exportReport({
                title,
                details,
                chart: chartConfig(items, PRINT_THEME, { legend: true, screen: false }),
                table: {
                    head: [firstColumnLabel(), ...columns.map(column => column.label)],
                    body: items.map(item => [
                        rowLabel(item),
                        ...columns.map(column => {
                            const value = column.value(item);
                            return column.score ? formatScore(value) : value;
                        }),
                    ]),
                },
                note: hasLeaders
                    ? 'Nota do time: média das notas dos liderados do setor (o líder não entra no cálculo).'
                    : undefined,
                filename: reportFilename(title),
            });
            toast('PDF gerado.', 'success');
        } catch (err) {
            console.error(err);
            toast(err.message || 'Não foi possível gerar o PDF.', 'error');
        }
    });
}

// ---------- Eventos ----------

els.modeButtons.forEach(button =>
    button.addEventListener('click', () => {
        if (state.mode === button.dataset.mode) return;
        state.mode = button.dataset.mode;
        state.query = '';
        els.search.value = '';
        renderControls();
        renderList();
        renderComparison();
    })
);

els.sectorFilter.addEventListener('change', () => {
    state.sectorFilter = els.sectorFilter.value;
    renderControls();
    renderList();
});

els.search.addEventListener('input', () => {
    state.query = els.search.value;
    renderList();
});

els.selectSector.addEventListener('click', selectFilteredSector);

els.clear.addEventListener('click', () => {
    selection().clear();
    renderList();
    renderComparison();
});

els.showTeams.addEventListener('change', () => {
    state.showTeams = els.showTeams.checked;
    renderComparison();
});

els.exportButton.addEventListener('click', exportPdf);

lightQuery.addEventListener('change', () => {
    if (chart) chart.options = chartOptions(screenTheme());
    renderAll();
});

// ---------- Início ----------

try {
    const data = await api.getState();
    state.skills = data.skills;
    state.sectors = data.setores;
    state.employees = [...data.employees].sort(byName);
    els.sectorFilter.replaceChildren(
        ...sectorOptions(state.sectors, { all: true, none: true, selected: ALL_SECTORS })
    );
    renderAll();
} catch (err) {
    els.list.replaceChildren(h('li', { class: 'empty' }, 'Não foi possível carregar os dados.'));
    toast(err.message, 'error');
}
