FROM node:22-alpine AS build
WORKDIR /app
# Railway builds the Web image and Worker image at the same time. Bound npm's
# network concurrency and V8 heap so dependency installation remains inside
# the builder's memory allowance instead of being terminated with exit 137.
ENV NODE_OPTIONS=--max-old-space-size=384 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    npm_config_maxsockets=1 \
    npm_config_jobs=1
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
# The lockfile is part of the release contract. Ignore lifecycle scripts here;
# Prisma generation runs explicitly in the build command below.
RUN npm ci --ignore-scripts
COPY . .
# Public browser configuration is served by /runtime-config.js at container
# startup, so build artifacts never depend on Railway build arguments. Prisma
# generation validates the URL format but does not connect during build.
# Keep this value scoped to the build command so no runtime image or service can
# accidentally treat it as a database credential.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
RUN chown -R app:app /app
USER app
EXPOSE 3000
# The shared production image runs either the HTTP service or the BullMQ worker.
# Workers deliberately expose no HTTP port; their liveness is the container
# process, while readiness is enforced by the database heartbeat checked by the
# Web service. SERVICE_KIND avoids applying the Web HTTP probe to Worker images.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD node -e "if(process.env.SERVICE_KIND==='worker')process.exit(0);const port=process.env.PORT||3000;fetch(`http://127.0.0.1:${port}/api/health/ready`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/entrypoint.cjs"]
