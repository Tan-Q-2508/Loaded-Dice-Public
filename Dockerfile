# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Set explicitly (matching what Railway injects at build time) so this stage
# behaves the same in a plain local `docker build` as it does on Railway:
# npm's legacy `production` config defaults to true whenever NODE_ENV=production
# is set, which makes `npm ci` omit devDependencies (including typescript),
# so the `tsc` build step below fails. `--include=dev` keeps the compiler
# available regardless of NODE_ENV.
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/engine/package.json packages/engine/
COPY packages/db/package.json packages/db/
COPY packages/socket-api/package.json packages/socket-api/
COPY packages/auth/package.json packages/auth/
COPY packages/lobby/package.json packages/lobby/
COPY packages/reconnect/package.json packages/reconnect/
COPY packages/server/package.json packages/server/
COPY packages/sim/package.json packages/sim/
COPY packages/web/package.json packages/web/
RUN npm ci --include=dev

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build --workspace=@shaatir-shakuni/engine \
 && npm run build --workspace=@shaatir-shakuni/db \
 && npm run build --workspace=@shaatir-shakuni/socket-api \
 && npm run build --workspace=@shaatir-shakuni/auth \
 && npm run build --workspace=@shaatir-shakuni/lobby \
 && npm run build --workspace=@shaatir-shakuni/reconnect \
 && npm run build --workspace=@shaatir-shakuni/server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/server/dist/main.js"]
