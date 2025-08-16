const express = require('express');
const ExcelJS = require('exceljs');
const cors = require('cors');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FILE = 'funcionarios.xlsx';
const HEADERS = ['ID', 'Nome', 'Área', 'Paciência', 'Versatilidade', 'Comunicação'];

// Usuário fixo para login
const USER = 'admin';
const PASS = '1234';

async function readEmployees() {
    if (!fs.existsSync(FILE)) {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Funcionarios');
        sheet.addRow(HEADERS);
        await workbook.xlsx.writeFile(FILE);
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(FILE);
    const sheet = workbook.getWorksheet(1);
    const employees = {};
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const id = row.getCell(1).value;
        employees[id] = {
            ID: id,
            Nome: row.getCell(2).value,
            Área: row.getCell(3).value,
            Paciência: row.getCell(4).value,
            Versatilidade: row.getCell(5).value,
            Comunicação: row.getCell(6).value
        };
    });
    return employees;
}

async function writeEmployees(employees) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Funcionarios');
    sheet.addRow(HEADERS);
    Object.entries(employees).forEach(([id, emp]) => {
        sheet.addRow([id, emp.Nome, emp.Área, emp.Paciência, emp.Versatilidade, emp.Comunicação]);
    });
    await workbook.xlsx.writeFile(FILE);
}

app.use('/views', express.static(__dirname + '/views'));
app.use('/public', express.static(__dirname + '/public'));

// API
app.get('/api/employees', async (req, res) => {
    const employees = await readEmployees();
    res.json(employees);
});
app.post('/api/employees', async (req, res) => {
    const employees = req.body;
    await writeEmployees(employees);
    res.json({ ok: true });
});

// Login
app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    if (usuario === USER && senha === PASS) {
        return res.redirect('/views/dashboard.html');
    }
    res.send('<script>alert("Usuário ou senha inválidos!");window.location.href="/views/login.html";</script>');
});
app.get('/', (req, res) => {
    res.redirect('/views/login.html');
});

app.listen(3001, () => console.log('API rodando em http://localhost:3001'));
