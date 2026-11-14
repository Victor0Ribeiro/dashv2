# Imagem de produção do Radar de Talentos.
# A planilha fica num volume persistente em /data. O volume é criado na hospedagem
# (ex.: Railway Volumes), não aqui: o Railway rejeita a instrução VOLUME no Dockerfile.
FROM node:22-alpine

# su-exec: inicia como root só para ajustar o dono do volume e depois roda o app como "node".
RUN apk add --no-cache su-exec

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_FILE=/data/funcionarios.xlsx

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

# O volume é montado pela hospedagem como root: ajusta o dono, copia a planilha do
# repositório no primeiro boot (se ainda não existir) e roda o servidor sem privilégios.
CMD ["sh", "-c", "DIR=$(dirname \"$DATA_FILE\") && mkdir -p \"$DIR\" && chown -R node:node \"$DIR\" && { [ -f \"$DATA_FILE\" ] || su-exec node cp /app/funcionarios.xlsx \"$DATA_FILE\"; } && exec su-exec node node server.js"]
