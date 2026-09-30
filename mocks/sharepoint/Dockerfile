# Build context is mocks/ so the image can include seed/directory.json.
FROM node:22-alpine AS base
WORKDIR /app/sharepoint
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
COPY sharepoint/package.json sharepoint/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
COPY --from=deps /app/sharepoint/node_modules ./node_modules
COPY sharepoint/package.json sharepoint/tsconfig.json ./
COPY sharepoint/src ./src
RUN ./node_modules/.bin/tsc

FROM node:22-alpine AS prod
WORKDIR /app/sharepoint
COPY --from=build /app/sharepoint/dist ./dist
COPY --from=deps /app/sharepoint/node_modules ./node_modules
COPY sharepoint/package.json sharepoint/sharepoint.meta.json ./
COPY sharepoint/library ./library
COPY sharepoint/history ./history
COPY sharepoint/live ./live
COPY seed /app/seed
ENV NODE_ENV=production
EXPOSE 4020
CMD ["node", "dist/server.js"]
