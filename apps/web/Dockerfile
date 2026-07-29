# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (pnpm workspace), not apps/web.

# ---- build ----------------------------------------------------------------
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/fhir-client/package.json packages/fhir-client/

RUN pnpm install --frozen-lockfile --filter @clinicpilot/web...

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @clinicpilot/web build

# ---- runtime --------------------------------------------------------------
# Static SPA: nginx serves the bundle, no Node process in the running image.
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
