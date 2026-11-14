// Cálculos puros (sem DOM): usados pelas páginas e pelos testes.

/** Média dos valores numéricos; null se não houver nenhum. */
export function mean(values) {
    const numbers = values.filter(value => typeof value === 'number');
    if (numbers.length === 0) return null;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

/** Média individual de um colaborador nas habilidades informadas. */
export function average(employee, skills) {
    return mean(skills.map(skill => employee.notas[skill]));
}

/** Médias de um grupo: por habilidade e geral (cada pessoa pesa igual na média geral). */
export function groupScores(members, skills) {
    const notas = {};
    for (const skill of skills) notas[skill] = mean(members.map(member => member.notas[skill]));
    return { membros: members.length, notas, media: mean(members.map(member => average(member, skills))) };
}

export function sectorMembers(sector, employees) {
    return employees.filter(employee => employee.setorId === sector.id);
}

/** Desempenho do setor inteiro (líder incluído): usado para comparar setores entre si. */
export function sectorScore(sector, employees, skills) {
    return groupScores(sectorMembers(sector, employees), skills);
}

/**
 * Nota do time do líder: média dos demais membros do setor (o líder não entra,
 * para que a nota reflita o desempenho da equipe que ele conduz).
 */
export function teamScore(sector, employees, skills) {
    const team = sectorMembers(sector, employees).filter(employee => employee.id !== sector.liderId);
    return groupScores(team, skills);
}

/** Setor que o colaborador lidera, ou null. */
export function ledSector(employee, sectors) {
    return sectors.find(sector => sector.liderId === employee.id) ?? null;
}
