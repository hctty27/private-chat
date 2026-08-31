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

- [ ] **Step 6: Wire the manager into `App`**

Add field:

```go
calls *callManager
```

After `app := &App{...}` is constructed:

```go
app.calls = newCallManager(
    newRedisCallStore(rdb),
    app.requireContact,
    func(userID int64) bool { return len(app.hub.GetAll(userID)) > 0 },
    app.sendToUser,
)
```

Do not use Redis presence TTL as the callable test; Hub connection is the authoritative current-process signal.

- [ ] **Step 7: Run protocol/backend tests and commit**

Run:

```bash
cd backend
gofmt -w internal/app/call_manager.go internal/app/call_manager_test.go internal/app/call_ws.go internal/app/call_ws_test.go internal/app/app.go internal/app/ws.go
go test ./internal/app -run 'Test(CallManager|ParseCall|ParseWebRTC|ParseICE|HandleWsCall)' -count=1
go test ./...
go vet ./...
git add backend/internal/app
git commit -m "feat: add voice call websocket signaling"
```

Expected: PASS.

---

### Task 3: TURN Configuration and ICE Config API

**Files:**
- Create: `backend/internal/app/webrtc.go`
- Create: `backend/internal/app/webrtc_test.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/config/config.go`
- Create or modify: `backend/internal/config/config_test.go`
- Modify: `.env.example`
- Modify: `compose.yml`

**Interfaces:**
- Produces endpoint:
  ```text
  GET /api/webrtc/ice-config
  ```
- Produces config fields:
  ```go
  WebRTCIcePolicy         string
  WebRTCStunURL           string
  WebRTCTurnURLs          []string
  WebRTCTurnSecret        string
  WebRTCTurnCredentialTTL time.Duration
  ```
- Produces frontend response shape:
  ```json
  {
    "code": 200,
    "data": {
      "iceServers": [
        {"urls":["stun:turn.example.com:3478"]},
        {
          "urls":["turn:turn.example.com:3478?transport=udp"],
          "username":"<expiry>:<userId>",
          "credential":"<base64-hmac>"
        }
      ],
      "iceTransportPolicy":"all"
    }
  }
  ```

- [ ] **Step 1: Write failing config tests**

Create/update `backend/internal/config/config_test.go`:

```go
func TestConfigValidateAcceptsAllIcePolicy(t *testing.T)
func TestConfigValidateAcceptsRelayIcePolicy(t *testing.T)
func TestConfigValidateRejectsUnknownIcePolicy(t *testing.T)
func TestConfigValidateRequiresTurnURL(t *testing.T)
func TestConfigValidateRequiresTurnSecret(t *testing.T)
func TestConfigLoadUsesTenMinuteTurnCredentialTTLByDefault(t *testing.T)
```

Test with a helper that starts from a valid config so existing JWT validation remains satisfied.

- [ ] **Step 2: Implement WebRTC config fields**

In `Load()` use:

```go
WebRTCIcePolicy:         envOrDefault("WEBRTC_ICE_POLICY", "all"),
WebRTCStunURL:           envOrDefault("WEBRTC_STUN_URL", ""),
WebRTCTurnURLs:          envList("WEBRTC_TURN_URLS"),
WebRTCTurnSecret:        envOrDefault("WEBRTC_TURN_SECRET", ""),
WebRTCTurnCredentialTTL: envDurationOrDefault("WEBRTC_TURN_CREDENTIAL_TTL", 10*time.Minute),
```

In `Validate()` require:

```go
if c.WebRTCIcePolicy != "all" && c.WebRTCIcePolicy != "relay" { ... }
if len(c.WebRTCTurnURLs) == 0 { ... }
if strings.TrimSpace(c.WebRTCTurnSecret) == "" { ... }
if c.WebRTCTurnCredentialTTL <= 0 { ... }
if c.WebRTCIcePolicy == "all" && strings.TrimSpace(c.WebRTCStunURL) == "" { ... }
```

