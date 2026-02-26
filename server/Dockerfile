# 旧 Node 后端部署用 Dockerfile（如仍需使用 Node 版本后端，可指向此目录）
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

WORKDIR /app
EXPOSE 3001

CMD ["node", "server.js"]

