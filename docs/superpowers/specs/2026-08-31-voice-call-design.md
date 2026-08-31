# 1 对 1 语音通话设计

日期：2026-08-31

## 1. 目标

为现有私聊系统增加浏览器端 1 对 1 语音通话能力。

第一版目标：

- 支持呼叫、来电、接听、拒绝、取消、挂断。
- 支持麦克风静音、通话计时、忙线、离线、超时和连接失败提示。
- 复用现有 `/ws/chat` WebSocket 作为信令通道。
- 使用 WebRTC 传输实时音频。
- 使用 STUN/TURN 完成 NAT 穿透和中继兜底。
- iPhone Safari 在页面前台时可正常呼叫和接听。
- 不修改现有聊天消息模型，不把通话信令写入 `t_message`。
- 不承诺 iOS Safari 后台或锁屏来电。

第一版不包含：

- 视频通话。
- 群语音。
- 通话录音。
- 通话历史记录。
- 系统级推送或 CallKit。
- 屏幕共享。

## 2. 现状与约束

当前后端已经具备：

- Go + Gin + Gorilla WebSocket。
- 单一 `/ws/chat` 连接。
- 基于 HttpOnly Cookie 的 WebSocket 鉴权。
- 联系人关系校验 `requireContact`。
- Hub 用户会话路由能力 `sendToUser`。
- Redis 在线状态。
- 单点登录与 `kicked` 处理。

当前前端已经具备：

- Vue 3 + TypeScript + Pinia。
- `chat.ts` 维护联系人、消息和 WebSocket 生命周期。
- 桌面端 `ChatPage.vue` 与移动端 `MobileChat.vue`。
- iOS `visualViewport` 和移动端滚动专项处理。

WebRTC 约束：

- WebRTC 不规定信令传输协议，现有 WebSocket 可以传输 Offer、Answer 和 ICE candidate。
- SDP 和 ICE 内容由浏览器 WebRTC 层处理，业务后端只做鉴权、状态校验和路由。
- 收到远端 ICE candidate 时，需要在对应的远端 SDP 已设置后再调用 `addIceCandidate()`；前端必须处理候选暂存和顺序问题。
- 实际音频默认优先尝试点对点连接；无法直连时使用 TURN relay。
- 麦克风访问要求安全上下文，生产必须使用 HTTPS/WSS。

## 3. 总体架构

```text
Browser A
   │
   │ HTTPS / WSS
   ▼
Go Backend
   │
   ├── auth / contacts / presence
   ├── /ws/chat
   │     ├── chat
   │     ├── read
   │     ├── heartbeat
   │     └── call signaling
   │
   └── /api/webrtc/ice-config
             │
             ▼
          Coturn

Browser A  <========== WebRTC Audio ==========>  Browser B
     \___________________________________________/
                    TURN fallback
```

职责边界：

### Go 后端

- 验证调用者身份。
- 验证联系人关系。
- 生成并管理 `callId`。
- 管理通话生命周期和双方忙线状态。
- 转发 WebRTC Offer、Answer、ICE。
- 签发短期 TURN 凭证。
- 处理 WebSocket 断开后的通话清理。

### Redis

保存短生命周期通话状态，不做通话历史持久化。

### 前端

- 管理通话 UI 状态。
- 请求麦克风权限。
- 创建和关闭 `RTCPeerConnection`。
- 交换 SDP 和 ICE。
- 处理铃声、静音、计时和连接状态。

### Coturn

- 提供 STUN。
- 在 P2P 无法建立时提供 TURN relay。
- 使用 shared secret 生成短期凭证。

## 4. 通话状态模型

### 4.1 服务端状态

服务端通话状态只需要：

```text
ringing
active
ended
```

其中 `ended` 不长期保存，只用于终止流程中的逻辑表达，清理后立即删除 Redis key。

Redis 数据：

```text
call:{callId}
user_call:{callerId}
user_call:{calleeId}
```

`call:{callId}` 逻辑结构：

```json
{
  "callId": "server-generated-id",
  "callerId": 1,
  "calleeId": 2,
  "status": "ringing",
  "createdAt": 1788166800,
  "acceptedAt": null
}
```

映射：

```text
user_call:1 -> callId
user_call:2 -> callId
```

TTL：

- `ringing`：60 秒。
- `active`：建议 12 小时安全 TTL。
- 正常终止时主动删除三组 key。

Redis 写入与状态迁移必须保证并发安全。实现时优先使用事务或 Lua 脚本完成“双方空闲检查 + 建立 call”以及“状态变更 + 清理”，避免双方同时呼叫产生双重 call。

