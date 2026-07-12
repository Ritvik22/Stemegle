FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node server ./server

ENV NODE_ENV=production

USER node

CMD ["npm", "run", "db:migrate"]
