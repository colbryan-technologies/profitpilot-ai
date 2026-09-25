FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts/web-shutdown.mjs ./scripts/web-shutdown.mjs
USER node
EXPOSE 3000
# Apply migrations separately; run this image with npm run worker for workers.
CMD ["node", "--import", "./scripts/web-shutdown.mjs", "./node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