- [ ] **Step 3: Write failing TURN credential tests**

Create `webrtc_test.go`:

```go
func TestGenerateTurnCredentialUsesExpiryAndUserID(t *testing.T) {
    now := time.Unix(1_788_166_800, 0).UTC()
    username, credential := generateTurnCredential("shared-secret", 7, now, 10*time.Minute)

    if username != "1788167400:7" {
        t.Fatalf("unexpected username %q", username)
    }

    mac := hmac.New(sha1.New, []byte("shared-secret"))
    _, _ = mac.Write([]byte(username))
    expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
    if credential != expected {
        t.Fatalf("credential mismatch")
    }
}
```

Also test `iceConfigHandler` returns no shared secret and route is protected by `secureAuthMiddleware`.

- [ ] **Step 4: Implement `webrtc.go` and protected route**

Implement:

```go
func generateTurnCredential(secret string, userID int64, now time.Time, ttl time.Duration) (string, string) {
    expiry := now.Add(ttl).Unix()
    username := fmt.Sprintf("%d:%d", expiry, userID)
    mac := hmac.New(sha1.New, []byte(secret))
    _, _ = mac.Write([]byte(username))
    return username, base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
```

Handler builds one STUN server when configured and one TURN server containing all configured TURN URLs.

Register inside the existing protected API group:

```go
protected.GET("/webrtc/ice-config", a.iceConfigHandler)
```

- [ ] **Step 5: Update env/compose backend wiring**

Add to `.env.example`:

```dotenv
WEBRTC_ICE_POLICY=all
WEBRTC_STUN_URL=stun:turn.example.com:3478
WEBRTC_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
WEBRTC_TURN_SECRET=<replace_with_long_random_turn_shared_secret>
WEBRTC_TURN_CREDENTIAL_TTL=10m
```

Add the same variables to the backend `environment:` list in `compose.yml`.

Do not expose `WEBRTC_TURN_SECRET` to the frontend service.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd backend
gofmt -w internal/config/config.go internal/config/config_test.go internal/app/webrtc.go internal/app/webrtc_test.go internal/app/app.go
go test ./...
go vet ./...
cd ..
docker compose config --quiet
git add backend .env.example compose.yml
git commit -m "feat: issue temporary turn credentials"
```

Expected: PASS.

---

### Task 4: Frontend Call Protocol Types and WebSocket Observer

**Files:**
- Create: `frontend/src/types/call.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/index.ts`
- Modify: `frontend/src/stores/chat.ts`
- Modify: `frontend/src/stores/chat.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WebRtcIceConfig {
    iceServers: RTCIceServer[]
    iceTransportPolicy: RTCIceTransportPolicy
  }

  export type CallPhase =
    | 'idle'
    | 'outgoing'
    | 'incoming'
    | 'connecting'
    | 'connected'
    | 'ended'
    | 'failed'
  ```
- `useChatStore()` additionally produces:
  ```ts
  onWsMessage(listener: (message: WsServerMessage) => void): () => void
  ```

- [ ] **Step 1: Write failing observer test**

Add to `frontend/src/stores/chat.test.ts`:

```ts
it('notifies websocket observers about call events without owning call state', () => {
  const store = useChatStore()
  const seen: WsServerMessage[] = []
  const unsubscribe = store.onWsMessage((message) => seen.push(message))

  store.handleWsMessageForTest?.({
    type: 'call_incoming',
    data: { callId: 'call-1', callerId: 2 },
  } as WsServerMessage)

  expect(seen).toHaveLength(1)
  unsubscribe()
})
```

Do not add a production-only `handleWsMessageForTest`. Instead expose/refactor a private `dispatchServerMessage` through a test seam already used by the fake WebSocket in `chat.test.ts`; adapt the exact test to the repository's existing WebSocket mock pattern.

The behavior being tested is exact: observers receive call messages, while existing chat/read/online behavior remains unchanged.

- [ ] **Step 2: Add call TypeScript types**

Create `frontend/src/types/call.ts` with explicit client/server payloads:

```ts
export type CallEndReason = 'hangup' | 'failed' | 'disconnected'
export type CallRejectReason = 'rejected' | 'media_unavailable'

