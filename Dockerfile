FROM node:26.10.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/platform/package.json apps/platform/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY database ./database
RUN pnpm --filter @chibbo/platform build

FROM node:26.10.0-bookworm-slim AS runtime
WORKDIR /app
# Trust only the current Amazon RDS root-CA bundle in addition to Node's
# standard trust store. This lets pg verify the private RDS endpoint rather
# than accepting any certificate presented inside the VPC.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl --fail --location --silent --show-error \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    --output /app/rds-ca-bundle.pem \
  && chmod 0444 /app/rds-ca-bundle.pem \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca-bundle.pem
COPY --from=build /workspace/apps/platform/.next/standalone ./
COPY --from=build /workspace/apps/platform/.next/static ./apps/platform/.next/static
COPY --from=build /workspace/apps/platform/scripts ./apps/platform/scripts
COPY --from=build /workspace/database ./database
USER node
EXPOSE 3000
CMD ["node", "apps/platform/server.js"]
