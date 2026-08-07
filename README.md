# Private Chat

> 伪装成微博的私密聊天应用 | A privacy-focused chat app disguised as a social media platform

一个 1 对 1 私聊系统，外观看似普通的社交媒体（“有趣”），实际提供实时聊天、文件分享和伪装入口。通过伪装页保护使用场景隐私，点击热搜标题 3 次才能进入登录界面。

> **安全边界说明：** 当前版本依赖 HTTPS/WSS 保护传输，并通过服务端鉴权控制会话访问；消息和文件不是端到端加密，服务端与数据库仍可读取内容。不要将当前实现描述为 E2EE。

## 功能特性

- **伪装保护** - 外观模拟微博，点击 3 次进入登录页
- **实时聊天** - WebSocket 双向通信，消息即时送达
- **文件分享** - 支持图片、视频、文件直传 Cloudflare R2
- **文件会话授权** - 上传文件绑定发送者和会话，确认真实对象后才允许发送或访问
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

3. 已有数据库升级时，先执行迁移：

```bash
psql "$DATABASE_URL" -f migrations/20260807_file_security_up.sql
```

迁移会创建 `t_file`、增加 `t_message.file_id`，并把旧的 `/api/file/download/{objectName}` 附件消息映射为文件记录。旧 `file_url/file_name/file_size` 字段暂时保留用于兼容和回滚。

全新数据库直接执行 `init.sql` 即可。

4. 为浏览器直传/直下配置 R2 Bucket CORS。生产环境应把 `https://chat.example.com` 替换为真实前端 Origin，不要使用 `*`：

```json
[
  {
    "AllowedOrigins": ["https://chat.example.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

R2 Presigned URL 是临时 bearer credential。Bucket 应保持私有，不要把 Presigned URL 写入数据库或聊天消息；应用只保存 `fileId` 和服务端拥有的对象元数据。

5. 启动服务

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
├── migrations/
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
| POST | `/api/file/presign-upload` | 创建 pending 文件记录并获取 1 小时 R2 Presigned PUT；请求必须包含 `receiverId` |
| POST | `/api/files/:fileId/complete` | 上传后由服务端校验 R2 实际大小并读取前 512 字节识别 MIME，成功后标记 ready |
| GET | `/api/files/:fileId/content` | 校验当前用户属于文件会话后，302 到 10 分钟 Presigned GET |
| POST | `/api/file/upload` | 旧后端代理上传接口，兼容窗口保留，不用于新的文件消息 |
| GET | `/api/file/download/:objectName` | 旧对象名下载接口，兼容窗口保留，不用于新的文件消息 |

新的附件消息只通过 `fileId` 绑定服务端确认过的文件。客户端提供的 `fileUrl`、文件名或文件大小不作为对象归属的可信依据。

聊天历史中的图片/视频继续使用稳定的同源地址 `/api/files/{fileId}/content`。后端每次访问先进行登录和会话授权，再生成短期 R2 URL，因此数据库不会持久化会过期的签名 URL。

检测为 JPEG、PNG、GIF、WebP、MP4 或 AVI 的媒体可 inline 展示；其他类型按附件下载并使用 `application/octet-stream`，减少浏览器对不可信主动内容的解释风险。

### WebSocket

连接地址：`ws://host/ws/chat?token=<JWT>`。新登录会话也会携带 HttpOnly Cookie；查询参数 Token 仅用于兼容现有客户端，后续版本将移除。

**客户端消息类型**

- `chat` - 发送消息；图片/文件/视频消息必须包含已确认的 `fileId`
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
- `t_file` - 文件对象、上传者、会话、真实大小/MIME 和状态元数据
- `t_message` - 消息表，附件消息通过 `file_id` 引用 `t_file`

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
