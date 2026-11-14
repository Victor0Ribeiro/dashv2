# Imagem de produção do Radar de Talentos.
# A planilha fica num volume persistente em /data. O volume é criado na hospedagem
# (ex.: Railway Volumes), não aqui: o Railway rejeita a instrução VOLUME no Dockerfile.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_FILE=/data/funcionarios.xlsx

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /data && chown -R node:node /data

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

# No primeiro boot, copia a planilha do repositório para o volume (se ainda não existir).
CMD ["sh", "-c", "[ -f \"$DATA_FILE\" ] || cp /app/funcionarios.xlsx \"$DATA_FILE\"; exec node server.js"]
