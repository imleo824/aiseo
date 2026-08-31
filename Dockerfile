FROM node:22-alpine AS build
WORKDIR /app
# Railway injects service variables into Docker builds only when declared as
# build arguments. These values are intentionally public: Vite embeds them in
# the browser bundle. Do not add server-only secrets here.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ARG VITE_RELEASE
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE \
    VITE_RELEASE=$VITE_RELEASE
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Prisma generation validates the URL format but does not connect during build.
# Keep this value scoped to the build command so no runtime image or service can
# accidentally treat it as a database credential.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
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
