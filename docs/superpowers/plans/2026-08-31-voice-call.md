# 1 对 1 语音通话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Private Chat 中增加稳定、可测试的一对一浏览器语音通话，复用 `/ws/chat` 做信令，使用 WebRTC 传输音频并由 Coturn 提供 TURN 兜底。

**Architecture:** 后端新增 Redis-backed call state store 和 call manager，WebSocket 只做经过鉴权的通话控制与 SDP/ICE 路由；`GET /api/webrtc/ice-config` 使用 Coturn shared secret 签发短期 HMAC 凭证。前端保留 `chat.ts` 对唯一 WebSocket 的所有权，通过 WS observer 将 call 事件分发给独立 `call.ts`，WebRTC 浏览器 API 封装在 `useWebRtcCall.ts`，桌面与移动端共用通话组件。

**Tech Stack:** Go 1.23, Gin, go-redis/v9, Gorilla WebSocket, Vue 3, TypeScript 5.8, Pinia 3, Vitest 4, WebRTC, Coturn 4.17.2.

**Spec:** `docs/superpowers/specs/2026-08-31-voice-call-design.md`

## Global Constraints

- 保留唯一 WebSocket：`/ws/chat`；不要新增 `/ws/call`。
- HTTP API 与 WebSocket 继续只使用 `private_chat_session` HttpOnly Cookie 鉴权。
- WebSocket 单条消息继续受 64 KiB read limit 约束。
- 通话媒体、通话信令、通话状态都不得写入 `t_message`；不要新增 `msg_type`。
- 服务端通话状态只保存在 Redis；`ringing` TTL 为 60 秒，`active` 安全 TTL 为 12 小时。
- Offer 只允许 caller 发送；Answer 只允许 callee 发送；ICE 允许 active call 的任一成员发送。
- `callId` 由服务端生成，使用高熵 UUID；客户端不得提供 senderId。
- 发起方先成功获取本地麦克风与 ICE config，再发送 `call_invite`。
- 被叫点击接听后先成功获取本地麦克风与 ICE config，再发送 `call_accept`。
- 默认 `iceTransportPolicy=all`；允许配置为 `relay`。
- Coturn credential TTL 为 10 分钟，凭证格式为 `base64(HMAC-SHA1(sharedSecret, expiryUnix:userId))`。
- TURN shared secret 只存在于 Go 后端和 Coturn；不得进入前端构建产物、API 日志或 WebSocket 日志。
- iPhone Safari 第一版只保证页面前台、HTTPS、用户已授权麦克风的场景；不承诺锁屏或后台来电。
- 移动通话 UI 必须是独立 fixed overlay，不得改变现有 `visualViewport`、聊天滚动、输入框或 mobile history 逻辑。
- 不增加视频、群语音、录音、通话记录、Push/CallKit、屏幕共享。

---

## File Map

### Backend: create

- `backend/internal/app/call_store.go` — Redis call record、原子创建/激活/删除与用户 busy 映射。
- `backend/internal/app/call_store_test.go` — 使用 miniredis 验证并发、TTL、状态迁移和安全删除。
- `backend/internal/app/call_manager.go` — 联系人、在线、角色、超时和信令业务规则。
- `backend/internal/app/call_manager_test.go` — fake store/gateway 的业务状态机测试。
- `backend/internal/app/call_ws.go` — WebSocket call payload 解析与 manager 路由。
- `backend/internal/app/call_ws_test.go` — callId/SDP/ICE 长度、角色和协议解析测试。
- `backend/internal/app/webrtc.go` — ICE config HTTP handler 与 TURN HMAC credential。
- `backend/internal/app/webrtc_test.go` — credential、鉴权路由和响应结构测试。

### Backend: modify

- `backend/internal/app/app.go` — App 注入 call manager、注册 ICE config route。
- `backend/internal/app/ws.go` — 将 call/webrtc WS 类型转交 `handleWsCall`，用户真正离线时终止 call。
- `backend/internal/config/config.go` — WebRTC/TURN 配置读取和验证。
- `backend/internal/config/config_test.go` — ICE policy、TURN secret/URL、TTL 配置验证。
- `backend/go.mod`
- `backend/go.sum`

### Frontend: create

- `frontend/src/types/call.ts` — call/ICE/WS 类型定义。
- `frontend/src/stores/call.ts` — 通话业务状态机与聊天 WS 集成。
- `frontend/src/stores/call.test.ts` — outgoing/incoming/busy/reject/timeout/cleanup 状态测试。
- `frontend/src/composables/useWebRtcCall.ts` — MediaStream/PeerConnection 生命周期。
- `frontend/src/composables/useWebRtcCall.test.ts` — SDP、ICE queue、mute、cleanup、disconnect grace 测试。
- `frontend/src/components/VoiceCallButton.vue` — 可复用顶部通话按钮。
- `frontend/src/components/VoiceCallOverlay.vue` — outgoing/connecting/connected 通话层。
- `frontend/src/components/IncomingCallOverlay.vue` — 来电接听/拒绝层。
- `frontend/src/components/VoiceCallOverlay.test.ts` — 通话 UI 行为。
- `frontend/src/views/VoiceCallIntegration.test.ts` — 桌面/移动源码级集成约束测试。

### Frontend: modify

- `frontend/src/types/index.ts` — re-export call types 并扩展 WS union。
- `frontend/src/api/index.ts` — `getWebRtcIceConfig()`。
- `frontend/src/stores/chat.ts` — WS observer，不引入 call store。
- `frontend/src/stores/chat.test.ts` — observer/kicked/disconnect 兼容测试。
- `frontend/src/views/ChatPage.vue` — 桌面通话按钮和 overlay。
- `frontend/src/views/MobileChat.vue` — 移动通话按钮和 overlay，保持 viewport/history 隔离。
- `frontend/src/views/MobileChat.ios.test.ts` — 防止通话功能破坏 iOS viewport 约束。

### Deployment/docs: create or modify

- `compose.yml` — 可选 `voice` profile 的 Coturn 4.17.2 service 与 backend env。
- `.env.example` — WebRTC/TURN 配置示例。
- `.github/workflows/ci.yml` — 新增 call/WebRTC 前后端测试，Compose 使用安全占位 TURN env。
- `README.md` — 语音通话、TURN 部署、端口、Safari 限制和验证步骤。
- `docs/superpowers/specs/2026-08-31-voice-call-design.md` — 仅在实现中发现必须澄清的矛盾时修改，不扩展第一版范围。

---

### Task 1: Redis Call Store

**Files:**
- Create: `backend/internal/app/call_store.go`
- Create: `backend/internal/app/call_store_test.go`
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

**Interfaces:**
- Produces:
  ```go
  type callStatus string

  const (
      callStatusRinging callStatus = "ringing"
      callStatusActive  callStatus = "active"
  )

  type callRecord struct {
      ID         string     `json:"id"`
      CallerID   int64      `json:"callerId"`
      CalleeID   int64      `json:"calleeId"`
      Status     callStatus `json:"status"`
      CreatedAt  time.Time  `json:"createdAt"`
      AcceptedA