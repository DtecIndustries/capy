# Build context is mocks/ so the image can include seed/directory.json.
FROM node:22-alpine AS base
WORKDIR /app/mail
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
COPY mail/package.json mail/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
COPY --from=deps /app/mail/node_modules ./node_modules
COPY mail/ ./
RUN ./node_modules/.bin/tsc

FROM node:22-alpine AS prod
WORKDIR /app/mail
COPY --from=build /app/mail/dist ./dist
COPY --from=deps /app/mail/node_modules ./node_modules
COPY mail/package.json mail/mailbox.jsonl ./
COPY mail/live ./live
COPY seed /app/seed
ENV NODE_ENV=production
EXPOSE 4010
CMD ["node", "dist/server.js"]
