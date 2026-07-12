FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY scripts ./scripts
COPY supabase ./supabase

CMD ["npm", "run", "db:migrate"]
