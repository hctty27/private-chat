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
      AcceptedAt *time.Time `json:"acceptedAt,omitempty"`
  }

  type callStore interface {
      CreateRinging(context.Context, callRecord, time.Duration) error
      Get(context.Context, string) (callRecord, error)
      FindByUser(context.Context, int64) (callRecord, error)
      MarkActive(context.Context, string, int64, time.Time, time.Duration) (callRecord, error)
      Delete(context.Context, string) (callRecord, error)
  }
  ```
- Produces sentinel errors:
  ```go
  var (
      errCallNotFound = errors.New("call not found")
      errCallBusy     = errors.New("user already has a call")
      errCallState    = errors.New("invalid call state")
      errCallRole     = errors.New("invalid call role")
  )
  ```
- Key format:
  ```text
  voice_call:session:{callId}
  voice_call:user:{userId}
  ```

- [ ] **Step 1: Add miniredis test dependency**

Run:

```bash
cd backend
go get github.com/alicebob/miniredis/v2@v2.38.0
```

Expected: `go.mod` / `go.sum` include `github.com/alicebob/miniredis/v2`.

- [ ] **Step 2: Write failing store tests**

Create `backend/internal/app/call_store_test.go` with tests that use a real `go-redis` client against `miniredis.RunT(t)`:

```go
func TestRedisCallStoreCreateRingingClaimsBothUsers(t *testing.T) {
    store, mini := newTestCallStore(t)
    record := callRecord{
        ID: "call-1", CallerID: 1, CalleeID: 2,
        Status: callStatusRinging, CreatedAt: time.Unix(100, 0).UTC(),
    }

    if err := store.CreateRinging(context.Background(), record, time.Minute); err != nil {
        t.Fatalf("create ringing: %v", err)
    }

    mini.CheckGet(t, "voice_call:user:1", "call-1")
    mini.CheckGet(t, "voice_call:user:2", "call-1")
}
```

Also add:

```go
func TestRedisCallStoreRejectsSecondCallForEitherBusyUser(t *testing.T)
func TestRedisCallStoreConcurrentCrossInviteCreatesOnlyOneCall(t *testing.T)
func TestRedisCallStoreMarkActiveRequiresCalleeAndRingingState(t *testing.T)
func TestRedisCallStoreMarkActiveRefreshesAllTTLs(t *testing.T)
func TestRedisCallStoreDeleteOnlyRemovesMappingsOwnedByCall(t *testing.T)
func TestRedisCallStoreFindByUserReturnsCallRecord(t *testing.T)
```

For TTL tests use `mini.TTL(key)` rather than sleeping.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
cd backend
go test ./internal/app -run 'TestRedisCallStore' -count=1
```

Expected: FAIL because `newRedisCallStore`, `callRecord`, and store methods do not exist.

- [ ] **Step 4: Implement the Redis store**

Create `backend/internal/app/call_store.go`.

Use JSON for `voice_call:session:*` values and string values for `voice_call:user:*`.

`CreateRinging` must use Redis `WATCH` on both user keys and retry `redis.TxFailedErr` up to 5 times:

```go
func (s *redisCallStore) CreateRinging(ctx context.Context, record callRecord, ttl time.Duration) error {
    callerKey := callUserKey(record.CallerID)
    calleeKey := callUserKey(record.CalleeID)

    for attempt := 0; attempt < 5; attempt++ {
        err := s.client.Watch(ctx, func(tx *redis.Tx) error {
            values, err := tx.MGet(ctx, callerKey, calleeKey).Result()
            if err != nil {
                return err
            }
            if values[0] != nil || values[1] != nil {
                return errCallBusy
            }

            raw, err := json.Marshal(record)
            if err != nil {
                return err
            }

            _, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
                pipe.Set(ctx, callSessionKey(record.ID), raw, ttl)
                pipe.Set(ctx, callerKey, record.ID, ttl)
                pipe.Set(ctx, calleeKey, record.ID, ttl)
                return nil
            })
            return err
        }, callerKey, calleeKey)

        if !errors.Is(err, redis.TxFailedErr) {
            return err
        }
    }
    return errCallBusy
}
```

`MarkActive` and `Delete` must similarly WATCH the session key plus user mapping keys so they cannot overwrite/delete a newer call.

- [ ] **Step 5: Run store tests**

Run:

```bash
cd backend
go test ./internal/app -run 'TestRedisCallStore' -count=1
```

Expected: PASS.

- [ ] **Step 6: Run backend suite and commit**

Run:

```bash
cd backend
gofmt -w internal/app/call_store.go internal/app/call_store_test.go
go test ./...
go vet ./...
git add backend/go.mod backend/go.sum backend/internal/app/call_store.go backend/internal/app/call_store_test.go
git commit -m "feat: add redis voice call state store"
```

Expected: all backend checks pass.

---

### Task 2: Call Manager and WebSocket Protocol

**Files:**
- Create: `backend/internal/app/call_manager.go`
- Create: `backend/internal/app/call_manager_test.go`
- Create: `backend/internal/app/call_ws.go`
- Create: `backend/internal/app/call_ws_test.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/app/ws.go`

