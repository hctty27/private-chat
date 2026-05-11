# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /app
RUN apk add --no-cache git ca-certificates tzdata
RUN go env -w GOPROXY=https://proxy.golang.org,direct
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/private-chat-backend ./cmd/privatechat

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/private-chat-backend /app/private-chat-backend
EXPOSE 8080
ENTRYPOINT ["/app/private-chat-backend"]
