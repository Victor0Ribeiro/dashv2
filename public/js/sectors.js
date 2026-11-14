import { api } from './api.js';
import { average, sectorMembers, sectorScore, teamScore } from './metrics.js';
import {
    h,
    icon,
    renderShell,
    toast,
    confirmDialog,
    promptDialog,
    withBusy,
    formatScore,
    initials,
    byName,
    pluralize,
} from './ui.js';

renderShell('setores');

const els = {
    count: document.getElementById('sector-count'),
    grid: document.getElementById('sector-grid'),
    empty: document.getElementById('sector-empty'),
    unassigned: document.getElementById('unassigned'),
    newButton: document.getElementById('new-sector'),
};

const state = { skills: [], sectors: [], employees: [] };

const byNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });

function miniStat(label, value, title) {
    return h('div', { class: 'mini-stat', title }, h('span', {}, label), h('strong', {}, formatScore(value)));
}

function sectorCard(sector) {
    const members = sectorMembers(sector, state.employees).sort(byName);
    const leader = members.find(emp => emp.id === sector.liderId) ?? null;
    const scores = sectorScore(sector, state.employees, state.skills);
    const team = teamScore(sector, state.employees, state.skills);
    const selectId = `leader-${sector.id}`;

    const leaderSelect = h(
        'select',
        {
            id: selectId,
            class: 'input',
            disabled: members.length === 0,
            onChange: event => setLeader(sector, event.currentTarget),
        },
        h('option', { value: '' }, members.length ? 'Sem líder' : 'Sem membros'),
        members.map(emp => h('option', { value: emp.id }, emp.nome))
    );
    leaderSelect.value = sector.liderId ?? '';

    return h(
        'article',
        { class: 'card sector-card', 'aria-labelledby': `title-${sector.id}` },
        h(
            'div',
            { class: 'card-header' },
            h(
                'div',
                { class: 'sector-title' },
                h('span', { class: 'skill-icon', 'aria-hidden': 'true' }, icon('building', 16)),
                h(
                    'div',
                    {},
                    h('h2', { class: 'card-title', id: `title-${sector.id}` }, sector.nome),
                    h('p', { class: 'card-description' }, pluralize(members.length, 'membro', 'membros'))
                )
            ),
            h(
                'span',
                { class: 'actions' },
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'icon-btn',
                        'aria-label': `Renomear ${sector.nome}`,
                        title: 'Renomear',
                        onClick: () => renameSector(sector),
                    },
                    icon('edit')
                ),
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'icon-btn is-danger',
                        'aria-label': `Remover ${sector.nome}`,
                        title: 'Remover',
                        onClick: event => removeSector(sector, event.currentTarget),
                    },
                    icon('trash')
                )
            )
        ),
        h('div', { class: 'field' }, h('label', { class: 'label', for: selectId }, 'Líder do setor'), leaderSelect),
        h(
            'div',
            { class: 'mini-stats' },
            miniStat('Média do setor', scores.media, 'Média de todos os membros, incluindo o líder'),
            miniStat('Nota do time', leader ? team.media : null, 'Avaliação do líder: média dos liderados'),
            miniStat('Líder (individual)', leader ? average(leader, state.skills) : null, 'Média das notas do próprio líder')
        ),
        leader && team.membros === 0
            ? h('p', { class: 'hint' }, 'O líder ainda não tem liderados para compor a nota do time.')
            : null,
        members.length
            ? h(
                  'ul',
                  { class: 'member-list', 'aria-label': `Membros de ${sector.nome}` },
                  members.map(emp =>
                      h(
                          'li',
                          { class: `member${emp.id === sector.liderId ? ' is-leader' : ''}` },
                          h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(emp.nome)),
                          emp.nome,
                          emp.id === sector.liderId ? h('span', { class: 'sr-only' }, ' (líder)') : null,
                          emp.id === sector.liderId ? icon('crown', 12) : null
                      )
                  )
              )
            : h(
                  'p',
                  { class: 'hint' },
                  'Nenhum colaborador neste setor. Atribua pela página ',
                  h('a', { href: '/colaboradores' }, 'Colaboradores'),
                  '.'
              ),
        h(
            'a',
            { class: 'btn btn-ghost btn-sm', href: `/colaboradores?setor=${encodeURIComponent(sector.id)}` },
            'Ver colaboradores do setor'
        )
    );
}

function render() {
    els.count.textContent = pluralize(state.sectors.length, 'setor', 'setores');
    els.empty.hidden = state.sectors.length > 0;
    els.grid.replaceChildren(...[...state.sectors].sort(byNome).map(sectorCard));

    const unassigned = state.employees.filter(emp => !emp.setorId).length;
    els.unassigned.hidden = unassigned === 0;
    els.unassigned.replaceChildren(
        `${pluralize(unassigned, 'colaborador está', 'colaboradores estão')} sem setor. `,
        h('a', { href: '/colaboradores?setor=__sem_setor__' }, 'Atribuir agora')
    );
}

async function refresh() {
    const data = await api.getState();
    state.skills = data.skills;
    state.sectors = data.setores;
    state.employees = data.employees;
    render();
}

async function createSector() {
    const nome = await promptDialog({
        title: 'Novo setor',
        label: 'Nome do setor',
        confirmLabel: 'Criar setor',
        maxLength: 40,
    });
    if (!nome) return;
    await withBusy(els.newButton, async () => {
        try {
            const created = await api.createSector(nome);
            await refresh();
            toast(`Setor "${created.nome}" criado. Atribua colaboradores a ele em "Colaboradores".`, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

async function renameSector(sector) {
    const nome = await promptDialog({ title: 'Renomear setor', label: 'Nome do setor', value: sector.nome, maxLength: 40 });
    if (!nome || nome === sector.nome) return;
    try {
        await api.updateSector(sector.id, { nome, liderId: sector.liderId });
        await refresh();
        toast('Setor renomeado.', 'success');
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function setLeader(sector, select) {
    const liderId = select.value || null;
    await withBusy(select, async () => {
        try {
            await api.updateSector(sector.id, { nome: sector.nome, liderId });
            await refresh();
            const leader = state.employees.find(emp => emp.id === liderId);
            toast(leader ? `${leader.nome} agora lidera ${sector.nome}.` : `${sector.nome} está sem líder.`, 'success');
        } catch (err) {
            select.value = sector.liderId ?? '';
            toast(err.message, 'error');
        }
    });
}

async function removeSector(sector, button) {
    const members = sectorMembers(sector, state.employees).length;
    const confirmed = await confirmDialog({
        title: `Remover "${sector.nome}"?`,
        message:
            (members ? `${pluralize(members, 'colaborador ficará', 'colaboradores ficarão')} sem setor. ` : '') +
            'As notas dos colaboradores não são apagadas.',
        confirmLabel: 'Remover setor',
        danger: true,
    });
    if (!confirmed) return;
    await withBusy(button, async () => {
        try {
            await api.deleteSector(sector.id);
            await refresh();
            toast(`Setor "${sector.nome}" removido.`, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

els.newButton.addEventListener('click', createSector);

try {
    await refresh();
    els.newButton.disabled = false;
} catch (err) {
    els.grid.replaceChildren(h('p', { class: 'empty' }, 'Não foi possível carregar os setores.'));
    toast(err.message, 'error');
}
