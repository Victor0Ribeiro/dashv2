// Mostra a mensagem de erro enviada pelo servidor via ?erro=... (sem alert/script injetado).

const MESSAGES = {
    credenciais: 'Usuário ou senha inválidos.',
    bloqueado: 'Muitas tentativas sem sucesso. Aguarde alguns minutos e tente novamente.',
};

const code = new URLSearchParams(window.location.search).get('erro');
const message = MESSAGES[code];

if (message) {
    const errorBox = document.getElementById('login-error');
    errorBox.textContent = message;
    errorBox.hidden = false;
    document.getElementById('usuario').focus();
    // Limpa o parâmetro para a mensagem não reaparecer ao recarregar.
    window.history.replaceState(null, '', window.location.pathname);
}
