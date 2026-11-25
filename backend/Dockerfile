FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]