export interface WsCallIncoming {
  type: 'call_incoming'
  data: { callId: string; callerId: number }
}

export interface WsCallRinging {
  type: 'call_ringing'
  data: { callId: string; userId: number }
}

export interface WsWebRtcOffer {
  type: 'webrtc_offer'
  data: { callId: string; sdp: RTCSessionDescriptionInit }
}

export interface WsWebRtcAnswer {
  type: 'webrtc_answer'
  data: { callId: string; sdp: RTCSessionDescriptionInit }
}

export interface WsWebRtcIce {
  type: 'webrtc_ice'
  data: { callId: string; candidate: RTCIceCandidateInit }
}

```

Include the remaining busy/unavailable/accepted/rejected/cancelled/timeout/ended and client-side invite/accept/reject/cancel/hangup/offer/answer/ice types.

Re-export from `types/index.ts` and extend `WsServerMessage` / `WsClientMessage` unions.

- [ ] **Step 3: Add ICE config API function**

In `frontend/src/api/index.ts`:

```ts
export function getWebRtcIceConfig() {
  return api.get<ApiResponse<WebRtcIceConfig>>('/api/webrtc/ice-config')
}
```

Import `WebRtcIceConfig` from `../types`.

- [ ] **Step 4: Implement WS observer without importing call store**

In `chat.ts`:

```ts
const wsMessageListeners = new Set<(message: WsServerMessage) => void>()

function onWsMessage(listener: (message: WsServerMessage) => void) {
  wsMessageListeners.add(listener)
  return () => wsMessageListeners.delete(listener)
}

function notifyWsMessage(message: WsServerMessage) {
  for (const listener of wsMessageListeners) listener(message)
}
```

In `socket.onmessage`, call `notifyWsMessage(data)` before the `kicked` early return and before existing message routing.

Do not clear `wsMessageListeners` in `clearState()`; a Pinia call store may stay alive across reconnects. Its subscription must be idempotent and explicitly disposable.

Export `onWsMessage`.

- [ ] **Step 5: Run frontend tests and commit**

Run:

```bash
cd frontend
npm run test -- src/stores/chat.test.ts
npm run typecheck
git add src/types src/api/index.ts src/stores/chat.ts src/stores/chat.test.ts
git commit -m "feat: expose voice call websocket protocol"
```

Expected: PASS.

---

### Task 5: WebRTC Media Controller

**Files:**
- Create: `frontend/src/composables/useWebRtcCall.ts`
- Create: `frontend/src/composables/useWebRtcCall.test.ts`

**Interfaces:**
- Consumes: `WebRtcIceConfig`.
- Produces:
  ```ts
  export interface WebRtcCallCallbacks {
    sendOffer(sdp: RTCSessionDescriptionInit): void
    sendAnswer(sdp: RTCSessionDescriptionInit): void
    sendIce(candidate: RTCIceCandidateInit): void
    onConnected(): void
    onFailed(message: string): void
    onRemoteStream(stream: MediaStream): void
  }

  export interface WebRtcCallController {
    prepare(): Promise<void>
    startCaller(): Promise<void>
    acceptOffer(offer: RTCSessionDescriptionInit): Promise<void>
    applyAnswer(answer: RTCSessionDescriptionInit): Promise<void>
    addRemoteIce(candidate: RTCIceCandidateInit): Promise<void>
    setMuted(muted: boolean): void
    cleanup(): void
  }

  export function useWebRtcCall(
    getIceConfig: () => Promise<WebRtcIceConfig>,
    callbacks: WebRtcCallCallbacks,
    deps?: WebRtcBrowserDeps,
  ): WebRtcCallController
  ```

- [ ] **Step 1: Write failing tests with fake browser APIs**

Create a fake `RTCPeerConnection` and fake `MediaStreamTrack`.

Required tests:

```ts
it('prepares microphone and ice config before signaling')
it('caller sets local offer then emits it')
it('callee sets remote offer before creating answer')
it('queues remote ice until remote description exists')
it('flushes queued ice in arrival order after remote description')
it('mutes only local audio tracks')
it('cleanup stops every local track and closes peer connection exactly once')
it('waits 10 seconds before failing a disconnected ice state')
it('cancels the disconnect timer when connection recovers')
```

Use `vi.useFakeTimers()` for the 10-second grace period.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd frontend
npm run test -- src/composables/useWebRtcCall.test.ts
```