### 4.2 前端状态

```text
idle
outgoing
incoming
connecting
connected
ended
failed
```

状态转换：

```text
idle -> outgoing -> connecting -> connected -> ended -> idle
idle -> incoming -> connecting -> connected -> ended -> idle

outgoing -> ended     (cancel/reject/timeout/busy/offline)
incoming -> ended     (reject/cancel/timeout)
connecting -> failed  (media/SDP/ICE failure)
connected -> failed   (unrecoverable WebRTC failure)
```

## 5. WebSocket 协议

所有客户端消息均由当前已鉴权 WebSocket 发送。

通话信令不允许客户端自行指定“发送者 ID”。发送者始终以当前 WebSocket 会话用户为准。

### 5.1 发起呼叫

客户端：

```json
{
  "type": "call_invite",
  "data": {
    "receiverId": 2
  }
}
```

服务端校验：

1. `receiverId > 0`。
2. 不能呼叫自己。
3. 双方为联系人。
4. 对方当前在线。
5. 主叫和被叫都没有 `user_call:*`。
6. 服务端生成唯一 `callId`。
7. 原子写入 call 和双方 `user_call` 映射。

通知主叫：

```json
{
  "type": "call_ringing",
  "data": {
    "callId": "xxx",
    "userId": 2
  }
}
```

通知被叫：

```json
{
  "type": "call_incoming",
  "data": {
    "callId": "xxx",
    "callerId": 1
  }
}
```

### 5.2 离线或忙线

离线：

```json
{
  "type": "call_unavailable",
  "data": {
    "userId": 2,
    "reason": "offline"
  }
}
```

忙线：

```json
{
  "type": "call_busy",
  "data": {
    "userId": 2
  }
}
```

服务端不建立 call。

### 5.3 接听

客户端：

```json
{
  "type": "call_accept",
  "data": {
    "callId": "xxx"
  }
}
```

服务端要求：

- call 存在。
- 当前用户等于 `calleeId`。
- call 仍为 `ringing`。
- 原子切换为 `active`。

通知双方：

```json
{
  "type": "call_accepted",
  "data": {
    "callId": "xxx"
  }
}
```

主叫收到 `call_accepted` 后负责创建 Offer，避免双端同时发起 SDP negotiation。

### 5.4 拒绝

```json
{
  "type": "call_reject",
  "data": {
    "callId": "xxx"
  }
}
```

只有被叫可以拒绝 `ringing` call。

通知主叫：

```json
{
  "type": "call_rejected",
  "data": {
    "callId": "xxx"
  }
}
```

随后清理 Redis call 状态。

### 5.5 主叫取消

```json
{
  "type": "call_cancel",
  "data": {
    "callId": "xxx"
  }
}
```

只有主叫可以取消仍处于 `ringing` 的 call。

通知被叫：

```json
{
  "type": "call_cancelled",
  "data": {
    "callId": "xxx"
  }
}
```

随后清理状态。

### 5.6 超时

当 ringing 超过 60 秒：

```json
{
  "type": "call_timeout",
  "data": {
    "callId": "xxx"
  }
}
```

双方回到 idle。

实现时不能只依赖 Redis TTL keyspace notification，因为部署环境未必启用；后端需要有显式超时路径。可以在 call 创建后启动受控定时清理，或使用可测试的统一 call manager 调度。

### 5.7 挂断

任一通话成员：

```json
{
  "type": "call_hangup",
  "data": {
    "callId": "xxx"
  }
}
```

服务端验证当前用户属于该 call 后，向另一端发送：

```json
{
  "type": "call_ended",
  "data": {
    "callId": "xxx",
    "reason": "hangup"
  }
}
```

然后删除 Redis 状态。

### 5.8 WebRTC Offer

主叫：

```json
{
  "type": "webrtc_offer",
  "data": {
    "callId": "xxx",
    "sdp": {
      "type": "offer",
      "sdp": "..."
    }
  }
}
```

服务端：

- 不解析 SDP 内容。
- 验证 call 存在且为 `active`。
- 验证发送者等于 `callerId`。
- 转发给 `calleeId`。
- 限制 SDP 字符串大小，整个 WebSocket 消息继续受现有 64 KiB 上限保护。

### 5.9 WebRTC Answer

被叫：

```json
{
  "type": "webrtc_answer",
  "data": {
    "callId": "xxx",
    "sdp": {
      "type": "answer",
      "sdp": "..."
    }
  }
}
```

服务端验证：

- call 为 `active`。
- 发送者等于 `calleeId`。
- 转发给主叫。

### 5.10 ICE Candidate

任一端：

