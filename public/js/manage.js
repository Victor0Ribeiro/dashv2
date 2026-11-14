import { api } from './api.js';
import { ledSector } from './metrics.js';
import {
    h,
    icon,
    renderShell,
    toast,
    confirmDialog,
    withBusy,
    average,
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

renderShell('colaboradores');

const DEFAULT_SCORE = 5;

const els = {
    count: document.getElementById('employee-count'),
    search: document.getElementById('employee-search'),
    sectorFilter: document.getElementById('sector-filter'),
    newButton: document.getElementById('new-employee'),
    tableHead: document.querySelector('#employees-table thead'),
    tableBody: document.querySelector('#employees-table tbody'),
    tableWrap: document.getElementById('employees-table-wrap'),
    empty: document.getElementById('employees-empty'),
    dialog: document.getElementById('employee-dialog'),
    form: document.getElementById('employee-form'),
    dialogTitle: document.getElementById('employee-dialog-title'),
    nameInput: document.getElementById('employee-name'),
    badgeInput: document.getElementById('employee-badge'),
    badgeHint: document.getElementById('employee-badge-hint'),
    sectorSelect: document.getElementById('employee-sector'),
    scores: document.getElementById('employee-scores'),
    submit: document.getElementById('employee-submit'),
    cancel: document.getElementById('employee-cancel'),
    close: document.getElementById('employee-close'),
};

const state = {
    skills: [],
    sectors: [],
    employees: [],
    query: '',
    // Permite links como /colaboradores?setor=<id> (usado pela página de Setores).
    sectorFilter: new URLSearchParams(window.location.search).get('setor') ?? ALL_SECTORS,
    editingId: null,
};

const sectorName = id => state.sectors.find(sector => sector.id === id)?.nome ?? null;

// ---------- Filtros ----------

function renderFilters() {
    const valid =
        state.sectorFilter === ALL_SECTORS ||
        state.sectorFilter === NO_SECTOR ||
        state.sectors.some(sector => sector.id === state.sectorFilter);
    if (!valid) state.sectorFilter = ALL_SECTORS;
    els.sectorFilter.replaceChildren(
        ...sectorOptions(state.sectors, { all: true, none: true, selected: state.sectorFilter })
    );
}

// ---------- Tabela ----------

function renderTable() {
    els.count.textContent = pluralize(state.employees.length, 'colaborador', 'colaboradores');

    const query = normalize(state.query.trim());
    const visible = state.employees.filter(
        emp =>
            matchesSector(emp, state.sectorFilter) &&
            (normalize(emp.nome).includes(query) || normalize(emp.cracha ?? '').includes(query))
    );

    if (visible.length === 0) {
        els.tableWrap.hidden = true;
        els.empty.hidden = false;
        els.empty.textContent =
            state.employees.length === 0
                ? 'Nenhum colaborador cadastrado ainda. Clique em "Novo colaborador" para começar.'
                : 'Nenhum colaborador encontrado com esses filtros.';
        return;
    }
    els.tableWrap.hidden = false;
    els.empty.hidden = true;

    els.tableHead.replaceChildren(
        h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Colaborador'),
            h('th', { scope: 'col' }, 'Crachá'),
            h('th', { scope: 'col' }, 'Setor'),
            state.skills.map(skill => h('th', { scope: 'col' }, skill)),
            h('th', { scope: 'col' }, 'Média'),
            h('th', { scope: 'col', class: 'col-actions' }, h('span', { class: 'sr-only' }, 'Ações'))
        )
    );

    els.tableBody.replaceChildren(
        ...visible.map(emp => {
            const led = ledSector(emp, state.sectors);
            return h(
                'tr',
                {},
                h(
                    'th',
                    { scope: 'row' },
                    h(
                        'span',
                        { class: 'person' },
                        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(emp.nome)),
                        h('span', {}, emp.nome),
                        led &&
                            h(
                                'span',
                                { class: 'tag tag-leader', title: `Líder de ${led.nome}` },
                                icon('crown', 12),
                                'Líder'
                            )
                    )
                ),
                h('td', {}, emp.cracha ?? h('span', { class: 'tag tag-muted' }, 'sem crachá')),
                h('td', {}, sectorName(emp.setorId) ?? h('span', { class: 'tag tag-muted' }, 'sem setor')),
                state.skills.map(skill => h('td', {}, scoreBadge(emp.notas[skill]))),
                h('td', {}, scoreBadge(average(emp, state.skills))),
                h(
                    'td',
                    { class: 'col-actions' },
                    h(
                        'span',
                        { class: 'actions' },
                        h(
                            'button',
                            {
                                type: 'button',
                                class: 'icon-btn',
                                'aria-label': `Editar ${emp.nome}`,
                                title: 'Editar',
                                onClick: () => openDialog(emp),
                            },
                            icon('edit')
                        ),
                        h(
                            'button',
                            {
                                type: 'button',
                                class: 'icon-btn is-danger',
                                'aria-label': `Remover ${emp.nome}`,
                                title: 'Remover',
                                onClick: event => removeEmployee(emp, event.currentTarget),
                            },
                            icon('trash')
                        )
                    )
                )
            );
        })
    );
}

// ---------- Formulário (modal) ----------

