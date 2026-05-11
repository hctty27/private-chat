# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

私聊系统 — 伪装成微博（"有趣"）的 1 对 1 加密聊天应用。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.22 + Gin + GORM + JWT + WebSocket |
| 前端 | Vue 3 + TypeScript + Pinia + Element Plus + Tailwind CSS 4 |
| 数据库 | PostgreSQL + Redis |
| 文件存储 | Cloudflare R2 (S3 兼容) |
| 部署 | Docker Compose + Nginx |

## 常用命令

```bash
# 后端构建
cd backend && go build ./cmd/privatechat

# 前端开发
cd frontend && npm run dev

# 前端构建
cd frontend && npm run build

# Docker 部署
docker compose build --no-cache
docker compose up -d

# 查看日志
docker logs private-chat-backend --tail 50
docker logs private-chat-frontend --tail 50
```

## 架构要点

### 后端 (backend/)

- 入口: `cmd/privatechat/main.go` → `internal/app/app.go`
- 路由: Gin 路由定义在 `app.go` 的 `routes()` 方法
- WebSocket: Hub 模式管理连接，支持单点登录（新登录踢掉旧连接）
- ORM: GORM，模型定义在 `internal/model/model.go`
- 文件上传: 支持直传 R2（presign）和通过后端代理上传

### 前端 (frontend/)

- 状态管理: Pinia stores (`stores/chat.ts`, `stores/user.ts`)
- 路由: `router/index.ts`
- API 封装: `api/index.ts`（Axios）
- UI: Element Plus + Tailwind CSS 4

### 关键设计

1. **伪装页**: `CoverPage.vue`，标题"有趣"，点击 3 次进入登录页
2. **conversation_id**: 两个用户 ID 排序后用 `_` 拼接（如 `1_2`）
3. **消息类型**: 1=文本, 2=图片, 3=文件, 4=emoji
4. **已读状态**: 前端 IntersectionObserver 检测消息进入视口才标已读
5. **文件下载**: 通过后端 API 代理，不直接暴露 R2

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 登录（username/password → JWT） |
| GET | /api/contacts | 联系人列表 |
| GET | /api/messages/:targetId | 历史消息（游标分页） |
| POST | /api/file/upload | 文件上传（multipart） |
| GET | /api/file/download/:objectName | 文件下载 |

## WebSocket 协议

连接: `ws://host/ws/chat?token=<JWT>`

客户端→服务端:
- `{ "type": "chat", "data": { "receiverId", "msgType", "content", "fileUrl", "fileName", "fileSize" } }`
- `{ "type": "read", "data": { "targetId" } }`
- `{ "type": "heartbeat", "data": {} }`

服务端→客户端:
- `{ "type": "chat", "data": { /* Message 对象 */ } }`
- `{ "type": "read", "data": { "readerId", "conversationId" } }`
- `{ "type": "online", "data": { "userId", "online" } }`
- `{ "type": "kicked", "data": {} }`

## 环境变量

参考 `.env.example`，主要配置:
- `JWT_SECRET`: JWT 签名密钥
- `POSTGRES_*`: PostgreSQL 连接配置
- `REDIS_*`: Redis 连接配置
- `R2_*`: Cloudflare R2 文件存储配置

## 注意事项

1. 前端 Nginx 代理 `/api` 和 `/ws` 到后端 8080 端口
2. 开发时 Vite 也会代理 `/api` 和 `/ws` 到 localhost:8080
3. 数据库使用 Neon 托管 PostgreSQL（需 SSL）
4. 文件存储使用 Cloudflare R2，通过后端 API 代理访问
