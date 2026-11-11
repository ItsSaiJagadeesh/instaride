# InstaRide backend image: builds the server, installs only its three runtime packages, runs as a non-root user.
# Build from the project folder:  docker build -t instaride .   (the deploy pack does this for you)

FROM node:20-bookworm-slim AS build
WORKDIR /build
RUN npm install --no-save --no-audit --no-fund esbuild@0.24.2
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
RUN npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=5000 \
    UPLOADS_DIR=/data/uploads
WORKDIR /app
COPY deploy/server.package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /build/server_dist ./server_dist
COPY admin-web ./admin-web
COPY track-web ./track-web
COPY legal ./legal
COPY assets ./assets
COPY app.json ./app.json
COPY server/templates ./server/templates
RUN mkdir -p /data/uploads && chown -R node:node /app /data
USER 1000:1000
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server_dist/index.js"]
