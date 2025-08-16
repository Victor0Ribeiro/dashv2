document.addEventListener('DOMContentLoaded', async () => {
    const employeeListContainer = document.getElementById('employee-list');
    const tbody = document.querySelector('#skills-table tbody');
    const ctx = document.getElementById('skillsRadarChart').getContext('2d');
    let chart;
    let employees = {};
    let skillLabels = ['Área', 'Paciência', 'Versatilidade', 'Comunicação'];

    const colors = [
        { bg: 'rgba(175, 42, 228, 0.2)', border: 'rgba(175, 42, 228, 1)' },
        { bg: 'rgba(42, 228, 150, 0.2)', border: 'rgba(42, 228, 150, 1)' },
        { bg: 'rgba(228, 123, 42, 0.2)', border: 'rgba(228, 123, 42, 1)' },
        { bg: 'rgba(42, 123, 228, 0.2)', border: 'rgba(42, 123, 228, 1)' }
    ];

    async function fetchEmployees() {
        const res = await fetch('/api/employees');
        return await res.json();
    }

    function populateEmployeeList() {
        employeeListContainer.innerHTML = '';
        Object.values(employees).forEach((emp, idx) => {
            const row = document.createElement('div');
            row.classList.add('employee-row');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.marginBottom = '8px';

            const label = document.createElement('span');
            label.textContent = emp.Nome;
            label.style.fontWeight = '500';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.classList.add('compare-switch');
            checkbox.dataset.index = idx;

            row.appendChild(label);
            row.appendChild(checkbox);
            employeeListContainer.appendChild(row);

            checkbox.addEventListener('change', updateDashboard);
        });
    }

    function updateDashboard() {
        const selectedEmployees = [];
        employeeListContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            if (checkbox.checked) selectedEmployees.push(Object.values(employees)[checkbox.dataset.index]);
        });

        // Atualiza tabela
        tbody.innerHTML = '';
        selectedEmployees.forEach(emp => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${emp.Nome}</td>
                ${skillLabels.map(skill => `<td>${emp[skill] ?? '-'}</td>`).join('')}
            `;
            tbody.appendChild(tr);
        });

        // Atualiza gráfico
        const datasets = selectedEmployees.map((emp, idx) => {
            const color = colors[idx % colors.length];
            return {
                label: emp.Nome,
                data: skillLabels.map(skill => emp[skill]),
                backgroundColor: color.bg,
                borderColor: color.border,
                pointBackgroundColor: color.border
            };
        });

        const data = { labels: skillLabels, datasets };
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            scales: { 
                r: { min: 0, max: 10, ticks: { stepSize: 1 }, pointLabels: { font: { size: 14 } } } 
            },
            plugins: { legend: { display: true } }
        };

        if (chart) chart.destroy();
        chart = new Chart(ctx, { type: 'radar', data, options });
    }

    employees = await fetchEmployees();
    populateEmployeeList();
});
