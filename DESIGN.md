# 私聊系统技术设计文档

## 一、项目概述

一个伪装成微博的1对1加密私聊系统。用户通过伪装页隐藏入口进入登录页，登录后查看关系表中的联系人发起聊天。

## 二、技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Maven + JDK 21 + Spring Boot 3.5.9 + Spring WebSocket |
| 前端 | Vue 3 + Vite + Tailwind CSS 4 + Element Plus |
| 数据库 | MySQL 8.x |
| 缓存 | Redis |
| 文件存储 | MinIO |
| 部署 | Docker Compose + Nginx |
| 网络 | my-network（内部互通，不暴露端口） |

## 三、项目目录结构

```
/home/works/private-chat/
├── DESIGN.md                          # 本文档
├── docker-compose.yml                 # Docker编排
├── backend/                           # 后端
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/main/
│       ├── java/com/privatechat/
│       │   ├── PrivateChatApplication.java
│       │   ├── config/
│       │   │   ├── WebSocketConfig.java
│       │   │   ├── RedisConfig.java
│       │   │   ├── MinioConfig.java
│       │   │   ├── CorsConfig.java
│       │   │   └── JwtConfig.java
│       │   ├── controller/
│       │   │   ├── AuthController.java          # 登录
│       │   │   ├── ContactController.java       # 联系人列表
│       │   │   ├── MessageController.java       # 历史消息查询
│       │   │   └── FileController.java          # 文件上传
│       │   ├── websocket/
│       │   │   ├── ChatWebSocketHandler.java    # WebSocket连接管理
│       │   │   └── WebSocketInterceptor.java    # 握手拦截器（Token验证）
│       │   ├── service/
│       │   │   ├── UserService.java
│       │   │   ├── RelationService.java
│       │   │   ├── MessageService.java
│       │   │   └── FileService.java
│       │   ├── mapper/
│       │   │   ├── UserMapper.java
│       │   │   ├── RelationMapper.java
│       │   │   └── MessageMapper.java
│       │   ├── model/
│       │   │   ├── entity/
│       │   │   │   ├── User.java
│       │   │   │   ├── Relation.java
│       │   │   │   └── Message.java
│       │   │   ├── dto/
│       │   │   │   ├── LoginRequest.java
│       │   │   │   ├── LoginResponse.java
│       │   │   │   ├── WsMessage.java
│       │   │   │   └── HistoryQuery.java
│       │   │   └── vo/
│       │   │       ├── ContactVO.java
│       │   │       └── MessageVO.java
│       │   ├── util/
│       │   │   ├── JwtUtil.java
│       │   │   └── PasswordUtil.java
│       │   └── handler/
│       │       └── GlobalExceptionHandler.java
│       └── resources/
│           ├── application.yml
│           └── db/
│               └── schema.sql
├── frontend/                            # 前端
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.ts
│       ├── App.vue
│       ├── router/
│       │   └── index.ts
│       ├── api/
│       │   ├── http.ts                   # axios封装
│       │   ├── auth.ts
│       │   ├── contact.ts
│       │   ├── message.ts
│       │   └── file.ts
│       ├── websocket/
│       │   └── index.ts                  # WebSocket客户端封装
│       ├── stores/
│       │   ├── user.ts                   # Pinia: 用户状态
│       │   ├── chat.ts                   # Pinia: 聊天状态
│       │   └── ws.ts                     # Pinia: WebSocket状态
│       ├── views/
│       │   ├── CoverPage.vue             # 伪装页（微博）
│       │   ├── LoginPage.vue             # 登录页
│       │   └── ChatPage.vue              # 聊天页
│       ├── components/
│       │   ├── chat/
│       │   │   ├── ContactList.vue       # 联系人列表（左侧）
│       │   │   ├── ChatWindow.vue        # 聊天窗口（右侧）
│       │   │   ├── MessageItem.vue       # 单条消息渲染
│       │   │   ├── MessageInput.vue      # 输入框（文本/emoji/文件）
│       │   │   └── EmojiPicker.vue       # Emoji选择器
│       │   └── common/
│       │       └── EmptyState.vue
│       ├── utils/
│       │   ├── time.ts                   # 时间格式化
│       │   └── file.ts                   # 文件工具
│       └── types/
│           └── index.ts                  # TypeScript类型定义
└── init.sql                             # 数据库初始化脚本（含测试数据）
```

## 四、数据库设计

### 4.1 用户表 (t_user)