Expected: FAIL because controller does not exist.

- [ ] **Step 3: Implement `prepare()`**

`prepare()` must start `getUserMedia` immediately:

```ts
async function prepare() {
  if (localStream && iceConfig) return

  const mediaPromise = deps.getUserMedia({ audio: true })
  const configPromise = getIceConfig()

  const [stream, config] = await Promise.all([mediaPromise, configPromise])
  localStream = stream
  iceConfig = config
}
```

This is the method called directly from the user's click/tap path before `call_invite` or `call_accept`.

- [ ] **Step 4: Implement peer creation and SDP flow**

`ensurePeer()`:

```ts
const peer = deps.createPeerConnection({
  iceServers: iceConfig!.iceServers,
  iceTransportPolicy: iceConfig!.iceTransportPolicy,
})
for (const track of localStream!.getAudioTracks()) {
  peer.addTrack(track, localStream!)
}
```

`peer.onicecandidate` sends only non-null candidates:

```ts
peer.onicecandidate = (event) => {
  if (event.candidate) callbacks.sendIce(event.candidate.toJSON())
}
```

`addRemoteIce()`:

```ts
if (!peer?.remoteDescription) {
  pendingRemoteIce.push(candidate)
  return
}
await peer.addIceCandidate(candidate)
```

After every successful `setRemoteDescription()`, flush `pendingRemoteIce` in FIFO order.

- [ ] **Step 5: Implement connection state and cleanup**

Treat `connected`/`completed` as connected.

On `disconnected`, start one 10-second timer. Cancel it if the state recovers.

On `failed`, or if the 10-second timer expires, call `callbacks.onFailed('通话连接失败')` once.

`cleanup()` must:

```ts
disconnectTimer && clearTimeout(disconnectTimer)
for (const track of localStream?.getTracks() ?? []) track.stop()
peer?.close()
pendingRemoteIce.length = 0
localStream = null
peer = null
iceConfig = null
```

Make it idempotent.

- [ ] **Step 6: Run tests/typecheck and commit**

Run:

```bash
cd frontend
npm run test -- src/composables/useWebRtcCall.test.ts
npm run typecheck
git add src/composables/useWebRtcCall.ts src/composables/useWebRtcCall.test.ts
git commit -m "feat: add webrtc voice media controller"
```

Expected: PASS.

---

### Task 6: Pinia Call Store and Lifecycle

**Files:**
- Create: `frontend/src/stores/call.ts`
- Create: `frontend/src/stores/call.test.ts`
- Modify: `frontend/src/stores/chat.ts` only if a test exposes a missing transport hook.

**Interfaces:**
- Consumes: `useChatStore().sendWsMessage`, `useChatStore().onWsMessage`, `getWebRtcIceConfig`, `useWebRtcCall`.
- Produces:
  ```ts
  export const useCallStore = defineStore('call', () => {
    const phase = ref<CallPhase>('idle')
    const callId = ref<string | null>(null)
    const peerUserId = ref<number | null>(null)
    const peerName = ref('')
    const muted = ref(false)
    const connectedAt = ref<number | null>(null)
    const durationSeconds = ref(0)
    const error = ref('')
    const remoteStream = ref<MediaStream | null>(null)

    async function startCall(contact: Contact): Promise<void>
    async function acceptCall(): Promise<void>
    function rejectCall(): void
    function cancelCall(): void
    function hangup(): void
    function toggleMute(): void
    function cleanupLocal(): void
    function ensureBound(): void

    return { ... }
  })
  ```

