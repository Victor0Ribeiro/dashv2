import { api } from './api.js';
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
} from './ui.js';

renderShell('colaboradores');

const DEFAULT_SCORE = 5;

const els = {
    count: document.getElementById('employee-count'),
    search: document.getElementById('employee-search'),
    newButton: document.getElementById('new-employee'),
    tableHead: document.querySelector('#employees-table thead'),
    tableBody: document.querySelector('#employees-table tbody'),
    tableWrap: document.getElementById('employees-table-wrap'),
    empty: document.getElementById('employees-empty'),
    dialog: document.getElementById('employee-dialog'),
    form: document.getElementById('employee-form'),
    dialogTitle: document.getElementById('employee-dialog-title'),
    nameInput: document.getElementById('employee-name'),
    scores: document.getElementById('employee-scores'),
    submit: document.getElementById('employee-submit'),
    cancel: document.getElementById('employee-cancel'),
    close: document.getElementById('employee-close'),
};

const state = {
    skills: [],
    employees: [],
    query: '',
    editingId: null,
};

// ---------- Tabela ----------

function renderTable() {
    els.count.textContent = pluralize(state.employees.length, 'colaborador', 'colaboradores');

    const query = normalize(state.query.trim());
    const visible = state.employees.filter(emp => normalize(emp.nome).includes(query));

    if (visible.length === 0) {
        els.tableWrap.hidden = true;
        els.empty.hidden = false;
        els.empty.textContent =
            state.employees.length === 0
                ? 'Nenhum colaborador cadastrado ainda. Clique em "Novo colaborador" para começar.'
                : `Nenhum resultado para "${state.query.trim()}".`;
        return;
    }
    els.tableWrap.hidden = false;
    els.empty.hidden = true;

    els.tableHead.replaceChildren(
        h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Colaborador'),
            state.skills.map(skill => h('th', { scope: 'col' }, skill)),
            h('th', { scope: 'col' }, 'Média'),
            h('th', { scope: 'col', class: 'col-actions' }, h('span', { class: 'sr-only' }, 'Ações'))
        )
    );

    els.tableBody.replaceChildren(
        ...visible.map(emp =>
            h(
                'tr',
                {},
                h(
                    'th',
                    { scope: 'row' },
                    h(
                        'span',
                        { class: 'person' },
                        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(emp.nome)),
                        emp.nome
                    )
                ),
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
            )
        )
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
    els.scores.replaceChildren(
        h('legend', {}, 'Notas (0 a 10)'),
        ...state.skills.map((skill, index) => scoreField(skill, employee ? employee.notas[skill] : DEFAULT_SCORE, index))
    );
    els.dialog.showModal();
    els.nameInput.focus();
}

function readForm() {
    const notas = {};
    els.scores.querySelectorAll('input[type="range"]').forEach(input => {
        notas[input.dataset.skill] = Number(input.value);
    });
    return { nome: els.nameInput.value.trim(), notas };
}

async function submitForm(event) {
    event.preventDefault();
    const data = readForm();
    if (!data.nome) {
        els.nameInput.focus();
        toast('Informe o nome do colaborador.', 'warning');
        return;
    }

    await withBusy(els.submit, async () => {
        try {
            if (state.editingId) {
                const updated = await api.updateEmployee(state.editingId, data);
                state.employees = state.employees.map(emp => (emp.id === updated.id ? updated : emp));
                toast(`${updated.nome} atualizado.`, 'success');
            } else {
                const created = await api.createEmployee(data);
                state.employees.push(created);
                toast(`${created.nome} cadastrado.`, 'success');
            }
            state.employees.sort(byName);
            els.dialog.close();
            renderTable();
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

async function removeEmployee(employee, button) {
    const confirmed = await confirmDialog({
        title: 'Remover colaborador?',
        message: `${employee.nome} e todas as suas notas serão removidos. Essa ação não pode ser desfeita.`,
        confirmLabel: 'Remover',
        danger: true,
    });
    if (!confirmed) return;

    await withBusy(button, async () => {
        try {
            await api.deleteEmployee(employee.id);
            state.employees = state.employees.filter(emp => emp.id !== employee.id);
            renderTable();
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

// ---------- Início ----------

try {
    const data = await api.getState();
    state.skills = data.skills;
    state.employees = [...data.employees].sort(byName);
    els.newButton.disabled = false;
    renderTable();
} catch (err) {
    els.tableWrap.hidden = true;
    els.empty.hidden = false;
    els.empty.textContent = 'Não foi possível carregar os colaboradores.';
    toast(err.message, 'error');
}
