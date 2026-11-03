# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM ${NODE_IMAGE} AS base
ARG VERSION
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="LogiParity" \
      org.opencontainers.image.description="Test/staging logistics parity and disruption checks" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="Sergei Orekhovskii" \
      org.opencontainers.image.source="https://github.com/Nutts5796/logiparity"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /work
RUN chown node:node /work
FROM base AS package
# Both profiles install the exact signed CLI archive and locked dependency bytes from the verified kit.
RUN --mount=type=bind,source=output/release,target=/release,ro \
    cd /release \
 && sha256sum --check logiparity-${VERSION}.tgz.sha256 \
 && sha256sum --check logiparity-offline-${VERSION}.tgz.sha256 \
 && mkdir /tmp/offline-kit \
 && tar -xzf logiparity-offline-${VERSION}.tgz -C /tmp/offline-kit \
 && cmp logiparity-${VERSION}.tgz /tmp/offline-kit/logiparity-offline-${VERSION}/logiparity-${VERSION}.tgz \
 && node /tmp/offline-kit/logiparity-offline-${VERSION}/install.mjs default /opt/logiparity \
 && ln -s /opt/logiparity/node_modules/.bin/logiparity /usr/local/bin/logiparity \
 && rm -rf /tmp/offline-kit /opt/logiparity/logiparity-${VERSION}.tgz
FROM package AS slim
USER node
ENTRYPOINT ["logiparity"]
CMD ["--help"]
FROM base AS runtime
RUN --mount=type=bind,source=output/release,target=/release,ro \
    cd /release \
 && sha256sum --check logiparity-${VERSION}.tgz.sha256 \
 && sha256sum --check logiparity-offline-${VERSION}.tgz.sha256 \
 && mkdir /tmp/offline-kit \
 && tar -xzf logiparity-offline-${VERSION}.tgz -C /tmp/offline-kit \
 && cmp logiparity-${VERSION}.tgz /tmp/offline-kit/logiparity-offline-${VERSION}/logiparity-${VERSION}.tgz \
 && node /tmp/offline-kit/logiparity-offline-${VERSION}/install.mjs full /opt/logiparity \
 && ln -s /opt/logiparity/node_modules/.bin/logiparity /usr/local/bin/logiparity \
 && rm -rf /tmp/offline-kit /opt/logiparity/logiparity-${VERSION}.tgz
RUN node /opt/logiparity/node_modules/playwright/cli.js install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /var/lib/apt/lists/* /root/.cache
USER node
ENTRYPOINT ["logiparity"]
CMD ["--help"]