- [ ] **Step 1: Write failing call store tests**

Mock `useWebRtcCall` and use a fake chat transport.

Required tests:

```ts
it('does not send call_invite when prepare fails')
it('sends call_invite only after prepare succeeds')
it('records callId from call_ringing')
it('enters incoming state from call_incoming even when no conversation is selected')
it('callee prepares media before sending call_accept')
it('sends media_unavailable rejection if callee prepare fails')
it('caller starts offer only after call_accepted')
it('routes offer answer and ice to the webrtc controller')
it('returns to idle after busy unavailable rejected cancelled timeout and ended')
it('sends hangup after local peer failure when a callId exists')
it('stops tracks and timers on kicked websocket message')
it('cleanupLocal is idempotent')
```

- [ ] **Step 2: Implement idempotent WS binding**

`ensureBound()` subscribes exactly once:

```ts
let unsubscribeWs: (() => void) | null = null

function ensureBound() {
  if (unsubscribeWs) return
  const chat = useChatStore()
  unsubscribeWs = chat.onWsMessage(handleServerMessage)
}
```

Initialize a `watch` on `chat.wsConnected`. If an established/outgoing/incoming call exists and the socket becomes disconnected, display network failure and run local cleanup; the server remains authoritative for peer notification on Session removal.

- [ ] **Step 3: Implement outgoing preparation order**

```ts
async function startCall(contact: Contact) {
  ensureBound()
  if (phase.value !== 'idle') return

  peerUserId.value = contact.userId
  peerName.value = contact.nickname
  error.value = ''

  try {
    await rtc.prepare()
  } catch {
    error.value = '无法访问麦克风或通话服务不可用'
    cleanupLocal()
    return
  }

  phase.value = 'outgoing'
  useChatStore().sendWsMessage({
    type: 'call_invite',
    data: { receiverId: contact.userId },
  })
}
```

If the user presses cancel before `call_ringing` provides the `callId`, set `cancelPendingInvite = true`; when `call_ringing` arrives, immediately send `call_cancel`.

- [ ] **Step 4: Implement incoming/accept/reject**

On `call_incoming`, resolve `peerName` from `chat.contacts` by `callerId`, defaulting to `联系人`.

On accept:

```ts
try {
  await rtc.prepare()
  phase.value = 'connecting'
  chat.sendWsMessage({ type: 'call_accept', data: { callId: callId.value! } })
} catch {
  chat.sendWsMessage({
    type: 'call_reject',
    data: { callId: callId.value!, reason: 'media_unavailable' },
  })
  error.value = '无法访问麦克风或通话服务不可用'
  cleanupLocal()
}
```

- [ ] **Step 5: Implement WebRTC message handling**

- `call_accepted`: if this client is caller, `await rtc.startCaller()`.
- `webrtc_offer`: `await rtc.acceptOffer(data.sdp)`.
- `webrtc_answer`: `await rtc.applyAnswer(data.sdp)`.
- `webrtc_ice`: `await rtc.addRemoteIce(data.candidate)`.
- `rtc.onConnected`: phase `connected`, set `connectedAt`, start one 1-second duration timer.
- `rtc.onFailed`: send `call_hangup` with reason `failed` if `callId` exists; local phase `failed`; cleanup media and timer.

- [ ] **Step 6: Implement terminal-event reset policy**

For `call_busy`, `call_unavailable`, `call_rejected`, `call_cancelled`, `call_timeout`, `call_ended`:

