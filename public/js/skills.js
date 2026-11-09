import { api } from './api.js';
import { h, icon, renderShell, toast, confirmDialog, withBusy, formatScore, pluralize } from './ui.js';

renderShell('habilidades');

const els = {
    count: document.getElementById('skill-count'),
    list: document.getElementById('skill-list'),
    form: document.getElementById('skill-form'),
    input: document.getElementById('skill-name'),
    submit: document.getElementById('skill-submit'),
};

const state = { skills: [], employees: [] };

function skillSummary(skill) {
    const values = state.employees.map(emp => emp.notas[skill]).filter(value => typeof value === 'number');
    if (values.length === 0) return 'Nenhuma avaliação ainda';
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return `${pluralize(values.length, 'avaliação', 'avaliações')} · média ${formatScore(avg)}`;
}

function render() {
    els.count.textContent = pluralize(state.skills.length, 'habilidade', 'habilidades');
    const onlyOne = state.skills.length === 1;

    els.list.replaceChildren(
        ...state.skills.map(skill =>
            h(
                'li',
                { class: 'skill-item' },
                h('span', { class: 'skill-icon', 'aria-hidden': 'true' }, icon('star', 16)),
                h(
                    'div',
                    { class: 'skill-body' },
                    h('div', { class: 'skill-name' }, skill),
                    h('div', { class: 'skill-meta' }, skillSummary(skill))
                ),
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'icon-btn is-danger',
                        'aria-label': `Remover habilidade ${skill}`,
                        title: onlyOne ? 'É preciso manter pelo menos uma habilidade' : 'Remover',
                        disabled: onlyOne,
                        onClick: event => removeSkill(skill, event.currentTarget),
                    },
                    icon('trash')
                )
            )
        )
    );
}

async function removeSkill(skill, button) {
    const confirmed = await confirmDialog({
        title: `Remover "${skill}"?`,
        message: 'As notas dessa habilidade serão apagadas de todos os colaboradores. Essa ação não pode ser desfeita.',
        confirmLabel: 'Remover',
        danger: true,
    });
    if (!confirmed) return;

    await withBusy(button, async () => {
        try {
            await api.removeSkill(skill);
            state.skills = state.skills.filter(s => s !== skill);
            state.employees.forEach(emp => delete emp.notas[skill]);
            render();
            toast(`Habilidade "${skill}" removida.`, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

els.form.addEventListener('submit', async event => {
    event.preventDefault();
    const nome = els.input.value.trim();
    if (!nome) {
        els.input.focus();
        return;
    }

    await withBusy(els.submit, async () => {
        try {
            const { nome: created } = await api.addSkill(nome);
            state.skills.push(created);
            state.employees.forEach(emp => {
                emp.notas[created] = null;
            });
            els.input.value = '';
            render();
            toast(`Habilidade "${created}" adicionada. Avalie os colaboradores em "Colaboradores".`, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    });
    els.input.focus();
});

try {
    const data = await api.getState();
    state.skills = data.skills;
    state.employees = data.employees;
    render();
} catch (err) {
    els.list.replaceChildren(h('li', { class: 'empty' }, 'Não foi possível carregar as habilidades.'));
    toast(err.message, 'error');
}
