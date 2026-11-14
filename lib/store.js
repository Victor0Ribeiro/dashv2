'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const EMPLOYEE_SHEET = 'Funcionarios';
const SKILL_SHEET = 'Habilidades';
const SECTOR_SHEET = 'Setores';
const FIXED_COLUMNS = ['ID', 'Nome', 'Crachá', 'SetorID'];
const DEFAULT_SKILLS = ['Área', 'Paciência', 'Versatilidade', 'Comunicação'];
const RESERVED_SKILL_NAMES = [
    'id',
    'nome',
    'crachá',
    'cracha',
    'setorid',
    '__proto__',
    'constructor',
    'prototype',
];

// Versões do formato da planilha (usadas para migrar e fazer backup do formato anterior).
// 1: só aba Funcionarios | 2: + aba Habilidades | 3: + aba Setores, colunas Crachá e SetorID
const CURRENT_SCHEMA = 3;

const SCORE_MIN = 0;
const SCORE_MAX = 10;
const MAX_NAME_LENGTH = 80;
const MAX_SKILL_LENGTH = 40;
const MAX_SECTOR_LENGTH = 40;
const MAX_BADGE_LENGTH = 20;

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** Extrai o valor "cru" de uma célula do ExcelJS (fórmulas, rich text, hyperlinks). */
function plainCellValue(value) {
    if (value && typeof value === 'object') {
        if ('result' in value) return value.result;
        if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
        if ('text' in value) return value.text;
    }
    return value;
}

function toScore(value) {
    const raw = plainCellValue(value);
    if (raw === null || raw === undefined || raw === '') return null;
    const score = Number(raw);
    return Number.isFinite(score) ? score : null;
}

function cleanText(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function cellText(value) {
    const raw = plainCellValue(value);
    return raw === null || raw === undefined ? '' : cleanText(String(raw));
}

function sameName(a, b) {
    return a.localeCompare(b, 'pt-BR', { sensitivity: 'accent' }) === 0;
}

function sameBadge(a, b) {
    return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) === 0;
}

function requireObject(input, message) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, message);
}

// ---------- Validações ----------

function validateEmployee(input, state, existing = null) {
    requireObject(input, 'Dados do colaborador inválidos.');

    const nome = cleanText(input.nome);
    if (!nome) throw new HttpError(400, 'Informe o nome do colaborador.');
    if (nome.length > MAX_NAME_LENGTH) {
        throw new HttpError(400, `O nome deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`);
    }

    // Crachá: obrigatório em novos cadastros; quem já tem crachá não pode ficar sem.
    // Colaboradores antigos (sem crachá) podem continuar sem até alguém preencher.
    const cracha = cleanText(input.cracha);
    if (!cracha && (!existing || existing.cracha)) throw new HttpError(400, 'Informe o crachá do colaborador.');
    if (cracha.length > MAX_BADGE_LENGTH) {
        throw new HttpError(400, `O crachá deve ter no máximo ${MAX_BADGE_LENGTH} caracteres.`);
    }
    if (cracha) {
        const owner = state.employees.find(emp => emp.cracha && emp !== existing && sameBadge(emp.cracha, cracha));
        if (owner) throw new HttpError(409, `O crachá "${cracha}" já pertence a ${owner.nome}.`);
    }

    let setorId = null;
    if (input.setorId !== undefined && input.setorId !== null && input.setorId !== '') {
        if (typeof input.setorId !== 'string' || !state.sectors.some(sector => sector.id === input.setorId)) {
            throw new HttpError(400, 'Setor não encontrado.');
        }
        setorId = input.setorId;
    }

    const received = input.notas;
    requireObject(received, 'Informe as notas das habilidades.');
    const notas = {};
    for (const skill of state.skills) {
        const score = Object.hasOwn(received, skill) ? received[skill] : undefined;
        if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
            throw new HttpError(
                400,
                `A nota de "${skill}" deve ser um número inteiro entre ${SCORE_MIN} e ${SCORE_MAX}.`
            );
        }
        notas[skill] = score;
    }

    return { nome, cracha: cracha || null, setorId, notas };
}

function validateSkillName(input, skills) {
    const nome = cleanText(input);
    if (!nome) throw new HttpError(400, 'Informe o nome da habilidade.');
    if (nome.length > MAX_SKILL_LENGTH) {
        throw new HttpError(400, `O nome da habilidade deve ter no máximo ${MAX_SKILL_LENGTH} caracteres.`);
    }
    if (RESERVED_SKILL_NAMES.includes(nome.toLowerCase())) {
        throw new HttpError(400, `"${nome}" é um nome reservado.`);
    }
    if (skills.some(skill => sameName(skill, nome))) {
        throw new HttpError(409, `A habilidade "${nome}" já existe.`);
    }
    return nome;
}

