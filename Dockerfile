# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS prod-deps
RUN npm ci --omit=dev --ignore-scripts

FROM base AS build
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY examples ./examples
COPY browser ./browser
COPY public ./public
# tsc -> dist/, esbuild -> public/wallet-test.bundle.js
RUN npm run build

FROM node:24-alpine
# NODE_ENV is not set here: the deployment sets it (agentsmith-infra weather-x402/README.md). With
# NODE_ENV=production the application requires an HTTPS PUBLIC_BASE_URL.
ENV HOST=0.0.0.0 PORT=8408
USER node
WORKDIR /app
# package.json carries "type": "module", which Node needs to load dist/ as ES modules.
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Served as static files from process.cwd()/public (wallet-test page and its bundle).
COPY --from=build --chown=node:node /app/public ./public
EXPOSE 8408
CMD ["node", "dist/src/index.js"]
