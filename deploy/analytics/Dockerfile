FROM node:22-alpine

WORKDIR /app
COPY deploy/analytics/server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=8787
USER node

EXPOSE 8787
CMD ["node", "server.mjs"]