function validateSectorName(input, sectors, current = null) {
    const nome = cleanText(input);
    if (!nome) throw new HttpError(400, 'Informe o nome do setor.');
    if (nome.length > MAX_SECTOR_LENGTH) {
        throw new HttpError(400, `O nome do setor deve ter no máximo ${MAX_SECTOR_LENGTH} caracteres.`);
    }
    if (sectors.some(sector => sector !== current && sameName(sector.nome, nome))) {
        throw new HttpError(409, `O setor "${nome}" já existe.`);
    }
    return nome;
}

function findEmployee(state, id) {
    const employee = state.employees.find(emp => emp.id === id);
    if (!employee) throw new HttpError(404, 'Colaborador não encontrado.');
    return employee;
}

function findSector(state, id) {
    const sector = state.sectors.find(s => s.id === id);
    if (!sector) throw new HttpError(404, 'Setor não encontrado.');
    return sector;
}

/** Garante que todo líder é membro do próprio setor (remove lideranças inválidas). */
function reconcileLeaders(state) {
    for (const sector of state.sectors) {
        if (!sector.liderId) continue;
        const leader = state.employees.find(emp => emp.id === sector.liderId);
        if (!leader || leader.setorId !== sector.id) sector.liderId = null;
    }
}

function publicState({ skills, sectors, employees }) {
    return { skills, setores: sectors, employees };
}

// ---------- Store ----------