```json
{
  "type": "webrtc_ice",
  "data": {
    "callId": "xxx",
    "candidate": {
      "candidate": "...",
      "sdpMid": "0",
      "sdpMLineIndex": 0,
      "usernameFragment": "..."
    }
  }
}
```

服务端只验证发送者属于该 active call，然后转发给另一端。

前端需要：

- 如果 `remoteDescription` 尚未设置，暂存 candidate。
- 完成 `setRemoteDescription()` 后按接收顺序 flush。
- `addIceCandidate()` 失败时记录错误并终止不可恢复的连接。

## 6. WebSocket 断线与登录失效

现有 `unregisterSession` 和 `kickUser` 路径需要与 call manager 集成。

当用户 WebSocket 真正离线：

- 查找 `user_call:{userId}`。
- 若存在 call，向对端发送 `call_ended`，reason 为 `disconnected`。
- 清理 call。

当用户收到 `kicked`：

- 前端立即停止本地媒体 Track。
- 关闭 `RTCPeerConnection`。
- 后端关闭旧 Session 时执行同样的 call 清理。

注意：现有 Hub 如果未来允许同用户多连接，不能因为任意一个 Session 断开就直接结束通话；当前单点登录模型下可以按“用户失去有效 Session”来处理。实现时应通过 Hub 当前是否仍有有效 Session 决定是否视为离线。

## 7. WebRTC 前端设计

新增：

```text
frontend/src/
├── stores/
│   └── call.ts
├── composables/
│   └── useWebRtcCall.ts
├── components/
│   ├── VoiceCallOverlay.vue
│   └── IncomingCallOverlay.vue
└── utils/
    └── webrtc.ts
```

### 7.1 `call.ts`

负责业务状态：

- call 状态。
- `callId`。
- 对端用户。
- 是否静音。
- 通话开始时间。
- UI 错误。
- 来电铃声状态。
- 处理来自 chat WebSocket 的 call 事件。

不负责：

- SDP API 调用。
- Track 生命周期细节。
- ICE candidate 操作。

### 7.2 `useWebRtcCall.ts`

负责浏览器媒体和连接：

- 获取 ICE config。
- `getUserMedia({ audio: true })`。
- 创建 `RTCPeerConnection`。
- `addTrack()`。
- `createOffer()` / `createAnswer()`。
- `setLocalDescription()`。
- `setRemoteDescription()`。
- ICE candidate 暂存与 flush。
- 远端 `track` 播放。
- 静音切换。
- 清理所有 MediaStreamTrack。
- 关闭 PeerConnection。
- 监听 `connectionState` / `iceConnectionState`。

### 7.3 音频元素

使用一个隐藏的远端音频元素：

```html
<audio autoplay playsinline></audio>
```

不要把远端流与语音消息播放器复用。

接听是明确用户交互，因此在接听路径中同时初始化音频播放，可降低 Safari 自动播放限制带来的失败概率。如果 `play()` 被拒绝，UI 显示“点击恢复声音”而不是静默失败。

## 8. ICE / TURN 配置

新增：

```text
GET /api/webrtc/ice-config
```

必须沿用当前 HttpOnly Cookie 鉴权。

响应示例：

```json
{
  "code": 200,
  "data": {
    "iceServers": [
      {
        "urls": [
          "stun:turn.example.com:3478"
        ]
      },
      {
        "urls": [
          "turn:turn.example.com:3478?transport=udp",
          "turns:turn.example.com:5349?transport=tcp"
        ],
        "username": "1788167400:1",
        "credential": "temporary-hmac-secret"
      }
    ],
    "iceTransportPolicy": "all"
  }
}
```

### 8.1 TURN 临时凭证

后端与 Coturn 共享 secret。

临时 username：

```text
{expiryUnix}:{userId}
```

临时 credential：

```text
base64(HMAC-SHA1(sharedSecret, username))
```

凭证建议有效期 10 分钟。

前端不得获得 shared secret，也不得在构建产物中保存固定 TURN 密码。

### 8.2 配置项

建议新增：

```dotenv
WEBRTC_ICE_POLICY=all
WEBRTC_STUN_URL=stun:turn.example.com:3478
WEBRTC_TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
WEBRTC_TURN_SECRET=<shared-secret>
WEBRTC_TURN_CREDENTIAL_TTL=10m
```

默认：

```text
WEBRTC_ICE_POLICY=all
```

允许值：

- `all`：P2P 优先，TURN 兜底。
- `relay`：只使用 TURN relay。

服务端启动时校验配置；如果开启语音功能但 TURN 配置缺失，应明确报错，避免线上表现为“部分网络随机打不通”。

