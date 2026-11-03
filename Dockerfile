# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM ${NODE_IMAGE} AS package
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
# The same checksum-verified archive is published to npm and installed in both images.
RUN --mount=type=bind,source=output/release,target=/release,ro \
    cd /release \
 && sha256sum --check logiparity-${VERSION}.tgz.sha256 \
 && npm install --global --offline --ignore-scripts /release/logiparity-${VERSION}.tgz \
 && npm cache clean --force \
 && chown node:node /work
FROM package AS slim
USER node
ENTRYPOINT ["logiparity"]
CMD ["--help"]
FROM package AS runtime
RUN node /usr/local/lib/node_modules/logiparity/node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.cache
USER node
ENTRYPOINT ["logiparity"]
CMD ["--help"]
