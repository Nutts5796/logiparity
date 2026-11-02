# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/scenarios/package.json packages/scenarios/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY apps/demo-delivery/package.json apps/demo-delivery/package.json
COPY vendor/exceljs vendor/exceljs
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN npm run build \
 && mkdir /release \
 && npm pack --ignore-scripts --pack-destination /release

FROM ${NODE_IMAGE} AS base
LABEL org.opencontainers.image.title="LogiParity" \
      org.opencontainers.image.description="Test/staging logistics parity and disruption checks" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="Sergei Orekhovskii" \
      org.opencontainers.image.source="https://github.com/Nutts5796/logiparity"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /work

FROM base AS package
# Bind mounts keep the release archive out of every resulting image layer.
RUN --mount=type=bind,from=build,source=/release,target=/release,ro \
    npm install --global --offline --ignore-scripts --no-audit --no-fund /release/logiparity-1.0.0.tgz \
 && npm cache clean --force \
 && chown node:node /work

FROM package AS slim
USER node
ENTRYPOINT ["logiparity"]
CMD ["--help"]

FROM base AS browsers
# The installer and its JavaScript dependencies exist only in this mount.
RUN --mount=type=bind,from=dependencies,source=/build/node_modules,target=/tmp/browser/node_modules,ro \
    node /tmp/browser/node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.cache

FROM browsers AS runtime
COPY --from=package /usr/local/lib/node_modules/logiparity /usr/local/lib/node_modules/logiparity
RUN ln -s ../lib/node_modules/logiparity/bin/logiparity.js /usr/local/bin/logiparity \
 && chown node:node /work
USER node
ENTRYPOINT ["logiparity"]
CMD ["--help"]
