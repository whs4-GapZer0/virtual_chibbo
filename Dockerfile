FROM node:22.14.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/platform/package.json apps/platform/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY database ./database
RUN pnpm --filter @chibbo/platform build

FROM node:22.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /workspace/apps/platform/.next/standalone ./
COPY --from=build /workspace/apps/platform/.next/static ./apps/platform/.next/static
COPY --from=build /workspace/apps/platform/scripts ./apps/platform/scripts
COPY --from=build /workspace/database ./database
USER node
EXPOSE 3000
CMD ["node", "apps/platform/server.js"]
