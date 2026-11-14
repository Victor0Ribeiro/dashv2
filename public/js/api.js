// Cliente da API: URLs relativas (funciona em qualquer host/porta) e erros legíveis.

async function request(method, url, body) {
    let response;
    try {
        response = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new Error('Sem conexão com o servidor. Verifique se ele está rodando.');
    }

    if (response.status === 401) {
        window.location.assign('/login');
        throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (response.status === 204) return null;

    let data = null;
    try {
        data = await response.json();
    } catch {
        // resposta sem JSON
    }
    if (!response.ok) throw new Error(data?.error || `Erro inesperado (${response.status}).`);
    return data;
}

const employeeUrl = id => `/api/employees/${encodeURIComponent(id)}`;

export const api = {
    getState: () => request('GET', '/api/state'),
    createEmployee: data => request('POST', '/api/employees', data),
    updateEmployee: (id, data) => request('PUT', employeeUrl(id), data),
    deleteEmployee: id => request('DELETE', employeeUrl(id)),
    addSkill: nome => request('POST', '/api/skills', { nome }),
    removeSkill: nome => request('DELETE', `/api/skills/${encodeURIComponent(nome)}`),
    createSector: nome => request('POST', '/api/setores', { nome }),
    updateSector: (id, data) => request('PUT', `/api/setores/${encodeURIComponent(id)}`, data),
    deleteSector: id => request('DELETE', `/api/setores/${encodeURIComponent(id)}`),
};