## 9. Coturn 部署

Coturn 可以作为独立容器或外部服务。

如果纳入 Compose，建议独立 service，不与 Go 后端容器共享进程。

需要支持：

- UDP/TCP 3478。
- TLS 5349（生产推荐）。
- TURN relay UDP 端口范围。
- `use-auth-secret`。
- `static-auth-secret`。
- `realm`。
- 合理的 external/public IP 配置。

部署层必须显式开放 relay UDP 端口范围；仅开放 3478/5349 不能保证 TURN relay 正常工作。

第一版不在应用层自动申请 TURN 证书。TLS 证书和公网端口属于部署基础设施配置。

## 10. UI 设计

### 10.1 桌面端

聊天头部右侧增加语音通话按钮。

条件：

- 当前已选联系人。
- WebSocket 已连接。
- 当前没有任何 active/incoming/outgoing call。

按钮点击：

1. 不立即改变聊天消息区域。
2. 创建 outgoing call。
3. 展示通话 Overlay。

### 10.2 移动端

聊天标题栏右侧增加通话按钮。

通话使用独立全屏 Overlay：

- 不嵌入消息滚动容器。
- 不改变 `visualViewport` 聊天布局策略。
- 不依赖聊天输入框高度。
- 来电 Overlay 也独立于移动聊天 history overlay。

这样可以避免语音通话逻辑干扰现有 iOS 滚动和键盘修复。

### 10.3 通话 Overlay

显示：

- 联系人头像/昵称。
- “正在呼叫 / 来电 / 正在连接 / 通话中”。
- 通话时间。
- 麦克风静音。
- 挂断。

来电显示：

- 接听。
- 拒绝。

第一版不加入扬声器路由选择，因为移动 Safari 对音频输出设备控制能力有限且行为依设备不同。

## 11. iOS Safari 行为

支持范围：

- Safari 页面处于前台。
- 用户通过页面交互发起或接听。
- 用户授权麦克风。
- 站点处于 HTTPS。

不保证：

- Safari 切到后台后的实时响铃。
- 锁屏来电。
- 类似原生电话/微信的系统来电 UI。
- 页面被系统挂起后的 WebSocket 持续运行。

因此第一版产品文案不能描述为“后台来电”。

后续若需要后台通知，应独立设计 Push API / PWA / 原生容器或 iOS CallKit 方案，不纳入当前 WebRTC 通话实现。

## 12. 错误处理

### 麦克风拒绝

- 不进入 connecting。
- 通知对端 call ended/cancelled。
- 显示“无法访问麦克风，请检查浏览器权限”。

### ICE disconnected

- 不立即结束。
- 给短暂恢复窗口，例如 10 秒。
- 若状态恢复 connected/completed，继续通话。
- 超过窗口或进入 failed，结束通话。

### ICE failed / PeerConnection failed

- 关闭连接。
- 发送挂断/失败信号。
- UI 显示“通话连接失败”。

### WebSocket 断开

- 当前 call 立即进入网络异常状态。
- 后端在确认用户真正离线后终止 call。
- 前端清理媒体资源。

### 页面卸载

前端必须同步执行本地清理：

- 停止所有 tracks。
- 关闭 PeerConnection。
- 停止铃声和计时器。

不能依赖 unload 请求保证服务器收到 hangup；服务端仍必须依赖 WebSocket Session 生命周期兜底清理。

## 13. 安全设计

- 所有 call WebSocket 消息使用当前已鉴权 Session 的 user ID。
- 客户端不能决定 senderId。
- 所有 call 操作必须校验当前用户属于 call。
- 发起 call 必须校验联系人关系。
- Offer/Answer/ICE 只允许在 active call 内转发。
- `callId` 需要高熵、不可预测。
- 限制 callId、SDP 和 ICE 字段长度。
- 继续使用现有 WebSocket 64 KiB read limit。
- TURN shared secret 只存在于服务端和 Coturn。
- ICE config API 返回短期凭证。
- 不记录 SDP、ICE candidate、TURN credential 到业务日志。
- 不将通话媒体或信令写入 `t_message`。
- 第一版不声称实现端到端身份验证；WebRTC 媒体传输会使用其标准加密传输机制，但应用当前整体安全边界仍以 README 现有说明为准。

## 14. 后端组件边界

建议新增：

```text
backend/internal/app/
├── call.go
└── webrtc.go
```

或在复杂度增长时拆为独立包：

```text
backend/internal/call/
├── manager.go
├── store.go
└── types.go
```

推荐最终边界：

### Call Manager

接口职责：

