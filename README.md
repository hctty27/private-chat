# Private Chat

> 伪装成微博的私密聊天应用 | A privacy-focused chat app disguised as a social media platform

一个 1 对 1 私聊系统，外观看似普通的社交媒体（“有趣”），实际提供实时聊天、文件分享和伪装入口。通过伪装页保护使用场景隐私，点击热搜标题 3 次才能进入登录界面。

> **安全边界说明：** 当前版本依赖 HTTPS/WSS 保护传输，并通过服务端鉴权控制会话访问；消息和文件不是端到端加密，服务端与数据库仍可读取内容。不要将当前实现描述为 E2EE。

## 功能特性

- **伪装保护** - 外观模拟微博，点击 3 次进入登录页
- **实时聊天** - WebSocket 双向通信，消息即时送达
- **文件分享** - 支持图片、视频、文件上传
- **已读状态** - 消息已读/未读实时反馈
- **表情支持** - 内置 Emoji 表情选择器
- **单点登录** - 新设备登录自动踢掉旧连接
- **联系人授权** - 历史消息、发送消息和已读回执要求联系人关系
- **移动适配** - 针对 iOS/移动端优化的固定布局

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.22+ + Gin + GORM + JWT + WebSocket |
| 前端 | Vue 3 + TypeScript + Pinia + Element Plus + Tailwind CSS 4 |
| 数据库 | PostgreSQL + Redis |
| 文件存储 | Cloudflare R2（S3 兼容） |
| 部署 | Docker Compose + Nginx |

## 快速开始

### 环境要求

- Docker & Docker Compose
- PostgreSQL（或使用 Neon 托管）
- Redis
- Cloudflare R2 账号

### 部署步骤

1. 克隆项目

```bash
git clone https://github.com/hctty27/private-chat.git
cd private-chat
```

2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少配置数据库、Redis、R2 和 32 字符以上的 JWT_SECRET
```

生产环境应保持：

```dotenv
AUTH_COOKIE_SECURE=true
```

仅在本地明文 HTTP 开发时设置：

```dotenv
AUTH_COOKIE_SECURE=false
```

3. 启动服务

```bash
docker compose up -d
```

### 本地开发

**后端**

```bash
cd backend
go mod download
go run ./cmd/privatechat
```

**前端**

```bash
cd frontend
npm ci
npm run dev
```

## 项目结构

```text
private-chat/
├── backend/
│   ├── cmd/privatechat/main.go
│   ├── internal/
│   │   ├── app/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── model/
│   │   └── platform/db/
│   └── Dockerfile
├── frontend/
│   ├── src/
│   ├── nginx.conf
│   └── Dockerfile
├── compose.yml
├── init.sql
└── .env.example
```

## API 文档

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT，并设置 HttpOnly 会话 Cookie |
| POST | `/api/auth/logout` | 注销当前会话并关闭当前 WebSocket |

### 联系人与消息

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/contacts` | 获取联系人列表 |
| GET | `/api/messages/:targetId` | 获取联系人历史消息（游标分页） |

### 文件

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/file/presign-upload` | 获取 R2 预签名上传地址 |
| POST | `/api/file/upload` | 后端代理上传 |
| GET | `/api/file/download/:objectName` | 已登录用户下载文件，支持 Range |

文件下载使用同源 HttpOnly Cookie 完成浏览器认证。当前版本只验证登录状态，文件级归属授权需要后续文件元数据迁移完成。

### WebSocket

连接地址：`ws://host/ws/chat?token=<JWT>`。新登录会话也会携带 HttpOnly Cookie；查询参数 Token 仅用于兼容现有客户端，后续版本将移除。

**客户端消息类型**

- `chat` - 发送消息
- `read` - 标记已读
- `heartbeat` - 心跳保活

**服务端消息类型**

- `chat` - 接收消息
- `read` - 已读通知
- `online` - 联系人在线状态
- `heartbeat_ack` - 心跳确认
- `kicked` - 会话失效或被踢下线

WebSocket 默认只允许同源连接。额外跨域来源通过 `WS_ALLOWED_ORIGINS` 配置，多个地址使用逗号分隔。单条 WebSocket 消息最大 64 KiB。

## 数据库

### 核心表

- `t_user` - 用户表
- `t_relation` - 联系人关系表
- `t_message` - 消息表

### 消息类型

| 类型 | 说明 |
|------|------|
| 1 | 文本 |
| 2 | 图片 |
| 3 | 文件 |
| 4 | Emoji |
| 5 | 视频 |

## 测试账号

初始化脚本包含以下开发测试账号，生产环境部署前应删除或替换：

| 用户名 | 密码 | 昵称 |
|--------|------|------|
| alice | 123456 | 爱丽丝 |
| bob | 123456 | 鲍勃 |
| charlie | 123456 | 查理 |

## 配置说明

参考 `.env.example`：

- `JWT_SECRET` - JWT 签名密钥，必填且至少 32 字符
- `JWT_EXPIRATION` - 登录有效期
- `AUTH_COOKIE_SECURE` - HTTPS 环境必须为 `true`
- `WS_ALLOWED_ORIGINS` - 可选的跨域 WebSocket Origin 白名单
- `TRUSTED_PROXIES` - Gin 可信代理 IP/CIDR
- `POSTGRES_*` - PostgreSQL 连接配置
- `REDIS_*` - Redis 连接配置
- `R2_*` - Cloudflare R2 文件存储配置

## 质量检查

GitHub Actions 会执行：

```bash
cd backend
gofmt -l .
go test ./...
go vet ./...

cd ../frontend
npm ci
npm run build
```

## 许可证

MIT License