1. Set a user-visible `error`/terminal message when relevant.
2. Stop media/timers.
3. Keep `ended`/`failed` phase for 1200 ms so UI can display the reason.
4. Reset call-specific identifiers to idle after that delay.

Use one reset timer and clear it on every new call.

- [ ] **Step 7: Run tests/typecheck and commit**

Run:

```bash
cd frontend
npm run test -- src/stores/call.test.ts
npm run typecheck
git add src/stores/call.ts src/stores/call.test.ts
git commit -m "feat: add voice call client state machine"
```

Expected: PASS.

---

### Task 7: Desktop and Mobile Voice Call UI

**Files:**
- Create: `frontend/src/components/VoiceCallButton.vue`
- Create: `frontend/src/components/VoiceCallOverlay.vue`
- Create: `frontend/src/components/IncomingCallOverlay.vue`
- Create: `frontend/src/components/VoiceCallOverlay.test.ts`
- Create: `frontend/src/views/VoiceCallIntegration.test.ts`
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`
- Modify: `frontend/src/views/MobileChat.ios.test.ts`

**Interfaces:**
- Consumes: `useCallStore()`.
- `VoiceCallButton` props:
  ```ts
  defineProps<{
    disabled?: boolean
    label?: string
  }>()
  ```
- `VoiceCallButton` emits `call`.
- Overlay components emit `accept`, `reject`, `hangup`, `toggle-mute`, `resume-audio` as applicable.

- [ ] **Step 1: Write failing shared UI tests**

`VoiceCallOverlay.test.ts`:

```ts
it('shows calling text for outgoing phase')
it('shows mm:ss duration when connected')
it('emits toggle-mute and hangup')
it('shows terminal error text')
```

`IncomingCallOverlay`:

```ts
it('shows caller name and emits accept/reject')
```

Use `@vue/test-utils`.

- [ ] **Step 2: Implement shared components**

`VoiceCallButton.vue` must use a real `<button type="button">`, 44px minimum mobile touch target, and inline SVG phone icon; no emoji glyph.

`VoiceCallOverlay.vue` root style must be viewport-fixed:

```css
.voice-call-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

Do not place it inside `.msg-scroll`.

`IncomingCallOverlay.vue` uses the same fixed layer and buttons with clear `aria-label`.

- [ ] **Step 3: Add desktop header integration**

In `ChatPage.vue` change `.chat-head` layout so identity stays left and `VoiceCallButton` is at right:

```vue
<VoiceCallButton
  :disabled="!chatStore.wsConnected || callStore.phase !== 'idle'"
  @call="startCurrentCall"
/>
```

`startCurrentCall()`:

```ts
function startCurrentCall() {
  const contact = chatStore.currentContact
  if (contact) void callStore.startCall(contact)
}
```

Mount `IncomingCallOverlay` and `VoiceCallOverlay` outside the `v-if="chatStore.currentContact"` branch so incoming calls render even when no conversation is selected.

Call `callStore.ensureBound()` in `onMounted()`.

Before logout:

```ts
callStore.cleanupLocal()
```

- [ ] **Step 4: Add mobile header integration without touching viewport math**

Replace `.chat-head-spacer` with a 44px `VoiceCallButton` slot so the current 44 / center / 44 grid remains balanced.

Required structure:

```vue
<div class="chat-head">
  <button class="back tap-target" ...>‹</button>
  <div class="ch-info">...</div>
  <VoiceCallButton class="mobile-call-button" ... />
</div>
```

Mount call overlays directly under `.mobile-root`, not under `.chat-page`, `.msg-scroll`, `.input-bar`, or any mobile history overlay.

Do not add call state to `useMobileChatHistory`.

- [ ] **Step 5: Add source-level regression tests for iOS isolation**

Extend `MobileChat.ios.test.ts`:

```ts
it('keeps voice call overlays outside the visual viewport chat shell', () => {
  expect(mobileChatSource).toContain('<IncomingCallOverlay')
  expect(mobileChatSource).toContain('<VoiceCallOverlay')
  expect(mobileChatSource).not.toContain("mobileHistory.pushOverlay(contactId, 'call')")
})
```

