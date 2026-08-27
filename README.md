# Private Chat

> 伪装成微博的私密聊天应用 | A privacy-focused chat app disguised as a social media platform

一个 1 对 1 私聊系统，外观看似普通的社交媒体（“有趣”），实际提供实时聊天、文件分享和伪装入口。通过伪装页保护使用场景隐私，点击热搜标题 3 次才能进入登录界面。

> **安全边界说明：** 当前版本依赖 HTTPS/WSS 保护传输，并通过服务端鉴权控制会话访问；消息和文件不是端到端加密，服务端与数据库仍可读取内容。不要将当前实现描述为 E2EE。

## 功能特性

- **伪装保护** - 外观模拟微博，点击 3 次进入登录页
- **实时聊天** - WebSocket 双向通信，消息即时送达
- **文件分享** - 支持图片、视频、文件后台直传 Cloudflare R2；图片最大 50 MiB，视频/普通文件最大 500 MiB
- **文件会话授权** - 上传文件绑定发送者和会话，确认真实对象后才允许发送或访问
- **自动数据库迁移** - Docker Compose 部署时先执行未应用的版本化 PostgreSQL migration，成功后才启动后端
- **已读状态** - 消息已读/未读实时反馈
- **表情支持** - 内置 Emoji 表情选择器
- **单点登录** - 新设备登录自动踢掉旧连接
- **联系人授权** - 历史消息、发送消息和已读回执要求联系人关系
- **移动适配** - 针对 iOS/移动端优化的固定布局

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.23+ + Gin + GORM + JWT + WebSocket |
| 前端 | Vue 3 + TypeScript + Pinia + Element Plus + Tailwind CSS 4 |
| 数据库 | PostgreSQL + Redis |
| 数据库迁移 | golang-migrate（内嵌版本化 SQL） |
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

`TIME_ZONE` 控制 Go 应用和 PostgreSQL 连接使用的时区，`TZ` 控制容器系统时区；通常保持两者一致。

3. 如果目标 PostgreSQL 是**完全空的新数据库**，首次部署先执行一次基线初始化：

```bash
psql "$DATABASE_URL" -f init.sql
```

`init.sql` 包含开发测试账号，因此生产环境首次初始化前应删除或替换测试数据。已有数据库不需要重复执行 `init.sql`。

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

上传策略：
- 图片最大 50 MiB；视频和普通文件最大 500 MiB。
- 100 MiB 及以下使用单次 Presigned PUT。
- 超过 100 MiB 自动使用 R2 Multipart Upload，分片大小 16 MiB，浏览器最多 3 路并发。
- 单个分片失败最多重试 3 次；最终失败时客户端会尽力调用 abort 接口清理未完成的 multipart upload。
- 附件确认后立即加入后台上传队列，不阻塞文字聊天、切换联系人或继续选择附件；每条消息独立显示等待、进度、取消和重试状态。
- 上传调度使用 2 个容量单位：小文件占 1 个单位，最多同时 2 个；超过 100 MiB 的大文件占满 2 个单位，避免和其他文件竞争带宽，其内部仍使用 3 路 multipart 并发。
- Multipart 完成后仍走原有 `/complete` 校验：服务端核对 R2 实际大小并检测文件 MIME，确认成功后才允许发送附件消息。

5. 构建并启动：

```bash
docker compose up -d --build
```

Compose 会先运行一次性的 `migrate` 服务。它只连接 PostgreSQL，并使用 `schema_migrations` 记录已经应用的版本：

```text
migrate
  └─ 成功退出
       └─ backend 启动
```

如果没有新 migration，`migrate` 会正常退出；如果 migration SQL、数据库连接或 migration 状态发生错误，`migrate` 会非零退出，`backend` 不会在不兼容的数据库结构上启动。

已经手工执行过 `migrations/20260807_file_security_up.sql` 的数据库也可以直接切换到自动迁移。首个受管版本会以幂等方式核对现有结构、完成缺失回填并记录 migration version，不需要再次手工执行该 SQL。

需要单独执行/检查迁移时可以运行：

```bash
docker compose run --rm migrate
```

如果 `schema_migrations` 处于 dirty 状态，应用不会自动 `force` 版本。应先确认失败 SQL 和实际数据库结构，再由维护者显式修复 migration 状态；部署流程也不会自动执行 destructive rollback。

### 本地开发

**后端**

```bash
cd backend
go mod download
go run ./cmd/privatechat
```

单独应用本地数据库 migration：

