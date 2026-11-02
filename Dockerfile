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
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN npm run build \
 && mkdir /release \
 && npm pack --ignore-scripts --pack-destination /release

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="LogiParity" \
      org.opencontainers.image.description="Test/staging logistics parity and disruption checks" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="Sergei Orekhovskii"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=dependencies /build/node_modules/playwright /tmp/browser/node_modules/playwright
COPY --from=dependencies /build/node_modules/playwright-core /tmp/browser/node_modules/playwright-core
RUN node /tmp/browser/node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /tmp/browser /var/lib/apt/lists/*
COPY --from=build /release/logiparity-1.0.0.tgz /tmp/logiparity.tgz
RUN npm install --global --offline --ignore-scripts --no-audit --no-fund /tmp/logiparity.tgz \
 && rm /tmp/logiparity.tgz \
 && npm cache clean --force \
 && mkdir -p /work \
 && chown node:node /work
USER node
WORKDIR /work
ENTRYPOINT ["logiparity"]
CMD ["--help"]
