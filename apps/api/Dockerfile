# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (pnpm workspace), not apps/api.

# ---- build ----------------------------------------------------------------
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo

# Every workspace manifest first: pnpm validates the lockfile against the full
# workspace, and copying manifests before source keeps the install layer cached
# across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/fhir-client/package.json packages/fhir-client/

RUN pnpm install --frozen-lockfile --filter @clinicpilot/api...

COPY packages packages
COPY apps/api apps/api

# The trailing `...` selects the API *and its workspace dependencies*, so
# shared-types and fhir-client are compiled to their dist/ first. Without it the
# API's own build fails with "Cannot find module '@clinicpilot/shared-types'" —
# their package.json `main` points at dist/, which only exists after a build.
# This passes locally either way, because local dist/ is already there from a
# previous `pnpm build`; only a clean context catches it.
RUN pnpm --filter "@clinicpilot/api..." build

# ---- runtime --------------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/api

# pnpm symlinks apps/api/node_modules into the root store, so both trees have
# to come across together or the links dangle.
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./package.json

# apps/api/node_modules/@clinicpilot/* are symlinks into /repo/packages. Ship
# the real directories or every workspace import resolves to a dangling link
# and the process dies on its first require.
COPY --from=build /repo/packages /repo/packages

USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
