# 私聊系统技术设计文档

## 一、项目概述

一个伪装成微博的 1 对 1 加密私聊系统。用户通过伪装页进入登录页，登录后查看联系人并发起聊天。

## 二、当前技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.23 + Gin + GORM + JWT + WebSocket + MinIO |
| 前端 | Vue 3 + TypeScript + Pinia + Element Plus + Tailwind CSS 4 |
| 数据库 | PostgreSQL + Redis |
| 部署 | Docker Compose + Nginx |

## 三、当前目录

```
private-chat/
├── backend/
│   ├── Dockerfile
│   ├── cmd/privatechat/main.go
│   ├── internal/app/
│   ├── internal/auth/
│   ├── internal/config/
│   ├── internal/model/
│   ├── internal/platform/db/
│   ├── go.mod
│   └── go.sum
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
├── compose.yml
├── AGENTS.md
├── CLAUDE.md
└── DESIGN.md
```

## 四、数据库

当前使用现有的 PostgreSQL 容器，数据库名为 `private_chat`。

核心表：

- `t_user`
- `t_relation`
- `t_message`

要点：

- `conversation_id` = 两个用户 ID 排序后用 `_` 拼接
- 消息类型：`1=文本`、`2=图片`、`3=文件`、`4=emoji`

## 五、API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/contacts` | 联系人列表 |
| GET | `/api/messages/:targetId` | 历史消息 |
| POST | `/api/file/upload` | 文件上传 |
| GET | `/api/file/download/{objectName}` | 文件下载 |

## 六、WebSocket

连接：

`ws://host/ws/chat?token=<JWT>`

客户端消息：

```json
{ "type": "chat", "data": { "receiverId": 1, "msgType": 1, "content": "hello", "fileUrl": null, "fileName": null, "fileSize": null } }
{ "type": "read", "data": { "targetId": 1 } }
{ "type": "heartbeat", "data": {} }
```

服务端消息：

```json
{ "type": "chat", "data": { /* Message 对象 */ } }
{ "type": "read", "data": { "readerId": 1, "conversationId": "1_2" } }
{ "type": "online", "data": { "userId": 1, "online": true } }
{ "type": "heartbeat_ack", "data": {} }
{ "type": "kicked", "data": { "message": "您的账号在其他地方登录" } }
```

## 七、部署方式

`docker compose up -d` 会启动：

- 前端容器
- Go 后端容器

后端通过 `my-network` 访问外部的 PostgreSQL、Redis 和 MinIO 容器。