```sql
CREATE TABLE t_user (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    username    VARCHAR(50) NOT NULL UNIQUE,
    password    VARCHAR(128) NOT NULL,       -- BCrypt加密
    nickname    VARCHAR(50) NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.2 关系表 (t_relation)

```sql
CREATE TABLE t_relation (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id     BIGINT NOT NULL,             -- 用户A
    target_id   BIGINT NOT NULL,             -- 用户B
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_relation (user_id, target_id),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

说明：关系需要双向插入（A→B 和 B→A 各一条），查询时只需 `WHERE user_id = ?`。

### 4.3 消息表 (t_message)

```sql
CREATE TABLE t_message (
    id             BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id VARCHAR(64) NOT NULL,    -- 会话ID：两用户ID按小在前拼接，如 "3_5"
    sender_id      BIGINT NOT NULL,
    receiver_id    BIGINT NOT NULL,
    msg_type       TINYINT NOT NULL,         -- 1:文本 2:图片 3:文件 4:emoji
    content        TEXT,                      -- 文本内容/emoji
    file_url       VARCHAR(512),             -- MinIO文件URL
    file_name      VARCHAR(255),             -- 原始文件名
    file_size      BIGINT,                   -- 文件大小（字节）
    is_read        TINYINT DEFAULT 0,        -- 0:未读 1:已读
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_conversation (conversation_id, created_at),
    INDEX idx_receiver_unread (receiver_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

conversation_id 规则：将两个用户ID按数字从小到大排列，用下划线拼接，如用户3和用户5的会话ID为 `3_5`。

### 4.4 Redis Key 设计

| Key | 类型 | 说明 |
|-----|------|------|
| `online:{userId}` | String | 用户在线状态，TTL=2分钟，心跳续期 |
| `unread:{userId}:{conversationId}` | String (数字) | 未读消息计数 |
| `token:{userId}` | String | JWT Token缓存，TTL=1小时 |

## 五、API 设计

### 5.1 登录认证

```
POST /api/auth/login
Content-Type: application/json

Request:
{
  "username": "string",
  "password": "string"
}

Response 200:
{
  "code": 200,
  "data": {
    "token": "jwt-string",
    "userId": 1,
    "nickname": "用户昵称"
  }
}
```

### 5.2 获取联系人列表

```
GET /api/contacts
Authorization: Bearer <token>

Response 200:
{
  "code": 200,
  "data": [
    {
      "userId": 2,
      "nickname": "联系人昵称",
      "online": true,
      "lastMessage": "最后一条消息预览",
      "lastMessageTime": "2026-04-13T16:00:00",
      "unreadCount": 3
    }
  ]
}
```

### 5.3 获取历史消息（分页）

```
GET /api/messages/{targetId}?cursor={timestamp}&size={pageSize}&mode={init|loadMore}
Authorization: Bearer <token>

参数:
  - cursor: 时间戳游标，首次加载不传（返回最后N条+全部未读）
  - size: 每次加载条数，默认20
  - mode: 
    - init: 首次进入聊天，返回最后N条 + 所有未读消息
    - loadMore: 向上翻页加载，基于cursor往前取

Response 200:
{
  "code": 200,
  "data": {
    "messages": [
      {
        "id": 100,
        "senderId": 1,
        "receiverId": 2,
        "msgType": 1,
        "content": "消息内容",
        "fileUrl": null,
        "fileName": null,
        "fileSize": null,
        "isRead": true,
        "createdAt": "2026-04-13T16:00:00"
      }
    ],
    "hasMore": true
  }
}
```

首次加载逻辑（mode=init）：
1. 查询该会话所有未读消息
2. 查询最后 N 条消息（按时间正序）
3. 合并去重（未读消息可能在最后N条中），按时间正序返回
4. 同时将这些消息标记为已读（通过WebSocket通知对方）

### 5.4 文件上传

```
POST /api/file/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

Request: file字段

Response 200:
{
  "code": 200,
  "data": {
    "url": "http://minio:9000/private-chat/uuid-filename.jpg",
    "fileName": "photo.jpg",
    "fileSize": 1024000
  }
}
```

限制：单文件最大 50MB。

## 六、WebSocket 协议设计

### 6.1 连接

```
ws://host/ws/chat?token=<jwt>
```

握手时通过拦截器验证 JWT，从 Token 中解析 userId，建立 userId → Session 的映射。

### 6.2 消息格式

所有消息统一格式：

```json
{
  "type": "string",       // 消息类型
  "data": { ... }         // 业务数据
}
```

### 6.3 消息类型

#### 6.3.1 客户端 → 服务端

| type | 说明 | data |
|------|------|------|
| `chat` | 发送消息 | `{ receiverId, msgType, content?, fileUrl?, fileName?, fileSize? }` |
| `heartbeat` | 心跳 | `{}` |
| `read` | 标记已读 | `{ targetId }` |

#### 6.3.2 服务端 → 客户端

| type | 说明 | data |
|------|------|------|
| `chat` | 收到新消息 | `{ id, senderId, receiverId, msgType, content, fileUrl, fileName, fileSize, isRead, createdAt }` |
| `read` | 对方已读通知 | `{ readerId, conversationId }` |
| `online` | 在线状态变更 | `{ userId, online: boolean }` |
| `heartbeat_ack` | 心跳响应 | `{}` |
| `error` | 错误 | `{ message }` |

### 6.4 消息发送流程

```
1. 客户端发送 chat 消息
2. 服务端接收，存入 MySQL
3. 如果接收方在线 → 通过WebSocket实时推送
4. 如果接收方不在线 → 消息已存DB，unread计数+1（Redis）
5. 服务端返回 ack 给发送方（包含消息ID和时间戳）
6. 发送方更新本地消息状态为"已发送"
```

### 6.5 已读流程

```
1. 客户端打开/切换到某个会话时，发送 read { targetId }
2. 服务端将该会话中 targetId 发来的未读消息全部标记为已读
3. 服务端通知 targetId（对方）：read { readerId, conversationId }
4. 对方收到后更新UI上的已读状态
```

## 七、前端页面设计

### 7.1 伪装页 (CoverPage.vue)

- 模仿微博首页外观（简化版，不需要完全还原）
- 热搜列表、几条模拟动态
- 隐藏入口：点击页面某段特定文字（如"微博热搜"标题）连续 3 次，跳转到登录页
- 路由守卫：登录页不能通过URL直接访问，必须有 fromCover 标记

### 7.2 登录页 (LoginPage.vue)

- 简洁的用户名/密码表单
- 登录成功后跳转到聊天页
- 没有注册入口
- 路由守卫：未从伪装页进入则重定向到伪装页

### 7.3 聊天页 (ChatPage.vue)

桌面端（>768px）：左右分栏布局
```
┌──────────────┬────────────────────────────┐
│  联系人列表    │       聊天窗口              │
│              │  ┌──────────────────────┐  │
│  联系人1  3条  │  │    消息列表           │  │
│  联系人2       │  │    (可滚动加载)       │  │
│  联系人3       │  │                      │  │
│              │  └──────────────────────┘  │
│              │  ┌──────────────────────┐  │
│              │  │  Emoji | 📎 | 输入框   │  │
│              │  └──────────────────────┘  │
└──────────────┴────────────────────────────┘
```

移动端（≤768px）：全屏切换
- 默认显示联系人列表
- 点击联系人 → 全屏切换到聊天窗口
- 顶部返回按钮回到联系人列表

### 7.4 消息加载策略（像微信）

1. **首次进入会话**：调用 `GET /api/messages/{targetId}?mode=init`
   - 返回最后 20 条 + 全部未读消息
   - 如果未读消息在最后20条之后，自动滚动到第一条未读消息
   - 如果都在最后20条内，滚动到底部
2. **向上滚动**：监听滚动事件，到顶部时调用 `GET /api/messages/{targetId}?cursor={最早消息时间}&mode=loadMore`
3. **新消息**：WebSocket 推送实时追加到列表底部

### 7.5 iOS Safari 适配

- CSS `env(safe-area-inset-*)` 处理刘海/底部横条
- `-webkit-overflow-scrolling: touch` 平滑滚动
- input focus 时使用 `window.scrollTo` 防止键盘遮挡
- WebSocket 心跳间隔适配 iOS 后台挂起行为
- 文件上传使用 `<input type="file">` 兼容 iOS

## 八、Docker 部署架构

```yaml
# docker-compose.yml
version: '3.8'

services:
  # 前端容器：Nginx + Vue静态文件
  frontend:
    build: ./frontend
    container_name: private-chat-frontend
    networks:
      - my-network
    depends_on:
      - backend

  # 后端容器：Spring Boot
  backend:
    build: ./backend
    container_name: private-chat-backend
    networks:
      - my-network
    depends_on:
      - mysql
      - redis
    environment:
      - SPRING_DATASOURCE_URL=jdbc:mysql://mysql:3306/private_chat?useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true
      - SPRING_DATASOURCE_USERNAME=root
      - SPRING_DATASOURCE_PASSWORD=${MYSQL_ROOT_PASSWORD}
      - SPRING_DATA_REDIS_HOST=redis
      - SPRING_DATA_REDIS_PORT=6379
      - MINIO_ENDPOINT=http://minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}

  # 使用现有容器
  # mysql, redis, minio 不在此compose中定义
  # 它们已在运行，加入my-network即可

networks:
  my-network:
    external: true
```

### 8.1 Nginx 配置 (frontend/nginx.conf)

```nginx
server {
    listen 80;

    # Vue静态文件
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;  # Vue Router history模式
    }

    # API反向代理
    location /api/ {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket反向代理
    location /ws/ {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;  # 1小时超时
        proxy_send_timeout 3600s;
    }
}
```

## 九、安全设计

1. **密码存储**：BCrypt 加密
2. **JWT Token**：有效期 1 小时，存储在 Redis 中可主动失效
3. **伪装页入口**：连续点击 3 次特定文字，登录页不接受直接 URL 访问
4. **WebSocket 鉴权**：握手时验证 JWT
5. **文件上传**：校验文件大小（≤50MB），存储路径随机 UUID 命名防枚举
6. **SQL注入**：MyBatis-Plus 参数化查询

## 十、开发顺序

1. 数据库初始化脚本 + Docker Compose
2. 后端基础框架（Spring Boot + MyBatis-Plus + JWT）
3. 后端登录接口
4. 后端联系人接口
5. 后端 WebSocket 连接 + 消息收发
6. 后端历史消息查询
7. 后端文件上传
8. 前端项目初始化（Vue3 + Element Plus + Tailwind）
9. 前端伪装页
10. 前端登录页
11. 前端聊天页面（联系人列表 + 聊天窗口）
12. 前端 WebSocket 集成
13. 前端消息加载策略（微信式分页）
14. 前端文件/图片上传
15. 前端 iOS 适配
16. Docker 构建 + 部署测试
