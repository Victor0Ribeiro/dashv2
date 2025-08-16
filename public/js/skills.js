let skillLabels = ["Área", "Paciência", "Versatilidade", "Comunicação"]; // inicial

function renderSkillsList() {
    const ul = document.getElementById('skills-list');
    ul.innerHTML = '';
    skillLabels.forEach(skill => {
        const li = document.createElement('li');
        li.textContent = skill + ' ';
        const btn = document.createElement('button');
        btn.textContent = 'Remover';
        btn.onclick = () => removeSkill(skill);
        li.appendChild(btn);
        ul.appendChild(li);
    });
}

function removeSkill(skill) {
    if (confirm(`Remover a habilidade "${skill}"?`)) {
        skillLabels = skillLabels.filter(s => s !== skill);
        renderSkillsList();
        // Opcional: atualizar dashboard e manage.js
    }
}

document.getElementById('add-skill').addEventListener('click', () => {
    const input = document.getElementById('new-skill-name');
    const newSkill = input.value.trim();
    if (!newSkill) return alert('Digite uma habilidade');
    if (skillLabels.includes(newSkill)) return alert('Habilidade já existe');
    skillLabels.push(newSkill);
    input.value = '';
    renderSkillsList();
    // Opcional: atualizar dashboard e manage.js
});

renderSkillsList();