`VoiceCallIntegration.test.ts` should assert both desktop and mobile contain the call button and call overlays, and mobile still contains:

```text
viewportTop.value = vv ? Math.max(0, vv.pageTop) : 0
useChatScroll(listEl, uid, { virtualized: false })
```

- [ ] **Step 6: Run UI tests and build**

Run:

```bash
cd frontend
npm run test -- \
  src/components/VoiceCallOverlay.test.ts \
  src/views/VoiceCallIntegration.test.ts \
  src/views/MobileChat.ios.test.ts \
  src/stores/call.test.ts \
  src/composables/useWebRtcCall.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit UI**

```bash
git add frontend/src/components frontend/src/views
git commit -m "feat: add desktop and mobile voice call ui"
```

---

### Task 8: Coturn Deployment Profile

**Files:**
- Modify: `compose.yml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces optional Compose service `coturn` under profile `voice`.
- Uses Coturn image `coturn/coturn:4.17.2-r0`.
- Default relay UDP range: `49160-49200`.

- [ ] **Step 1: Add Coturn environment placeholders**

Append to `.env.example`:

```dotenv
# Optional self-hosted Coturn profile
WEBRTC_TURN_REALM=turn.example.com
WEBRTC_TURN_EXTERNAL_IP=<public_ipv4>
WEBRTC_TURN_MIN_PORT=49160
WEBRTC_TURN_MAX_PORT=49200
```

Keep `WEBRTC_TURN_SECRET` shared with the backend configuration from Task 3.

- [ ] **Step 2: Add optional Coturn service**

In `compose.yml` add:

```yaml
  coturn:
    image: coturn/coturn:4.17.2-r0
    container_name: private-chat-coturn
    profiles: ["voice"]
    restart: unless-stopped
    command:
      - --log-file=stdout
      - --fingerprint
      - --use-auth-secret
      - --static-auth-secret=${WEBRTC_TURN_SECRET:?missing WEBRTC_TURN_SECRET}
      - --realm=${WEBRTC_TURN_REALM:?missing WEBRTC_TURN_REALM}
      - --external-ip=${WEBRTC_TURN_EXTERNAL_IP:?missing WEBRTC_TURN_EXTERNAL_IP}
      - --min-port=${WEBRTC_TURN_MIN_PORT:-49160}
      - --max-port=${WEBRTC_TURN_MAX_PORT:-49200}
      - --no-cli
    ports:
      - "3478:3478/tcp"
      - "3478:3478/udp"
      - "${WEBRTC_TURN_MIN_PORT:-49160}-${WEBRTC_TURN_MAX_PORT:-49200}:${WEBRTC_TURN_MIN_PORT:-49160}-${WEBRTC_TURN_MAX_PORT:-49200}/udp"
```

First release supports TURN UDP/TCP on 3478. `turns:` 5349 is documented as an optional production hardening step requiring a certificate/key mount; do not pretend TLS works unless cert paths are actually configured.

- [ ] **Step 3: Add README deployment procedure**

Document:

```bash
docker compose --profile voice up -d --build
```

Document firewall rules:

```text
TCP 3478
UDP 3478
UDP 49160-49200
```

Explain that `WEBRTC_TURN_URLS` must point to the publicly reachable TURN host, not the Docker service name used inside `my-network .

Document optional TLS/5349 separately, including that browser `turns:` URLs must only be configured after Coturn is actually serving a valid TLS certificate.

- [ ] **Step 4: Validate Compose and commit**

Run:

```bash
export POSTGRES_HOST=postgres.example
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=postgres
export POSTGRES_DB=private_chat
export REDIS_PASSWORD=redis-password
export R2_ENDPOINT=https://example.r2.cloudflarestorage.com
export R2_ACCESS_KEY=access-key
expor