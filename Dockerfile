FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEUSTROY_DATA_DIR=/data NEUSTROY_PORT=8787 NEUSTROY_ACCOUNT_AUTH=true
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/dist/local-api.mjs ./dist/local-api.mjs
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/local-server.mjs /app/scripts/telegram-poll.mjs ./scripts/
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/auth/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/local-server.mjs", "--lan", "--accounts"]
