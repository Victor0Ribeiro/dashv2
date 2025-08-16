let employees = {};

const skillLabels = ["Área", "Paciência", "Versatilidade", "Comunicação"];

function renderTable() {
    const tbody = document.querySelector('#manage-table tbody');
    tbody.innerHTML = '';
    Object.entries(employees).forEach(([id, emp]) => {
        tbody.innerHTML += `
            <tr>
                <td>${emp.Nome}</td>
                ${skillLabels.map(skill => `<td>${emp[skill]}</td>`).join('')}
                <td>
                    <button onclick="editEmployee('${id}')">Editar</button>
                    <button onclick="removeEmployee('${id}')">Remover</button>
                </td>
            </tr>
        `;
    });
}

function resetForm() {
    document.getElementById('new-name').value = '';
    document.getElementById('new-area').value = '';
    document.getElementById('new-patience').value = 0;
    document.getElementById('new-versatility').value = 0;
    document.getElementById('new-communication').value = 0;
}

document.getElementById('create-form').addEventListener('submit', e => {
    e.preventDefault();
    const Nome = document.getElementById('new-name').value.trim();
    const Área = document.getElementById('new-area').value.trim();
    const Paciência = Number(document.getElementById('new-patience').value);
    const Versatilidade = Number(document.getElementById('new-versatility').value);
    const Comunicação = Number(document.getElementById('new-communication').value);

    if ([Paciência, Versatilidade, Comunicação].some(n => n < 0 || n > 10)) {
        alert("Habilidades devem estar entre 0 e 10.");
        return;
    }

    const id = 'func' + Date.now();
    employees[id] = { Nome, Área, Paciência, Versatilidade, Comunicação };
    renderTable();
    resetForm();
    saveToAPI();
});

window.editEmployee = function(id) {
    const emp = employees[id];
    const tr = [...document.querySelectorAll('#manage-table tbody tr')]
        .find(r => r.children[0].textContent === emp.Nome);
    if (!tr) return;

    tr.innerHTML = `
        <td><input type="text" id="edit-name" value="${emp.Nome}"></td>
        ${skillLabels.map((skill, idx) => `<td><input type="number" min="0" max="10" id="edit-${skill}" value="${emp[skill]}"></td>`).join('')}
        <td>
            <button onclick="saveEmployee('${id}')">Salvar</button>
            <button onclick="renderTable()">Cancelar</button>
        </td>
    `;
};

window.saveEmployee = function(id) {
    const Nome = document.getElementById('edit-name').value.trim();
    const Área = Number(document.getElementById('edit-Área').value);
    const Paciência = Number(document.getElementById('edit-Paciência').value);
    const Versatilidade = Number(document.getElementById('edit-Versatilidade').value);
    const Comunicação = Number(document.getElementById('edit-Comunicação').value);

    if ([Paciência, Versatilidade, Comunicação].some(n => n < 0 || n > 10)) {
        alert("Habilidades devem estar entre 0 e 10.");
        return;
    }

    employees[id] = { Nome, Área, Paciência, Versatilidade, Comunicação };
    renderTable();
    saveToAPI();
};

window.removeEmployee = function(id) {
    if (confirm("Remover funcionário?")) {
        delete employees[id];
        renderTable();
        saveToAPI();
    }
};

async function saveToAPI() {
    await fetch('http://localhost:3001/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employees)
    });
}

async function initManage() {
    const res = await fetch('http://localhost:3001/api/employees');
    employees = await res.json();
    renderTable();
}

initManage();