function scoreField(skill, score, index) {
    const id = `score-${index}`;
    const unrated = typeof score !== 'number';
    const value = unrated ? DEFAULT_SCORE : score;
    const hint = unrated ? h('span', { class: 'hint' }, ' · ainda não avaliado') : null;
    const output = h('output', { class: 'score-output', for: id }, String(value));
    const input = h('input', {
        type: 'range',
        id,
        min: 0,
        max: 10,
        step: 1,
        value,
        dataset: { skill },
        onInput: event => {
            output.textContent = event.target.value;
            hint?.remove();
        },
    });
    return h('div', { class: 'score-field' }, h('label', { class: 'label', for: id }, skill, hint), output, input);
}

function openDialog(employee = null) {
    state.editingId = employee?.id ?? null;
    els.dialogTitle.textContent = employee ? 'Editar colaborador' : 'Novo colaborador';
    els.submit.textContent = employee ? 'Salvar alterações' : 'Cadastrar';
    els.nameInput.value = employee?.nome ?? '';

    // Crachá obrigatório, exceto para cadastros antigos que ainda não têm um.
    const badgeOptional = Boolean(employee && !employee.cracha);
    els.badgeInput.value = employee?.cracha ?? '';
    els.badgeInput.required = !badgeOptional;
    els.badgeHint.textContent = badgeOptional
        ? 'Cadastro antigo sem crachá: preencha quando souber.'
        : 'Identificador único (ex.: A-1024).';

    // Ao criar com o filtro num setor, já sugere esse setor.
    const presetSector = employee
        ? employee.setorId ?? ''
        : state.sectors.some(sector => sector.id === state.sectorFilter)
          ? state.sectorFilter
          : '';
    els.sectorSelect.replaceChildren(
        h('option', { value: '' }, 'Sem setor'),
        ...sectorOptions(state.sectors, { selected: presetSector })
    );
    els.sectorSelect.value = presetSector;

    els.scores.replaceChildren(
        h('legend', {}, 'Notas (0 a 10)'),
        ...state.skills.map((skill, index) =>
            scoreField(skill, employee ? employee.notas[skill] : DEFAULT_SCORE, index)
        )
    );
    els.dialog.showModal();
    els.nameInput.focus();
}

function readForm() {
    const notas = {};
    els.scores.querySelectorAll('input[type="range"]').forEach(input => {
        notas[input.dataset.skill] = Number(input.value);
    });
    return {
        nome: els.nameInput.value.trim(),
        cracha: els.badgeInput.value.trim(),
        setorId: els.sectorSelect.value || null,
        notas,
    };
}

async function refresh() {
    const data = await api.getState();
    state.skills = data.skills;
    state.sectors = data.setores;
    state.employees = [...data.employees].sort(byName);
    renderFilters();
    renderTable();
}

async function submitForm(event) {
    event.preventDefault();
    const data = readForm();
    if (!data.nome) {
        els.nameInput.focus();
        toast('Informe o nome do colaborador.', 'warning');
        return;
    }
    if (!data.cracha && els.badgeInput.required) {
        els.badgeInput.focus();
        toast('Informe o crachá do colaborador.', 'warning');
        return;
    }

    const editing = Boolean(state.editingId);
    const before = state.employees.find(emp => emp.id === state.editingId);
    const wasLeading = before ? ledSector(before, state.sectors) : null;

    await withBusy(els.submit, async () => {
        try {
            const saved = editing
                ? await api.updateEmployee(state.editingId, data)
                : await api.createEmployee(data);
            els.dialog.close();
            await refresh();
            toast(`${saved.nome} ${editing ? 'atualizado' : 'cadastrado'}.`, 'success');
            if (wasLeading && saved.setorId !== wasLeading.id) {
                toast(`${saved.nome} mudou de setor e deixou de ser líder de ${wasLeading.nome}.`, 'warning');
            }
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

async function removeEmployee(employee, button) {
    const led = ledSector(employee, state.sectors);
    const confirmed = await confirmDialog({
        title: 'Remover colaborador?',
        message:
            `${employee.nome} e todas as suas notas serão removidos.` +
            (led ? ` O setor ${led.nome} ficará sem líder.` : '') +
            ' Essa ação não pode ser desfeita.',
        confirmLabel: 'Remover',
        danger: true,
    });
    if (!confirmed) return;

    await withBusy(button, async () => {
        try {
            await api.deleteEmployee(employee.id);
            await refresh();
            toast(`${employee.nome} removido.`, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

// ---------- Eventos ----------

els.newButton.addEventListener('click', () => openDialog());
els.form.addEventListener('submit', submitForm);
els.cancel.addEventListener('click', () => els.dialog.close());
els.close.addEventListener('click', () => els.dialog.close());
els.search.addEventListener('input', () => {
    state.query = els.search.value;
    renderTable();
});
els.sectorFilter.addEventListener('change', () => {
    state.sectorFilter = els.sectorFilter.value;
    renderTable();
});

// ---------- Início ----------

try {
    await refresh();
    els.newButton.disabled = false;
} catch (err) {
    els.tableWrap.hidden = true;
    els.empty.hidden = false;
    els.empty.textContent = 'Não foi possível carregar os colaboradores.';
    toast(err.message, 'error');
}
