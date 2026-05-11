# Private Chat

> 伪装成微博的私密聊天应用 | A privacy-focused chat app disguised as a social media platform

一个 1 对 1 加密私聊系统，外观看似普通的社交媒体（"有趣"），实际是安全的聊天工具。通过伪装页保护用户隐私，点击热搜标题 3 次才能进入登录界面。

## 功能特性

- **伪装保护** - 外观模拟微博，点击 3 次进入登录页
- **实时聊天** - WebSocket 双向通信，消息即时送达
- **文件分享** - 支持图片、视频、文件上传（最大 50MB）
- **已读状态** - 消息已读/未读实时反馈
- **表情支持** - 内置 Emoji 表情选择器
- **单点登录** - 新设备登录自动踢掉旧连接
- **移动适配** - 针对 iOS/移动端优化的固定布局

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.22 + Gin + GORM + JWT + WebSocket |
| 前端 | Vue 3 + TypeScript + Pinia + Element Plus + Tailwind CSS 4 |
| 数据库 | PostgreSQL + Redis |
| 文件存储 | Cloudflare R2 (S3 兼容) |
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
git clone https://github.com/yourusername/private-chat.git
cd private-chat
```

2. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，填入你的配置
```

3. 启动服务
```bash
docker compose up -d
```

4. 访问应用
- 前端：http://localhost（或配置的域名）
- 后端 API：http://localhost:8080

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
npm install
npm run dev
```

## 项目结构

```
private-chat/
├── backend/                      # Go 后端
│   ├── cmd/privatechat/main.go   # 入口
│   ├── internal/
│   │   ├── app/                  # 路由、Handler、WebSocket
│   │   ├── auth/                 # JWT 认证
│   │   ├── config/               # 配置加载
│   │   ├── model/                # 数据模型
│   │   └── platform/db/          # 数据库连接
│   └── Dockerfile
├── frontend/                     # Vue 3 前端
│   ├── src/
│   │   ├── views/                # 页面组件
│   │   ├── components/           # 通用组件
│   │   ├── stores/               # Pinia 状态管理
│   │   ├── api/                  # API 请求封装
│   │   └── composables/          # 组合式函数
│   ├── nginx.conf
│   └── Dockerfile
├── compose.yml                   # Docker Compose 配置
├── init.sql                      # 数据库初始化脚本
└── .env.example                  # 环境变量示例
```

## API 文档

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT |

### 联系人 & 消息

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/contacts` | 获取联系人列表 |
| GET | `/api/messages/:targetId` | 获取历史消息（游标分页） |

### 文件

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/file/upload` | 文件上传 |
| GET | `/api/file/download/:objectName` | 文件下载 |

### WebSocket

连接地址：`ws://host/ws/chat?token=<JWT>`

**客户端消息类型**
- `chat` - 发送消息
- `read` - 标记已读
- `heartbeat` - 心跳保活

**服务端消息类型**
- `chat` - 接收消息
- `read` - 已读通知
- `online` - 在线状态
- `kicked` - 被踢下线

## 数据库

### 核心表

- `t_user` - 用户表
- `t_relation` - 好友关系表
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

| 用户名 | 密码 | 昵称 |
|--------|------|------|
| alice | 123456 | 爱丽丝 |
| bob | 123456 | 鲍勃 |
| charlie | 123456 | 查理 |

## 配置说明

参考 `.env.example` 文件：

- `JWT_SECRET` - JWT 签名密钥（务必修改）
- `POSTGRES_*` - PostgreSQL 连接配置
- `REDIS_*` - Redis 连接配置
- `R2_*` - Cloudflare R2 文件存储配置

## 许可证

MIT License
