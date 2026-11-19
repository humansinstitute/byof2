FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.4
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/byo.sqlite
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/src ./src
COPY --from=build /app/examples ./examples
COPY --from=build /app/integration ./integration
COPY --from=build /app/pipelines ./pipelines
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e 'const r=await fetch("http://localhost:"+process.env.PORT+"/health");process.exit(r.ok?0:1)'
CMD ["bun", "src/server.ts"]
