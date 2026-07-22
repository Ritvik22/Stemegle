FROM debian:bookworm-slim AS sandbox-build

RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc libseccomp-dev \
  && rm -rf /var/lib/apt/lists/*
COPY code-runner/sandbox.c /tmp/sandbox.c
RUN gcc -O2 -Wall -Wextra /tmp/sandbox.c -lseccomp -o /tmp/codegle-sandbox

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 g++ default-jdk-headless libseccomp2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /runner
COPY --from=sandbox-build /tmp/codegle-sandbox /usr/local/bin/codegle-sandbox
COPY --chown=root:root code-runner/runner.mjs ./runner.mjs

ENV NODE_ENV=production
ENV PORT=8080
ENV CODEGLE_SANDBOX_COMMAND=/usr/local/bin/codegle-sandbox
ENV CODEGLE_SANDBOX_UID=65534
ENV CODEGLE_SANDBOX_GID=65534
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=4s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "runner.mjs"]
