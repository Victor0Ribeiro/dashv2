'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const EMPLOYEE_SHEET = 'Funcionarios';
const SKILL_SHEET = 'Habilidades';
const FIXED_COLUMNS = ['ID', 'Nome'];
const DEFAULT_SKILLS = ['Área', 'Paciência', 'Versatilidade', 'Comunicação'];
const RESERVED_SKILL_NAMES = ['id', 'nome', '__proto__', 'constructor', 'prototype'];

const SCORE_MIN = 0;
const SCORE_MAX = 10;
const MAX_NAME_LENGTH = 80;
const MAX_SKILL_LENGTH = 40;

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

function validateEmployee(input, skills) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new HttpError(400, 'Dados do colaborador inválidos.');
    }

    const nome = cleanText(input.nome);
    if (!nome) throw new HttpError(400, 'Informe o nome do colaborador.');
    if (nome.length > MAX_NAME_LENGTH) {
        throw new HttpError(400, `O nome deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`);
    }

    const received = input.notas;
    if (!received || typeof received !== 'object' || Array.isArray(received)) {
        throw new HttpError(400, 'Informe as notas das habilidades.');
    }

    const notas = {};
    for (const skill of skills) {
        const score = Object.hasOwn(received, skill) ? received[skill] : undefined;
        if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
            throw new HttpError(
                400,
                `A nota de "${skill}" deve ser um número inteiro entre ${SCORE_MIN} e ${SCORE_MAX}.`
            );
        }
        notas[skill] = score;
    }

    return { nome, notas };
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

function findEmployee(state, id) {
    const employee = state.employees.find(emp => emp.id === id);
    if (!employee) throw new HttpError(404, 'Colaborador não encontrado.');
    return employee;
}

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
        if (!(await fileExists())) {
            return { skills: [...DEFAULT_SKILLS], employees: [], legacy: false };
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file);
        const sheet = workbook.getWorksheet(EMPLOYEE_SHEET) || workbook.worksheets[0];
        if (!sheet) return { skills: [...DEFAULT_SKILLS], employees: [], legacy: false };

        const headers = new Map(); // coluna -> cabeçalho
        sheet.getRow(1).eachCell((cell, col) => {
            const header = cellText(cell.value);
            if (header) headers.set(col, header);
        });

        // Formato antigo: sem a aba "Habilidades", as habilidades são as colunas do cabeçalho.
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
            employees.push({ id, nome: cellText(record.Nome), notas });
        });

        return { skills, employees, legacy: !skillSheet };
    }

    async function write({ skills, employees }) {
        const workbook = new ExcelJS.Workbook();

        const sheet = workbook.addWorksheet(EMPLOYEE_SHEET);
        sheet.addRow([...FIXED_COLUMNS, ...skills]);
        sheet.getRow(1).font = { bold: true };
        employees.forEach(emp => {
            sheet.addRow([emp.id, emp.nome, ...skills.map(skill => emp.notas[skill] ?? null)]);
        });

        const skillSheet = workbook.addWorksheet(SKILL_SHEET);
        skillSheet.addRow(['Habilidade']);
        skillSheet.getRow(1).font = { bold: true };
        skills.forEach(skill => skillSheet.addRow([skill]));

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

    async function backupLegacyFile() {
        try {
            await fs.copyFile(file, `${file}.bak`, fs.constants.COPYFILE_EXCL);
        } catch (err) {
            if (err.code !== 'EEXIST' && err.code !== 'ENOENT') throw err;
        }
    }

    function mutate(change) {
        return exclusive(async () => {
            const state = await read();
            if (state.legacy) await backupLegacyFile();
            const result = change(state);
            await write(state);
            return result;
        });
    }

    return {
        getState: () => exclusive(read).then(({ skills, employees }) => ({ skills, employees })),

        createEmployee: input =>
            mutate(state => {
                const employee = { id: `func_${crypto.randomUUID()}`, ...validateEmployee(input, state.skills) };
                state.employees.push(employee);
                return employee;
            }),

        updateEmployee: (id, input) =>
            mutate(state => {
                const employee = findEmployee(state, id);
                Object.assign(employee, validateEmployee(input, state.skills));
                return employee;
            }),

        deleteEmployee: id =>
            mutate(state => {
                findEmployee(state, id);
                state.employees = state.employees.filter(emp => emp.id !== id);
            }),

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
    };
}

module.exports = { createStore, HttpError, SCORE_MIN, SCORE_MAX };