- StartCall。
- AcceptCall。
- RejectCall。
- CancelCall。
- EndCall。
- FindCallByUser。
- RelaySignal。
- DisconnectUser。

### Redis Call Store

职责：

- call 原子创建。
- call 查询。
- 状态迁移。
- 双方 user_call 映射。
- TTL。
- 清理。

### WebSocket Handler

只负责：

- payload 解析。
- 调用 Call Manager。
- 将 manager 结果转为 WS payload。

不要把 Redis 状态机逻辑直接继续堆进现有 `ws.go`。

## 15. 前端与现有 chat store 的集成

现有 `chat.ts` 继续拥有唯一 WebSocket 实例。

它需要增加一个可测试的 call-event 分发边界：

```text
WebSocket.onmessage
  ├── chat/read/online/... -> chat store
  └── call/webrtc events  -> call store / WebRTC controller
```

不新增第二条 WebSocket。

`call.ts` 不能反向拥有联系人和消息集合；只通过 ID 和最少的联系人展示信息工作。

清理：

- logout 时必须先结束/清理通话。
- `kicked` 时清理通话。
- `clearState()` 不应遗漏 call store。

## 16. 测试策略

### 16.1 Go 单元测试

覆盖：

- 非联系人不能呼叫。
- 不能呼叫自己。
- 对方离线。
- 主叫忙线。
- 被叫忙线。
- 并发双向呼叫只允许建立一个 call。
- 只有被叫能 accept/reject。
- 只有主叫能 cancel ringing call。
- 任一成员可 hangup active call。
- 非成员不能转发 Offer/Answer/ICE。
- Offer 只能由主叫发送。
- Answer 只能由被叫发送。
- ringing 超时清理。
- WebSocket disconnect 清理。
- Redis 状态和 user_call 映射一致性。

### 16.2 TypeScript 单元测试

覆盖：

- call store 状态转换。
- incoming/outgoing UI 状态。
- ICE candidate 在 remoteDescription 前暂存。
- remoteDescription 设置后正确 flush。
- mute track enabled 切换。
- cleanup 幂等。
- WebSocket call event 分发。
- busy/reject/cancel/timeout。
- WebSocket disconnect/kicked 清理。

### 16.3 浏览器集成测试

至少人工验证：

1. Chrome ↔ Chrome 同网络。
2. Chrome ↔ Chrome 不同公网网络。
3. Chrome ↔ iPhone Safari。
4. iPhone Safari ↔ iPhone Safari。
5. 强制 `iceTransportPolicy=relay` 验证 TURN。
6. 禁止麦克风权限。
7. 通话中断网再恢复。
8. 通话中关闭页面。
9. 被叫忙线。
10. 主叫在 ringing 时取消。

### 16.4 部署验证

- Coturn UDP relay。
- Coturn TCP/TLS fallback。
- TURN 临时凭证过期。
- 未开放 relay 端口时能够被监控发现。
- `/api/webrtc/ice-config` 未登录返回 401。
- 生产环境不暴露 shared secret。

## 17. 可观测性

允许记录：

- callId。
- callerId / calleeId。
- 状态迁移。
- 失败原因枚举。
- 通话建立耗时。
- 是否最终使用 relay（如果浏览器提供可安全采集的统计信息）。

不记录：

- SDP 全文。
- ICE candidate 全文。
- TURN credential。
- 音频数据。

第一版不要求落库统计，结构化日志即可。

## 18. 实施顺序

后续实现计划应按以下依赖顺序拆解：

1. 后端 call manager + Redis 状态机。
2. WebSocket call 协议与测试。
3. ICE config API + Coturn 临时凭证。
4. 前端 call store 和 WS 分发。
5. WebRTC composable。
6. 桌面通话 UI。
7. 移动端/iOS 通话 UI。
8. Coturn 部署和配置。
9. 跨浏览器和真实网络验证。

## 19. 验收标准

满足以下条件才认为第一版完成：

- 两个在线联系人可以稳定完成呼叫、接听和挂断。
- 双方不能同时进入两个 call。
- 忙线、拒绝、取消、超时行为一致。
- 通话不写入 `t_message`，不影响现有消息约束。
- P2P 不可用时 TURN relay 可以建立通话。
- TURN 固定 secret 不出现在前端代码和网络响应中。
- WebSocket 断开或账号被踢时本地媒体被释放。
- iPhone Safari 前台接听和通话可用。
- 通话 Overlay 不破坏现有移动端聊天滚动、输入框和 history 行为。
- 后端和前端新增状态机有自动化测试。
- README 对功能和部署配置完成同步更新。