**Interfaces:**
- Consumes: `callStore` from Task 1.
- Produces:
  ```go
  type callManager struct {
      store          callStore
      requireContact func(context.Context, int64, int64) error
      isConnected    func(int64) bool
      send           func(int64, any)
      newID          func() string
      now            func() time.Time
      schedule       func(time.Duration, func())
      ringingTTL     time.Duration
      activeTTL      time.Duration
  }

  func (m *callManager) Invite(context.Context, int64, int64) error
  func (m *callManager) Accept(context.Context, int64, string) error
  func (m *callManager) Reject(context.Context, int64, string, string) error
  func (m *callManager) Cancel(context.Context, int64, string) error
  func (m *callManager) Hangup(context.Context, int64, string, string) error
  func (m *callManager) RelayOffer(context.Context, int64, string, map[string]any) error
  func (m *callManager) RelayAnswer(context.Context, int64, string, map[string]any) error
  func (m *callManager) RelayICE(context.Context, int64, string, map[string]any) error
  func (m *callManager) Disconnect(context.Context, int64)
  ```
- `callManager` sends existing protocol names exactly as approved in the spec.

- [ ] **Step 1: Write failing manager tests**

Use a small fake `callStore` plus captured `send(userID, payload)` calls.

Required tests:

```go
func TestCallManagerInviteRejectsSelf(t *testing.T)
func TestCallManagerInviteRequiresContact(t *testing.T)
func TestCallManagerInviteReturnsUnavailableWhenPeerDisconnected(t *testing.T)
func TestCallManagerInviteReturnsBusyWhenStoreIsBusy(t *testing.T)
func TestCallManagerInviteSendsRingingAndIncoming(t *testing.T)
func TestCallManagerAcceptOnlyAllowsCallee(t *testing.T)
func TestCallManagerRejectOnlyAllowsCallee(t *testing.T)
func TestCallManagerCancelOnlyAllowsCallerWhileRinging(t *testing.T)
func TestCallManagerHangupAllowsEitherActiveParticipant(t *testing.T)
func TestCallManagerOfferOnlyAllowsCaller(t *testing.T)
func TestCallManagerAnswerOnlyAllowsCallee(t *testing.T)
func TestCallManagerICEAllowsEitherParticipant(t *testing.T)
func TestCallManagerTimeoutDeletesOnlyStillRingingCall(t *testing.T)
func TestCallManagerDisconnectEndsCurrentCall(t *testing.T)
```

Capture the timeout callback instead of sleeping:

```go
var scheduled func()
manager.schedule = func(_ time.Duration, fn func()) {
    scheduled = fn
}
```

- [ ] **Step 2: Run manager tests to verify failure**

Run:

```bash
cd backend
go test ./internal/app -run 'TestCallManager' -count=1
```

Expected: FAIL because `callManager` does not exist.

- [ ] **Step 3: Implement `call_manager.go`**

Use `uuid.NewString()` as default ID generator and `time.Now().UTC()` as default clock.

`Invite` order must be:

```go
if callerID == calleeID { return errCallRole }
if err := m.requireContact(ctx, callerID, calleeID); err != nil { return err }
if !m.isConnected(calleeID) {
    m.send(callerID, gin.H{"type": "call_unavailable", "data": gin.H{
        "userId": calleeID, "reason": "offline",
    }})
    return nil
}
```

Then `CreateRinging`. On `errCallBusy`, send `call_busy` to caller and return nil.

On success send:

```go
m.send(callerID, gin.H{"type": "call_ringing", "data": gin.H{
    "callId": record.ID, "userId": calleeID,
}})
m.send(calleeID, gin.H{"type": "call_incoming", "data": gin.H{
    "callId": record.ID, "callerId": callerID,
}})
```

Schedule one 60-second timeout that re-reads the call and only ends it if status is still `ringing`.

`Hangup` must notify the other participant with `call_ended` and a bounded reason enum (`hangup`, `failed`, `disconnected`), then delete state.

- [ ] **Step 4: Write failing WebSocket protocol tests**

Create `call_ws_test.go` for:

```go
func TestParseCallIDRejectsEmptyAndOversizedValues(t *testing.T)
func TestParseWebRTCSDPRejectsOversizedSDP(t *testing.T)
func TestParseICECandidateRejectsOversizedCandidate(t *testing.T)
func TestHandleWsCallRoutesInvite(t *testing.T)
func TestHandleWsCallRoutesMediaUnavailableRejectReason(t *testing.T)
```

Use constants:

```go
const (
    maxCallIDLength       = 128
    maxSDPLength          = 48 * 1024
    maxICECandidateLength = 8 * 1024
)
```

No test should log or assert full SDP/candidate values.

- [ ] **Step 5: Implement `call_ws.go` and wire `ws.go`**

Add:

```go
func isCallWebSocketType(msgType string) bool {
    switch msgType {
    case "call_invite", "call_accept", "call_reject", "call_cancel", "call_hangup",
        "webrtc_offer", "webrtc_answer", "webrtc_ice":
        return true
    default:
        return false
    }
}
```

`Session.readLoop()` becomes:

```go
default:
    if isCallWebSocketType(msgType) {
        if err := s.app.handleWsCall(s.userID, msgType, data); err != nil {
            log.Printf("handle call signal failed for user %d: %v", s.userID, err)
        }
    }
```

Do not log `data`.

In `unregisterSession`, only after `hub.Remove(...)` returns true call:

```go
if a.calls != nil {
    a.calls.Disconnect(ctx, session.userID)
}
```

That preserves the current “only the last Session means offline” behavior.

- [ ] **Step 6: Wire the man