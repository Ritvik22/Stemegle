FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server ./server
COPY --chown=node:node src/data ./src/data

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
EXPOSE 8787

USER node

HEALTHCHECK --interval=15s --timeout=5s --retries=8 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
