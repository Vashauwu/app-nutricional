# Build de producción de la PWA (Angular) y servido con Caddy (HTTPS automático).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build

FROM caddy:2-alpine
COPY --from=build /app/dist/frontend/browser /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
