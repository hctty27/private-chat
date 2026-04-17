FROM golang:1.23-alpine AS build
WORKDIR /app
RUN apk add --no-cache git ca-certificates tzdata
COPY go.mod go.sum ./
RUN go env -w GOPROXY=https://proxy.golang.org,direct
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/private-chat-backend ./cmd/privatechat

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/private-chat-backend /app/private-chat-backend
EXPOSE 8080
ENTRYPOINT ["/app/private-chat-backend"]