function createStore(file) {
    // Todas as leituras/escritas passam por esta fila para que duas requisições
    // simultâneas nunca leiam ou gravem a planilha ao mesmo tempo.
    let queue = Promise.resolve();
    function exclusive(task) {
        const run = queue.then(task);
        queue = run.catch(() => {});
        return run;
    }

    async function fileExists() {
        try {
            await fs.access(file);
            return true;
        } catch {
            return false;
        }
    }

    async function read() {
        const empty = { skills: [...DEFAULT_SKILLS], sectors: [], employees: [], schema: CURRENT_SCHEMA };
        if (!(await fileExists())) return empty;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file);
        const sheet = workbook.getWorksheet(EMPLOYEE_SHEET) || workbook.worksheets[0];
        if (!sheet) return empty;

        const headers = new Map(); // coluna -> cabeçalho
        sheet.getRow(1).eachCell((cell, col) => {
            const header = cellText(cell.value);
            if (header) headers.set(col, header);
        });

        // Formato 1: sem a aba "Habilidades", as habilidades são as colunas do cabeçalho.
        const skillSheet = workbook.getWorksheet(SKILL_SHEET);
        let skills;
        if (skillSheet) {
            skills = [];
            skillSheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const name = cellText(row.getCell(1).value);
                if (name && !skills.includes(name)) skills.push(name);
            });
        } else {
            skills = [...headers.values()].filter(header => !FIXED_COLUMNS.includes(header));
        }

        const sectorSheet = workbook.getWorksheet(SECTOR_SHEET);
        const sectors = [];
        sectorSheet?.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const id = cellText(row.getCell(1).value);
            const nome = cellText(row.getCell(2).value);
            if (!id || !nome) return;
            sectors.push({ id, nome, liderId: cellText(row.getCell(3).value) || null });
        });
        const sectorIds = new Set(sectors.map(sector => sector.id));

        const employees = [];
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const record = {};
            headers.forEach((header, col) => {
                record[header] = row.getCell(col).value;
            });
            const id = cellText(record.ID);
            if (!id) return;

            const notas = {};
            skills.forEach(skill => {
                notas[skill] = toScore(record[skill]);
            });
            const setorId = cellText(record.SetorID);
            employees.push({
                id,
                nome: cellText(record.Nome),
                cracha: cellText(record['Crachá']) || null,
                setorId: sectorIds.has(setorId) ? setorId : null,
                notas,
            });
        });

        const state = {
            skills,
            sectors,
            employees,
            schema: !skillSheet ? 1 : !sectorSheet ? 2 : CURRENT_SCHEMA,
        };
        reconcileLeaders(state);
        return state;
    }

    async function write({ skills, sectors, employees }) {
        const workbook = new ExcelJS.Workbook();

        const sheet = workbook.addWorksheet(EMPLOYEE_SHEET);
        sheet.addRow([...FIXED_COLUMNS, ...skills]);
        sheet.getRow(1).font = { bold: true };
        employees.forEach(emp => {
            sheet.addRow([
                emp.id,
                emp.nome,
                emp.cracha ?? null,
                emp.setorId ?? null,
                ...skills.map(skill => emp.notas[skill] ?? null),
            ]);
        });

        const skillSheet = workbook.addWorksheet(SKILL_SHEET);
        skillSheet.addRow(['Habilidade']);
        skillSheet.getRow(1).font = { bold: true };
        skills.forEach(skill => skillSheet.addRow([skill]));

        const sectorSheet = workbook.addWorksheet(SECTOR_SHEET);
        sectorSheet.addRow(['ID', 'Nome', 'LiderID']);
        sectorSheet.getRow(1).font = { bold: true };
        sectors.forEach(sector => sectorSheet.addRow([sector.id, sector.nome, sector.liderId ?? null]));

        // Grava em um arquivo temporário e renomeia: a planilha nunca fica pela metade.
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        try {
            await workbook.xlsx.writeFile(tmp);
            await fs.rename(tmp, file);
        } catch (err) {
            await fs.rm(tmp, { force: true });
            if (err.code === 'EBUSY' || err.code === 'EPERM') {
                throw new HttpError(
                    503,
                    'Não foi possível salvar: a planilha está aberta em outro programa. Feche-a e tente novamente.'
                );
            }
            throw err;
        }
    }

    /** Antes da primeira gravação num formato antigo, guarda uma cópia (ex.: funcionarios.xlsx.v2.bak). */
    async function backupOldSchema(schema) {
        try {
            await fs.copyFile(file, `${file}.v${schema}.bak`, fs.constants.COPYFILE_EXCL);
        } catch (err) {
            if (err.code !== 'EEXIST' && err.code !== 'ENOENT') throw err;
        }
    }

    function mutate(change) {
        return exclusive(async () => {
            const state = await read();
            if (state.schema < CURRENT_SCHEMA) await backupOldSchema(state.schema);
            const result = change(state);
            reconcileLeaders(state);
            await write(state);
            return result;
        });
    }

    return {
        getState: () => exclusive(read).then(publicState),

        // ----- Colaboradores -----

        createEmployee: input =>
            mutate(state => {
                const employee = { id: `func_${crypto.randomUUID()}`, ...validateEmployee(input, state) };
                state.employees.push(employee);
                return employee;
            }),

        updateEmployee: (id, input) =>
            mutate(state => {
                const employee = findEmployee(state, id);
                Object.assign(employee, validateEmployee(input, state, employee));
                return employee;
            }),

        deleteEmployee: id =>
            mutate(state => {
                findEmployee(state, id);
                state.employees = state.employees.filter(emp => emp.id !== id);
            }),

        // ----- Habilidades -----

        addSkill: input =>
            mutate(state => {
                const skill = validateSkillName(input, state.skills);
                state.skills.push(skill);
                state.employees.forEach(emp => {
                    emp.notas[skill] = null;
                });
                return skill;
            }),

        removeSkill: name =>
            mutate(state => {
                if (!state.skills.includes(name)) throw new HttpError(404, 'Habilidade não encontrada.');
                if (state.skills.length === 1) {
                    throw new HttpError(400, 'É preciso manter pelo menos uma habilidade.');
                }
                state.skills = state.skills.filter(skill => skill !== name);
                state.employees.forEach(emp => {
                    delete emp.notas[name];
                });
            }),

        // ----- Setores -----

        createSector: input =>
            mutate(state => {
                requireObject(input, 'Dados do setor inválidos.');
                const sector = {
                    id: `setor_${crypto.randomUUID()}`,
                    nome: validateSectorName(input.nome, state.sectors),
                    liderId: null,
                };
                state.sectors.push(sector);
                return sector;
            }),

        updateSector: (id, input) =>
            mutate(state => {
                requireObject(input, 'Dados do setor inválidos.');
                const sector = findSector(state, id);
                const nome = validateSectorName(input.nome, state.sectors, sector);

                let liderId = null;
                if (input.liderId !== undefined && input.liderId !== null && input.liderId !== '') {
                    const leader = state.employees.find(emp => emp.id === input.liderId);
                    if (!leader) throw new HttpError(400, 'Líder não encontrado.');
                    if (leader.setorId !== sector.id) {
                        throw new HttpError(400, `${leader.nome} precisa fazer parte do setor para ser o líder.`);
                    }
                    liderId = leader.id;
                }

                Object.assign(sector, { nome, liderId });
                return sector;
            }),

        deleteSector: id =>
            mutate(state => {
                findSector(state, id);
                state.sectors = state.sectors.filter(sector => sector.id !== id);
                state.employees.forEach(emp => {
                    if (emp.setorId === id) emp.setorId = null;
                });
            }),
    };
}

module.exports = { createStore, HttpError, SCORE_MIN, SCORE_MAX };
