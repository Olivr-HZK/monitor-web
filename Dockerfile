# 后端部署用。Railway 检测到 Dockerfile 时会用其构建（可暂时将 railpack.json 改名为 .bak 以使用本文件）。
FROM node:20-slim

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install --production

COPY server/ ./server/

WORKDIR /app/server
EXPOSE 3001

CMD ["node", "server.js"]