```bash
go run ./cmd/privatechat migrate
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
│   │   ├── migration/
│   │   │   └── sql/
│   │   ├── model/
│   │   └── platform/db/
│   └── Dockerfile
├── frontend/
│   ├── src/
│   ├── nginx.conf
│   └── Dockerfile
├── migrations/                 # 旧版显式 migration / smoke-test 兼容文件
├── compose.yml
├── init.sql
└── .env.example
```

## API 文档

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，设置 HttpOnly 会话 Cookie；响应只返回用户身份信息 |
| POST | `/api/auth/logout` | 注销当前会话并关闭当前 WebSocket |

### 联系人与消息

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/contacts` | 获取联系人列表 |
| GET | `/api/messages/:targetId` | 获取联系人历史消息（游标分页） |

### 文件

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/file/presign-upload` | 创建 pending 文件记录并返回单次 PUT 或 multipart 分片上传计划；请求必须包含 `receiverId` |
| POST | `/api/files/:fileId/complete` | 单次上传直接确认；multipart 上传先提交各分片 ETag 完成合并，再校验 R2 实际大小和 MIME，成功后标记 ready |
| POST | `/api/files/:fileId/multipart/abort` | 取消 multipart 上传并清理 R2 未完成上传 |
| GET | `/api/files/:fileId/content` | 校验当前用户属于文件会话后，302 到 10 分钟 Presigned GET |
| GET | `/api/file/download/:objectName` | 仅用于迁移前历史链接；仍执行文件会话授权，后续兼容窗口结束后删除 |

新的附件消息只通过 `fileId` 绑定服务端确认过的文件。客户端提供的 `fileUrl`、文件名或文件大小不作为对象归属的可信依据。旧的后端代理上传接口不再暴露，避免绕开 `fileId` 生命周期制造孤儿对象。

聊天历史中的图片/视频继续使用稳定的同源地址 `/api/files/{fileId}/content`。后端每次访问先进行登录和会话授权，再生成短期 R2 URL，因此数据库不会持久化会过期的签名 URL。迁移前没有 MIME 检测结果的历史媒体会在首次访问时读取最多 512 字节重新识别，因此旧图片/视频仍能按实际类型展示。

检测为 JPEG、PNG、GIF、WebP、MP4 或 AVI 的媒体可 inline 展示；其他类型按附件下载并使用 `application/octet-stream`，减少浏览器对不可信主动内容的解释风险。

### WebSocket

HTTP API 和 WebSocket 都只使用浏览器自动携带的 `private_chat_session` HttpOnly Cookie 鉴权。浏览器不会把 JWT 保存到 `localStorage`，HTTP `Authorization: Bearer ...`、WebSocket 查询参数 `?token=<JWT>` 和 WebSocket `Authorization` Header 都不参与会话鉴权。连接地址：`ws://host/ws/chat`（生产环境使用 `wss://`）。

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
- `schema_migrations` - golang-migrate 自动维护的 migration version / dirty 状态

版本化 migration 位于 `backend/internal/migration/sql/`，编译时嵌入后端二进制。新增 schema 变更时应添加新的 `*.up.sql` / `*.down.sql` 版本，而不是修改已经在线上应用过的 migration 内容。

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

- `TIME_ZONE` - Go 应用及 PostgreSQL 连接使用的时区
- `JWT_SECRET` - JWT 签名密钥，必填且至少 32 字符
- `JWT_EXPIRATION` - 登录有效期
- `AUTH_COOKIE_SECURE` - HTTPS 环境必须为 `true`
- `WS_ALLOWED_ORIGINS` - 可选的跨域 WebSocket Origin 白名单
- `TRUSTED_PROXIES` - Gin 可信代理 IP/CIDR
- `POSTGRES_*` - PostgreSQL 连接配置；`migrate` 和 backend 共用
- `REDIS_*` - Redis 连接配置
- `R2_*` - Cloudflare R2 文件存储配置

## 质量检查

GitHub Actions 会执行：

```bash
cd backend
go mod download
gofmt -l .
go test ./...
go vet ./...

cd ../frontend
npm ci
npm run test -- src/api/imageUpload.test.ts src/composables/useAttachmentIngress.test.ts src/utils/uploadQueue.test.ts src/stores/chat.test.ts src/components/MessageStatusIndicator.test.ts
npm run build
```

CI 还会：

- 启动 PostgreSQL 16；
- 在旧版 schema 上执行真实的 `private-chat-backend migrate`；
- 校验 `schema_migrations` 版本和 dirty 状态；
- 第二次执行 migration 验证幂等性；
- 用当前 `init.sql` 创建另一套数据库并验证可安全接管；
- smoke-test down migration；
- 执行 `docker compose config --quiet` 校验部署配置。

## 许可证

MIT License
