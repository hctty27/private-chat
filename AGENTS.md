# AGENTS.md

## 项目概述
私聊系统 — 伪装成"有趣"(微博克隆)的加密聊天网站。

## 技术栈
- **后端**: Spring Boot 3.5.9 + MyBatis Plus + JWT + WebSocket + MinIO
- **前端**: Vue 3 + TypeScript + Pinia + Element Plus + Tailwind CSS 4
- **数据库**: MySQL 8.0 + Redis
- **部署**: Docker Compose（my-network 网络）

## 项目结构

```
private-chat/
├── backend/                      # Spring Boot 后端
│   ├── src/main/java/com/privatechat/
│   │   ├── PrivateChatApplication.java
│   │   ├── config/               # 配置类
│   │   │   ├── SecurityConfig.java
│   │   │   ├── WebSocketConfig.java
│   │   │   ├── JwtAuthFilter.java
│   │   │   ├── MinioConfig.java
│   │   │   └── MybatisPlusConfig.java
│   │   ├── controller/           # REST 控制器
│   │   │   ├── AuthController.java      # 登录
│   │   │   ├── ContactController.java   # 联系人
│   │   │   ├── MessageController.java   # 消息查询
│   │   │   └── FileController.java      # 文件上传/下载
│   │   ├── service/              # 业务接口
│   │   │   └── impl/             # 实现类
│   │   ├── mapper/               # MyBatis Mapper
│   │   ├── entity/               # 实体类
│   │   ├── websocket/            # WebSocket 处理
│   │   │   ├── ChatWebSocketHandler.java
│   │   │   └── JwtHandshakeInterceptor.java
│   │   └── util/                 # 工具类
│   ├── pom.xml
│   └── Dockerfile
├── frontend/                     # Vue 3 前端
│   ├── src/
│   │   ├── views/
│   │   │   ├── CoverPage.vue     # 伪装页（微博克隆，点3次进登录）
│   │   │   ├── LoginPage.vue     # 登录页
│   │   │   └── ChatPage.vue      # 聊天主页面
│   │   ├── components/
│   │   │   ├── ContactList.vue   # 联系人列表
│   │   │   └── EmojiPicker.vue   # 表情选择器
│   │   ├── stores/
│   │   │   ├── chat.ts           # 聊天状态（消息、WebSocket、联系人）
│   │   │   └── user.ts           # 用户状态（token、登录）
│   │   ├── api/index.ts          # HTTP 请求封装
│   │   ├── types/index.ts        # TypeScript 类型定义
│   │   ├── utils/time.ts         # 时间格式化工具
│   │   └── router/index.ts       # 路由配置
│   ├── vite.config.ts
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml            # 服务编排
├── init.sql                      # 数据库初始化脚本
└── DESIGN.md                     # 设计文档
```

## 数据库表

| 表名 | 说明 |
|------|------|
| t_user | 用户表（id, username, password, nickname） |
| t_relation | 关系表（双向好友关系） |
| t_message | 消息表（conversation_id, sender_id, receiver_id, msg_type, content, file_url, is_read） |

**消息类型**: 1=文本, 2=图片, 3=文件, 4=emoji

## WebSocket 协议

连接: `ws://host/ws/chat?token=<JWT>`

### 客户端→服务端
```json
{ "type": "chat", "data": { "receiverId": 1, "msgType": 1, "content": "hello", "fileUrl": null, "fileName": null, "fileSize": null } }
{ "type": "read", "data": { "targetId": 1 } }
{ "type": "heartbeat", "data": {} }
```

### 服务端→客户端
```json
{ "type": "chat", "data": { /* Message对象 */ } }
{ "type": "read", "data": { "readerId": 1 } }
{ "type": "online", "data": { "userId": 1, "online": true } }
{ "type": "heartbeat_ack", "data": {} }
{ "type": "kicked", "data": {} }
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 登录（username/password → JWT） |
| GET | /api/contacts | 联系人列表 |
| GET | /api/messages?targetId=&cursor=&pageSize= | 历史消息（游标分页） |
| POST | /api/file/upload | 文件上传（multipart） |
| GET | /api/file/download/{objectName} | 文件下载（后端代理 MinIO） |

## 关键设计

- **伪装页**: CoverPage.vue，标题"有趣"，点击3次进入登录
- **单点登录**: 新登录踢掉旧 WebSocket 连接
- **已读状态**: IntersectionObserver 检测消息进入视口才标已读
- **历史加载**: 游标分页 + transform 平移防滚动跳动
- **iOS 适配**: 固定布局，只有消息区滚动，visualViewport 处理键盘遮挡
- **文件存储**: MinIO 私有桶，通过后端 API 代理访问

## 开发命令

```bash
# 后端构建
cd backend && mvn clean package -DskipTests

# 前端构建
cd frontend && npm install && npm run build

# Docker 构建 & 部署（在项目根目录）
docker compose build --no-cache
docker compose up -d

# 查看日志
docker logs pc-backend --tail 50
docker logs pc-frontend --tail 50
```

## 测试用户

| 用户名 | 密码 | 昵称 |
|--------|------|------|
| alice | 123456 | 爱丽丝 |
| bob | 123456 | 鲍勃 |
| charlie | 123456 | 查理 |

## 环境变量（docker-compose.yml）

- MySQL: root / ycy2026mysql
- Redis: ycy2026redis
- MinIO: admin / ycy2026minio
- JWT Secret: 见 docker-compose.yml

## 注意事项

1. **不要修改伪装页逻辑** — 这是核心隐私保护功能
2. **前端 nginx 代理** /api 和 /ws 到后端 8080 端口
3. **文件下载走后端代理** — 不直接暴露 MinIO
4. **conversation_id** = 两个用户ID排序后拼接（小ID_大ID）
5. **前端无端口暴露** — 通过其他方式访问前端容器的 80 端口
