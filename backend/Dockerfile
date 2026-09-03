# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
ARG IP2REGION_VERSION=v3.17.0
WORKDIR /app
RUN apk add --no-cache git ca-certificates tzdata
RUN go env -w GOPROXY=https://proxy.golang.org,direct
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/private-chat-backend ./cmd/privatechat
RUN mkdir -p /out/ip2region \
    && wget -q -O /out/ip2region/ip2region_v4.xdb "https://raw.githubusercontent.com/lionsoul2014/ip2region/${IP2REGION_VERSION}/data/ip2region_v4.xdb" \
    && wget -q -O /out/ip2region/ip2region_v6.xdb "https://raw.githubusercontent.com/lionsoul2014/ip2region/${IP2REGION_VERSION}/data/ip2region_v6.xdb"

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/private-chat-backend /app/private-chat-backend
COPY --from=build /out/ip2region/ /app/data/
EXPOSE 8080
ENTRYPOINT ["/app/private-chat-backend"]
