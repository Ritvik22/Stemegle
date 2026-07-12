FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm test \
  && npm run check:questions \
  && npm run build

CMD ["npm", "test"]
