# API + herramienta de administración (binarios estáticos).
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/admin ./cmd/admin

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata wget && adduser -D -u 10001 app
COPY --from=build /out/api /out/admin /app/
USER app
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["/app/api"]
