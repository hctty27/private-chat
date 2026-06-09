# Chat Reliability Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first phase of the experience optimization: reliable message sending, clear connection feedback, new-message bottom control, and upload retry feedback.

**Architecture:** Add a lightweight `clientMsgId` echo to WebSocket chat responses so the frontend can replace local temporary messages with server-confirmed messages. Keep local send/upload state in the Pinia chat store, expose small state-driven UI components, and extend the existing scroll composable instead of rewriting chat pages.

**Tech Stack:** Go 1.22 + Gin + GORM + Gorilla WebSocket, Vue 3 + TypeScript + Pinia + Element Plus + @tanstack/vue-virtual.

---

## Scope Boundary

This plan implements **Phase 1: Core Reliability Experience** from `docs/superpowers/specs/2026-06-08-experience-optimization-design.md`.

It intentionally does not implement the Phase 2 mobile keyboard refinements or Phase 3 polish work. Those phases should get separate plans after Phase 1 is verified.

Commit commands are included as checkpoint instructions for an authorized execution session. If commits are not explicitly authorized, run the `git diff --check` and verification commands, but do not run `git commit`.

---

## File Structure

### Backend

- Modify: `backend/internal/app/ws.go`
  - Read `clientMsgId` from incoming chat data.
  - Echo `clientMsgId` in live WebSocket chat responses without changing the database schema.
- Create: `backend/internal/app/ws_payload_test.go`
  - Verify chat response payload includes non-empty `clientMsgId`.
  - Verify blank `clientMsgId` is omitted.

### Frontend Types and Utilities

- Modify: `frontend/src/types/index.ts`
  - Add local message status fields to `Message`.
  - Allow `clientMsgId` in client and server WebSocket chat data.
- Create: `frontend/src/utils/chatLocal.ts`
  - Generate `clientMsgId`.
  - Create local temporary messages.
  - Build conversation IDs consistently with backend behavior.
  - Decide whether a message belongs to a conversation.

### Frontend Store

- Modify: `frontend/src/stores/chat.ts`
  - Replace opaque pending queue with tracked chat payload queue.
  - Add local send, queue, timeout, ack replacement, retry, and upload-progress handling.
  - Add manual reconnect and short recovered notice state.

### Frontend Scroll and UI

- Modify: `frontend/src/composables/useChatScroll.ts`
  - Add `newMessageCount`, `showBottomButton`, and `scrollToBottomAndClear()`.
  - Preserve existing load-more anchor logic.
- Create: `frontend/src/components/ConnectionNotice.vue`
  - Render reconnecting, disconnected, recovered, and queued-message states.
- Create: `frontend/src/components/MessageStatusIndicator.vue`
  - Render sending, queued, uploading progress, failed retry, and read/unread state.
- Create: `frontend/src/components/NewMessageButton.vue`
  - Floating bottom button for “new messages” or “back to bottom”.
- Modify: `frontend/src/views/ChatPage.vue`
  - Use the new components and store actions.
- Modify: `frontend/src/views/MobileChat.vue`
  - Use the new components and store actions.
- Modify: `.gitignore`
  - Ignore `.superpowers/` visual companion artifacts.

---

## Task 1: Ignore Visual Companion Artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update `.gitignore`**

Append this block to `.gitignore`:

```gitignore
# Superpowers visual companion artifacts
.superpowers/
```

- [ ] **Step 2: Verify ignore rule works**

Run:

```bash
git -C /home/project/private-chat status --short --ignored .superpowers
```

Expected output includes an ignored `.superpowers/` entry similar to:

```text
!! .superpowers/
```

- [ ] **Step 3: Check diff**

Run:

```bash
git -C /home/project/private-chat diff -- .gitignore
```

Expected: only the `.superpowers/` ignore block is added.

- [ ] **Step 4: Checkpoint commit if authorized**

Run only if commits are authorized:

```bash
git -C /home/project/private-chat add .gitignore
git -C /home/project/private-chat commit -m "chore: ignore visual companion artifacts"
```

---

## Task 2: Add Backend `clientMsgId` Echo

**Files:**
- Modify: `backend/internal/app/ws.go`
- Create: `backend/internal/app/ws_payload_test.go`

- [ ] **Step 1: Write failing backend tests**

Create `backend/internal/app/ws_payload_test.go` with this content:

```go
package app

import (
	"encoding/json"
	"strings"
	"testing"

	"privatechat/internal/model"
)

func TestChatResponsePayloadIncludesClientMsgID(t *testing.T) {
	clientMsgID := "client-abc-123"
	payload := chatResponsePayload(model.MessageDTO{
		ID:             42,
		ConversationID: "1_2",
		SenderID:       1,
		ReceiverID:     2,
		MsgType:        1,
		IsRead:         0,
		CreatedAt:      "2026-06-08T10:00:00",
	}, &clientMsgID)

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if !strings.Contains(string(body), `"clientMsgId":"client-abc-123"`) {
		t.Fatalf("expected clientMsgId in payload, got %s", body)
	}
	if !strings.Contains(string(body), `"id":42`) {
		t.Fatalf("expected message fields in payload, got %s", body)
	}
}

func TestChatResponsePayloadOmitsBlankClientMsgID(t *testing.T) {
	blank := "   "
	payload := chatResponsePayload(model.MessageDTO{ID: 7}, &blank)

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if strings.Contains(string(body), "clientMsgId") {
		t.Fatalf("expected blank clientMsgId to be omitted, got %s", body)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/project/private-chat/backend && go test ./internal/app -run 'TestChatResponsePayload' -count=1
```

Expected: FAIL because `chatResponsePayload` is not defined.

- [ ] **Step 3: Add response helper to `ws.go`**

In `backend/internal/app/ws.go`, add this code after `handleWsChat` or before it:

```go
type wsChatResponse struct {
	model.MessageDTO
	ClientMsgID *string `json:"clientMsgId,omitempty"`
}

func chatResponsePayload(saved model.MessageDTO, clientMsgID *string) any {
	if clientMsgID == nil {
		return saved
	}
	trimmed := strings.TrimSpace(*clientMsgID)
	if trimmed == "" {
		return saved
	}
	return wsChatResponse{
		MessageDTO:  saved,
		ClientMsgID: &trimmed,
	}
}
```

- [ ] **Step 4: Echo `clientMsgId` from `handleWsChat`**

In `backend/internal/app/ws.go`, change `handleWsChat` from this shape:

```go
fileSize := toOptionalInt64(data["fileSize"])

saved, err := a.saveMessage(senderID, receiverID, msgType, content, fileURL, fileName, fileSize)
```

To this shape:

```go
fileSize := toOptionalInt64(data["fileSize"])
clientMsgID := toOptionalString(data["clientMsgId"])

saved, err := a.saveMessage(senderID, receiverID, msgType, content, fileURL, fileName, fileSize)
```

Then replace both live send payloads:

```go
if senderSession := a.hub.Get(senderID); senderSession != nil {
	_ = senderSession.SendJSON(gin.H{"type": "chat", "data": saved})
}
if receiverSession := a.hub.Get(receiverID); receiverSession != nil {
	_ = receiverSession.SendJSON(gin.H{"type": "chat", "data": saved})
}
```

With:

```go
payload := chatResponsePayload(saved, clientMsgID)
if senderSession := a.hub.Get(senderID); senderSession != nil {
	_ = senderSession.SendJSON(gin.H{"type": "chat", "data": payload})
}
if receiverSession := a.hub.Get(receiverID); receiverSession != nil {
	_ = receiverSession.SendJSON(gin.H{"type": "chat", "data": payload})
}
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd /home/project/private-chat/backend && go test ./internal/app -run 'TestChatResponsePayload' -count=1
```

Expected: PASS.

- [ ] **Step 6: Run full backend tests**

Run:

```bash
cd /home/project/private-chat/backend && go test ./...
```

Expected: PASS.

- [ ] **Step 7: Checkpoint commit if authorized**

Run only if commits are authorized:

```bash
git -C /home/project/private-chat add backend/internal/app/ws.go backend/internal/app/ws_payload_test.go
git -C /home/project/private-chat commit -m "feat: echo client message ids over websocket"
```

---

## Task 3: Add Frontend Local Message Types and Helpers

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/utils/chatLocal.ts`

- [ ] **Step 1: Extend message and WebSocket types**

In `frontend/src/types/index.ts`, insert this type before `export interface Message`:

```ts
export type LocalMessageStatus = 'sending' | 'sent' | 'failed' | 'queued' | 'uploading'
```

Change `Message` from:

```ts
export interface Message {
  id: number
  senderId: number
  receiverId: number
  msgType: 1 | 2 | 3 | 4 | 5
  content: string | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  isRead: 0 | 1
  createdAt: string
}
```

To:

```ts
export interface Message {
  id: number
  conversationId?: string
  senderId: number
  receiverId: number
  msgType: 1 | 2 | 3 | 4 | 5
  content: string | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  isRead: 0 | 1
  createdAt: string
  clientMsgId?: string
  localStatus?: LocalMessageStatus
  localError?: string
  uploadProgress?: number
  localFile?: File
}
```

Change `WsClientChat.data` from:

```ts
  data: {
    receiverId: number
    msgType: 1 | 2 | 3 | 4 | 5
    content: string | null
    fileUrl: string | null
    fileName: string | null
    fileSize: number | null
  }
```

To:

```ts
  data: {
    receiverId: number
    msgType: 1 | 2 | 3 | 4 | 5
    content: string | null
    fileUrl: string | null
    fileName: string | null
    fileSize: number | null
    clientMsgId?: string
  }
```

- [ ] **Step 2: Create `chatLocal.ts`**

Create `frontend/src/utils/chatLocal.ts` with this content:

```ts
import type { LocalMessageStatus, Message, WsClientChat } from '../types'

let clientMsgSeq = 0
let tempMessageId = -1

export function createClientMsgId() {
  clientMsgSeq += 1
  return `c_${Date.now().toString(36)}_${clientMsgSeq}`
}

export function nextTempMessageId() {
  tempMessageId -= 1
  return tempMessageId
}

export function conversationIdFor(a: number, b: number) {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

export function createLocalMessage(options: {
  currentUserId: number
  receiverId: number
  msgType: 1 | 2 | 3 | 4 | 5
  content: string | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  clientMsgId: string
  status: LocalMessageStatus
  localFile?: File
  uploadProgress?: number
}): Message {
  return {
    id: nextTempMessageId(),
    conversationId: conversationIdFor(options.currentUserId, options.receiverId),
    senderId: options.currentUserId,
    receiverId: options.receiverId,
    msgType: options.msgType,
    content: options.content,
    fileUrl: options.fileUrl,
    fileName: options.fileName,
    fileSize: options.fileSize,
    isRead: 0,
    createdAt: new Date().toISOString(),
    clientMsgId: options.clientMsgId,
    localStatus: options.status,
    localFile: options.localFile,
    uploadProgress: options.uploadProgress,
  }
}

export function belongsToConversation(message: Message, currentUserId: number, targetId: number) {
  return (
    (message.senderId === currentUserId && message.receiverId === targetId) ||
    (message.senderId === targetId && message.receiverId === currentUserId)
  )
}

export function chatPayloadFromMessage(message: Message): WsClientChat['data'] {
  return {
    receiverId: message.receiverId,
    msgType: message.msgType,
    content: message.content,
    fileUrl: message.fileUrl,
    fileName: message.fileName,
    fileSize: message.fileSize,
    clientMsgId: message.clientMsgId,
  }
}
```

- [ ] **Step 3: Run frontend typecheck/build and verify current failures**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: build may fail in later tasks until the store uses the new optional fields. If it fails here, errors should be limited to TypeScript references introduced by these type changes. If it passes, continue.

- [ ] **Step 4: Checkpoint commit if authorized**

Run only if commits are authorized and the frontend build passes at this checkpoint:

```bash
git -C /home/project/private-chat add frontend/src/types/index.ts frontend/src/utils/chatLocal.ts
git -C /home/project/private-chat commit -m "feat: add local chat message types"
```

---

## Task 4: Add Text and Emoji Send Status in Chat Store

**Files:**
- Modify: `frontend/src/stores/chat.ts`

- [ ] **Step 1: Update imports**

In `frontend/src/stores/chat.ts`, change imports from:

```ts
import type { Contact, Message, WsClientMessage, WsServerMessage } from '../types'
```

To:

```ts
import type { Contact, LocalMessageStatus, Message, WsClientChat, WsClientMessage, WsServerMessage } from '../types'
import { belongsToConversation, chatPayloadFromMessage, createClientMsgId, createLocalMessage } from '../utils/chatLocal'
```

- [ ] **Step 2: Replace pending queue state**

Replace:

```ts
const pendingMessages: WsClientMessage[] = []
```

With:

```ts
const pendingMessages: WsClientChat[] = []
const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
const recoveredNotice = ref(false)

const pendingChatCount = computed(() =>
  messages.value.filter((m) => m.localStatus === 'queued' || m.localStatus === 'sending' || m.localStatus === 'uploading').length
)
```

- [ ] **Step 3: Add local message helper functions inside the store**

Add these functions after `loadMessages()`:

```ts
function findLocalByClientMsgId(clientMsgId: string) {
  return messages.value.find((m) => m.clientMsgId === clientMsgId)
}

function setLocalStatus(clientMsgId: string, status: LocalMessageStatus, error = '') {
  const local = findLocalByClientMsgId(clientMsgId)
  if (!local) return
  local.localStatus = status
  local.localError = error || undefined
}

function clearSendTimer(clientMsgId: string) {
  const timer = sendTimers.get(clientMsgId)
  if (timer) clearTimeout(timer)
  sendTimers.delete(clientMsgId)
}

function armSendTimer(clientMsgId: string) {
  clearSendTimer(clientMsgId)
  sendTimers.set(clientMsgId, setTimeout(() => {
    const local = findLocalByClientMsgId(clientMsgId)
    if (!local || local.localStatus === 'sent') return
    local.localStatus = wsConnected.value ? 'failed' : 'queued'
    local.localError = wsConnected.value ? '发送超时，点击重试' : '网络断开，恢复后自动发送'
  }, 15000))
}

function appendOrReplaceMessage(msg: Message) {
  if (msg.clientMsgId) {
    const localIndex = messages.value.findIndex((m) => m.clientMsgId === msg.clientMsgId)
    if (localIndex >= 0) {
      clearSendTimer(msg.clientMsgId)
      messages.value[localIndex] = {
        ...msg,
        localStatus: 'sent',
        localError: undefined,
        uploadProgress: undefined,
        localFile: undefined,
      }
      return
    }
  }
  if (!messages.value.find((m) => m.id === msg.id)) {
    messages.value.push(msg)
  }
}

function sendChatPayload(payload: WsClientChat['data']) {
  const msg: WsClientChat = { type: 'chat', data: payload }
  if (ws.value && ws.value.readyState === WebSocket.OPEN) {
    ws.value.send(JSON.stringify(msg))
    if (payload.clientMsgId) {
      setLocalStatus(payload.clientMsgId, 'sending')
      armSendTimer(payload.clientMsgId)
    }
  } else {
    pendingMessages.push(msg)
    if (payload.clientMsgId) {
      setLocalStatus(payload.clientMsgId, 'queued', '网络断开，恢复后自动发送')
    }
  }
}
```

- [ ] **Step 4: Replace `sendWsMessage` and `flushQueue`**

Replace the existing `sendWsMessage()` and `flushQueue()` with:

```ts
function sendWsMessage(msg: WsClientMessage) {
  if (msg.type === 'chat') {
    sendChatPayload(msg.data)
    return
  }
  if (ws.value && ws.value.readyState === WebSocket.OPEN) {
    ws.value.send(JSON.stringify(msg))
  }
}

function flushQueue() {
  while (pendingMessages.length > 0 && ws.value?.readyState === WebSocket.OPEN) {
    const msg = pendingMessages.shift()!
    if (msg.data.clientMsgId) {
      setLocalStatus(msg.data.clientMsgId, 'sending')
      armSendTimer(msg.data.clientMsgId)
    }
    ws.value.send(JSON.stringify(msg))
  }
}
```

- [ ] **Step 5: Replace `sendMessage`**

Replace existing `sendMessage()` with:

```ts
function sendMessage(content: string, msgType: 1 | 4 = 1) {
  const userStore = useUserStore()
  if (!currentContact.value || !userStore.userId) return

  const clientMsgId = createClientMsgId()
  const receiverId = currentContact.value.userId
  const local = createLocalMessage({
    currentUserId: userStore.userId,
    receiverId,
    msgType,
    content,
    fileUrl: null,
    fileName: null,
    fileSize: null,
    clientMsgId,
    status: wsConnected.value ? 'sending' : 'queued',
  })
  messages.value.push(local)
  sendChatPayload(chatPayloadFromMessage(local))
}
```

- [ ] **Step 6: Update WebSocket chat handler**

Inside `handleWsMessage(data: WsServerMessage)`, in the `case 'chat'` branch, replace:

```ts
if (isCurrent) {
  // Avoid duplicates
  if (!messages.value.find((m) => m.id === msg.id)) {
    messages.value.push(msg)
  }
  // 不在这里发 read，由 IntersectionObserver 在消息进入视口时触发
}
```

With:

```ts
if (isCurrent) {
  appendOrReplaceMessage(msg)
  // 不在这里发 read，由 IntersectionObserver 在消息进入视口时触发
}
```

- [ ] **Step 7: Add retry action**

Add this function near `sendMessage()`:

```ts
function retryMessage(clientMsgId: string) {
  const local = findLocalByClientMsgId(clientMsgId)
  if (!local || !currentContact.value) return
  if (local.localFile) {
    void retryFileMessage(local)
    return
  }
  local.localError = undefined
  local.localStatus = wsConnected.value ? 'sending' : 'queued'
  sendChatPayload(chatPayloadFromMessage(local))
}
```

The `retryFileMessage()` function is added in Task 5.

- [ ] **Step 8: Add recovered notice and reconnect action**

In `ws.value.onopen`, after setting `wsStatus.value = 'connected'`, add:

```ts
recoveredNotice.value = reconnectAttempts > 0
if (recoveredNotice.value) {
  setTimeout(() => { recoveredNotice.value = false }, 1800)
}
```

Add this function near `scheduleReconnect()`:

```ts
function reconnectNow() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (connectTimer) {
    clearTimeout(connectTimer)
    connectTimer = null
  }
  reconnecting = false
  reconnectAttempts = 0
  intentionalClose = true
  if (ws.value) ws.value.close()
  ws.value = null
  intentionalClose = false
  connectWs()
}
```

- [ ] **Step 9: Expose new store state and actions**

In the returned object from `useChatStore()`, include:

```ts
pendingChatCount,
recoveredNotice,
retryMessage,
reconnectNow,
```

- [ ] **Step 10: Run frontend build**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: FAIL because `retryFileMessage` is referenced before Task 5. The relevant error should name `retryFileMessage` in `chat.ts`.

- [ ] **Step 11: Checkpoint commit if authorized**

Do not commit this task alone unless Task 5 is completed in the same checkpoint, because Task 4 intentionally references the file retry function added next.

---

## Task 5: Add Upload Progress and File Retry in Chat Store

**Files:**
- Modify: `frontend/src/stores/chat.ts`

- [ ] **Step 1: Replace `sendFile`**

Replace existing `sendFile()` with:

```ts
async function sendFile(file: File, onProgress?: (p: number) => void) {
  const userStore = useUserStore()
  if (!currentContact.value || !userStore.userId) return

  const receiverId = currentContact.value.userId
  const clientMsgId = createClientMsgId()
  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  const local = createLocalMessage({
    currentUserId: userStore.userId,
    receiverId,
    msgType: isImage ? 2 : isVideo ? 5 : 3,
    content: null,
    fileUrl: null,
    fileName: file.name,
    fileSize: file.size,
    clientMsgId,
    status: 'uploading',
    localFile: file,
    uploadProgress: 0,
  })
  messages.value.push(local)

  try {
    const res = await uploadFile(file, p => {
      local.uploadProgress = p
      onProgress?.(p)
    })
    if (res.data.code !== 200) {
      local.localStatus = 'failed'
      local.localError = res.data.message || '上传失败，点击重试'
      return
    }

    const { url, fileName, fileSize } = res.data.data
    local.fileUrl = url
    local.fileName = fileName
    local.fileSize = fileSize
    local.uploadProgress = 100
    local.localStatus = wsConnected.value ? 'sending' : 'queued'

    sendChatPayload({
      receiverId,
      msgType: local.msgType,
      content: null,
      fileUrl: url,
      fileName,
      fileSize,
      clientMsgId,
    })
  } catch (e) {
    console.error('File upload failed', e)
    local.localStatus = 'failed'
    local.localError = '上传失败，点击重试'
  }
}
```

- [ ] **Step 2: Add `retryFileMessage` used by Task 4**

Add this function below `sendFile()`:

```ts
async function retryFileMessage(local: Message) {
  if (!local.clientMsgId || !local.localFile || !currentContact.value) return
  local.localStatus = 'uploading'
  local.localError = undefined
  local.uploadProgress = 0

  try {
    const res = await uploadFile(local.localFile, p => {
      local.uploadProgress = p
    })
    if (res.data.code !== 200) {
      local.localStatus = 'failed'
      local.localError = res.data.message || '上传失败，点击重试'
      return
    }

    const { url, fileName, fileSize } = res.data.data
    local.fileUrl = url
    local.fileName = fileName
    local.fileSize = fileSize
    local.uploadProgress = 100
    local.localStatus = wsConnected.value ? 'sending' : 'queued'

    sendChatPayload({
      receiverId: currentContact.value.userId,
      msgType: local.msgType,
      content: null,
      fileUrl: url,
      fileName,
      fileSize,
      clientMsgId: local.clientMsgId,
    })
  } catch (e) {
    console.error('File upload retry failed', e)
    local.localStatus = 'failed'
    local.localError = '上传失败，点击重试'
  }
}
```

- [ ] **Step 3: Preserve queued local messages during reconnect reload**

In `ws.value.onopen`, replace this existing block:

```ts
// 补拉断连期间的消息
if (currentContact.value) {
  loadMessages('init')
}
// 补发队列中的消息
flushQueue()
```

With:

```ts
// 补拉断连期间的消息，同时保留本地待确认消息
if (currentContact.value) {
  const localPending = messages.value.filter((m) =>
    m.clientMsgId && m.localStatus && m.localStatus !== 'sent'
  )
  void loadMessages('init').then(() => {
    for (const local of localPending) {
      if (!messages.value.find((m) => m.clientMsgId === local.clientMsgId)) {
        messages.value.push(local)
      }
    }
    flushQueue()
  })
} else {
  flushQueue()
}
```

- [ ] **Step 4: Clear timers on disconnect/cleanup**

In `clearState()` or the store cleanup function that clears chat state, add:

```ts
for (const timer of sendTimers.values()) clearTimeout(timer)
sendTimers.clear()
pendingMessages.length = 0
recoveredNotice.value = false
```

If `clearState()` does not exist near the return block, find the existing function that resets `contacts`, `currentContact`, and `messages`, then add the code inside it.

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Checkpoint commit if authorized**

Run only if commits are authorized:

```bash
git -C /home/project/private-chat add frontend/src/stores/chat.ts frontend/src/types/index.ts frontend/src/utils/chatLocal.ts
git -C /home/project/private-chat commit -m "feat: track local chat send status"
```

---

## Task 6: Add New-Message Bottom State to Scroll Composable

**Files:**
- Modify: `frontend/src/composables/useChatScroll.ts`

- [ ] **Step 1: Add reactive bottom state**

In `useChatScroll()`, after `const loading = ref(false)`, add:

```ts
const newMessageCount = ref(0)
const showBottomButton = ref(false)
```

- [ ] **Step 2: Add bottom button helpers**

Add these functions after `isNearBottom()`:

```ts
function updateBottomButton() {
  showBottomButton.value = newMessageCount.value > 0 || (!!listEl.value && !isNearBottom(160))
}

function scrollToBottomAndClear(smooth = true) {
  newMessageCount.value = 0
  showBottomButton.value = false
  scrollToBottom(smooth)
}
```

- [ ] **Step 3: Update `onScroll()`**

In `onScroll()`, keep the existing load-more logic and add this block before the function returns:

```ts
if (isNearBottom(120)) {
  newMessageCount.value = 0
}
updateBottomButton()
```

The resulting `onScroll()` should keep this behavior:

```ts
function onScroll() {
  if (!listEl.value) return
  if (!loading.value && chatStore.hasMore && !scrollThrottle && listEl.value.scrollTop < 60) {
    scrollThrottle = true
    loadMore()
    setTimeout(() => { scrollThrottle = false }, 300)
  }
  if (isNearBottom(120)) {
    newMessageCount.value = 0
  }
  updateBottomButton()
}
```

- [ ] **Step 4: Replace `onMessagesChange()`**

Replace `onMessagesChange()` with:

```ts
function onMessagesChange() {
  if (isLoadingMore) return
  const added = chatStore.messages.length - prevMsgCount
  if (added > 0) {
    if (isNearBottom()) {
      newMessageCount.value = 0
      scrollToBottom(true)
    } else {
      newMessageCount.value += added
    }
  }
  prevMsgCount = chatStore.messages.length
  updateBottomButton()
}
```

- [ ] **Step 5: Reset bottom state on contact changes**

In both `onContactChange()` and `onSelectContact()`, add:

```ts
newMessageCount.value = 0
showBottomButton.value = false
```

- [ ] **Step 6: Return new fields**

In the returned object, add:

```ts
newMessageCount,
showBottomButton,
scrollToBottomAndClear,
```

- [ ] **Step 7: Run frontend build**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: PASS.

- [ ] **Step 8: Checkpoint commit if authorized**

Run only if commits are authorized:

```bash
git -C /home/project/private-chat add frontend/src/composables/useChatScroll.ts
git -C /home/project/private-chat commit -m "feat: track chat bottom message state"
```

---

## Task 7: Create Reliability UI Components

**Files:**
- Create: `frontend/src/components/ConnectionNotice.vue`
- Create: `frontend/src/components/MessageStatusIndicator.vue`
- Create: `frontend/src/components/NewMessageButton.vue`

- [ ] **Step 1: Create `ConnectionNotice.vue`**

Create `frontend/src/components/ConnectionNotice.vue` with this content:

```vue
<template>
  <div v-if="visible" class="connection-notice" :class="noticeClass">
    <span>{{ text }}</span>
    <button v-if="status === 'disconnected'" type="button" @click="$emit('reconnect')">重连</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: 'connected' | 'disconnected' | 'reconnecting'
  recoveredNotice: boolean
  pendingCount: number
}>()

defineEmits<{ reconnect: [] }>()

const visible = computed(() =>
  props.status !== 'connected' || props.recoveredNotice || props.pendingCount > 0
)

const text = computed(() => {
  if (props.status === 'reconnecting') return '连接已断开，正在重连…'
  if (props.status === 'disconnected') return '连接不可用，请检查网络'
  if (props.pendingCount > 0) return `${props.pendingCount} 条消息等待确认`
  if (props.recoveredNotice) return '网络已恢复'
  return ''
})

const noticeClass = computed(() => ({
  off: props.status === 'disconnected',
  recovering: props.status === 'reconnecting',
  ok: props.status === 'connected' && props.recoveredNotice,
}))
</script>

<style scoped>
.connection-notice {
  flex-shrink: 0;
  padding: 7px 12px;
  font-size: 13px;
  text-align: center;
  color: #92400e;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}
.connection-notice.off {
  color: #991b1b;
  background: #fef2f2;
  border-bottom-color: #fecaca;
}
.connection-notice.ok {
  color: #166534;
  background: #f0fdf4;
  border-bottom-color: #bbf7d0;
}
.connection-notice button {
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
}
</style>
```

- [ ] **Step 2: Create `MessageStatusIndicator.vue`**

Create `frontend/src/components/MessageStatusIndicator.vue` with this content:

```vue
<template>
  <button
    v-if="status === 'failed'"
    type="button"
    class="msg-status failed"
    :title="error || '发送失败，点击重试'"
    @click="$emit('retry')"
  >
    发送失败，重试
  </button>
  <span v-else-if="status === 'uploading'" class="msg-status sending">
    上传中 {{ progress ?? 0 }}%
  </span>
  <span v-else-if="status === 'queued'" class="msg-status queued">待发送</span>
  <span v-else-if="status === 'sending'" class="msg-status sending">发送中</span>
  <span v-else class="msg-status read-state">{{ isRead ? '已读' : '未读' }}</span>
</template>

<script setup lang="ts">
import type { LocalMessageStatus } from '../types'

defineProps<{
  status?: LocalMessageStatus
  isRead: boolean
  progress?: number
  error?: string
}>()

defineEmits<{ retry: [] }>()
</script>

<style scoped>
.msg-status {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 11px;
  color: #999;
  background: transparent;
  border: 0;
  padding: 0;
}
.msg-status.failed {
  color: #dc2626;
  cursor: pointer;
}
.msg-status.queued,
.msg-status.sending {
  color: #888;
}
.read-state {
  color: #999;
}
</style>
```

- [ ] **Step 3: Create `NewMessageButton.vue`**

Create `frontend/src/components/NewMessageButton.vue` with this content:

```vue
<template>
  <button v-if="visible" type="button" class="new-message-btn" @click="$emit('click')">
    {{ count > 0 ? `${count} 条新消息` : '回到底部' }}
  </button>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  count: number
}>()

defineEmits<{ click: [] }>()
</script>

<style scoped>
.new-message-btn {
  position: absolute;
  right: 18px;
  bottom: 76px;
  z-index: 20;
  border: none;
  border-radius: 999px;
  padding: 7px 13px;
  font-size: 13px;
  color: #fff;
  background: rgba(37, 99, 235, 0.92);
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.28);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.new-message-btn:active {
  transform: translateY(1px);
}
</style>
```

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: PASS.

- [ ] **Step 5: Checkpoint commit if authorized**

Run only if commits are authorized:

```bash
git -C /home/project/private-chat add frontend/src/components/ConnectionNotice.vue frontend/src/components/MessageStatusIndicator.vue frontend/src/components/NewMessageButton.vue
git -C /home/project/private-chat commit -m "feat: add chat reliability indicators"
```

---

## Task 8: Integrate Reliability UI into Desktop Chat

**Files:**
- Modify: `frontend/src/views/ChatPage.vue`

- [ ] **Step 1: Add imports**

In `ChatPage.vue`, add these imports next to the existing component imports:

```ts
import { ElMessage } from 'element-plus'
import ConnectionNotice from '../components/ConnectionNotice.vue'
import MessageStatusIndicator from '../components/MessageStatusIndicator.vue'
import NewMessageButton from '../components/NewMessageButton.vue'
```

- [ ] **Step 2: Replace WebSocket notice block**

Replace this template block:

```vue
<!-- WS 断连提示 -->
<div v-if="chatStore.wsStatus === 'reconnecting'" class="ws-bar">连接已断开，正在重连...</div>
<div v-else-if="chatStore.wsStatus === 'disconnected'" class="ws-bar ws-bar-off">连接不可用，请检查网络</div>
```

With:

```vue
<ConnectionNotice
  :status="chatStore.wsStatus"
  :recovered-notice="chatStore.recoveredNotice"
  :pending-count="chatStore.pendingChatCount"
  @reconnect="chatStore.reconnectNow"
/>
```

- [ ] **Step 3: Add new-message button**

Inside `<main class="chat-main">`, after the message list `</div>` that has `ref="listEl" class="msg-scroll"`, add:

```vue
<NewMessageButton
  :visible="scroll.showBottomButton.value"
  :count="scroll.newMessageCount.value"
  @click="scroll.scrollToBottomAndClear(true)"
/>
```

If placement makes the button appear outside the chat panel, add `position: relative;` to `.chat-main` in this file's style block.

- [ ] **Step 4: Replace read tag with status indicator**

Replace:

```vue
<div v-if="chatStore.messages[vi.index].senderId === uid" class="read-tag">
  {{ chatStore.messages[vi.index].isRead ? '已读' : '未读' }}
</div>
```

With:

```vue
<div v-if="chatStore.messages[vi.index].senderId === uid" class="read-tag">
  <MessageStatusIndicator
    :status="chatStore.messages[vi.index].localStatus"
    :is-read="chatStore.messages[vi.index].isRead === 1"
    :progress="chatStore.messages[vi.index].uploadProgress"
    :error="chatStore.messages[vi.index].localError"
    @retry="chatStore.messages[vi.index].clientMsgId && chatStore.retryMessage(chatStore.messages[vi.index].clientMsgId!)"
  />
</div>
```

- [ ] **Step 5: Replace file size alert and upload failure alert**

Change `onFile()` oversized branch from:

```ts
if (inp.files[0].size > 50 * 1024 * 1024) { alert('最大50MB'); inp.value = ''; return }
```

To:

```ts
if (inp.files[0].size > 50 * 1024 * 1024) {
  ElMessage.warning('文件最大支持 50MB')
  inp.value = ''
  return
}
```

Change `doUpload()` from:

```ts
async function doUpload(f: File) {
  progress.value = 0
  try {
    await chatStore.sendFile(f, p => { progress.value = p })
    scroll.scrollToBottom(true)
  } catch { alert('上传失败') }
  progress.value = 0
}
```

To:

```ts
async function doUpload(f: File) {
  progress.value = 0
  await chatStore.sendFile(f, p => { progress.value = p })
  scroll.scrollToBottom(true)
  progress.value = 0
}
```

- [ ] **Step 6: Run frontend build**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: PASS.

- [ ] **Step 7: Checkpoint commit if authorized**

Run only if commits are authorized:

```bash
git -C /home/project/private-chat add frontend/src/views/ChatPage.vue
git -C /home/project/private-chat commit -m "feat: show desktop chat send status"
```

---

## Task 9: Integrate Reliability UI into Mobile Chat

**Files:**
- Modify: `frontend/src/views/MobileChat.vue`

- [ ] **Step 1: Add imports**

In `MobileChat.vue`, add these imports next to existing component imports:

```ts
import { ElMessage } from 'element-plus'
import ConnectionNotice from '../components/ConnectionNotice.vue'
import MessageStatusIndicator from '../components/MessageStatusIndicator.vue'
import NewMessageButton from '../components/NewMessageButton.vue'
```

- [ ] **Step 2: Replace WebSocket notice block**

Replace:

```vue
<!-- WS 断连提示 -->
<div v-if="chatStore.wsStatus === 'reconnecting'" class="ws-bar">连接已断开，正在重连...</div>
<div v-else-if="chatStore.wsStatus === 'disconnected'" class="ws-bar ws-bar-off">连接不可用，请检查网络</div>
```

With:

```vue
<ConnectionNotice
  :status="chatStore.wsStatus"
  :recovered-notice="chatStore.recoveredNotice"
  :pending-count="chatStore.pendingChatCount"
  @reconnect="chatStore.reconnectNow"
/>
```

- [ ] **Step 3: Add new-message button**

Inside `<div v-else class="chat-page">`, after the message list `</div>` that has `ref="listEl" class="msg-scroll"`, add:

```vue
<NewMessageButton
  :visible="scroll.showBottomButton.value"
  :count="scroll.newMessageCount.value"
  @click="scroll.scrollToBottomAndClear(true)"
/>
```

If the button is not anchored to the chat page, add this rule to the style block:

```css
.chat-page {
  position: relative;
}
```

If `.chat-page` already exists, add only `position: relative;` to that existing rule.

- [ ] **Step 4: Replace read tag with status indicator**

Replace:

```vue
<div v-if="chatStore.messages[vi.index].senderId === uid" class="read-tag">
  {{ chatStore.messages[vi.index].isRead ? '已读' : '未读' }}
</div>
```

With:

```vue
<div v-if="chatStore.messages[vi.index].senderId === uid" class="read-tag">
  <MessageStatusIndicator
    :status="chatStore.messages[vi.index].localStatus"
    :is-read="chatStore.messages[vi.index].isRead === 1"
    :progress="chatStore.messages[vi.index].uploadProgress"
    :error="chatStore.messages[vi.index].localError"
    @retry="chatStore.messages[vi.index].clientMsgId && chatStore.retryMessage(chatStore.messages[vi.index].clientMsgId!)"
  />
</div>
```

- [ ] **Step 5: Replace file size alert and upload failure alert**

Change `onFile()` oversized branch from:

```ts
if (inp.files[0].size > 50 * 1024 * 1024) { alert('最大50MB'); inp.value = ''; return }
```

To:

```ts
if (inp.files[0].size > 50 * 1024 * 1024) {
  ElMessage.warning('文件最大支持 50MB')
  inp.value = ''
  return
}
```

Change `doUpload()` from:

```ts
async function doUpload(f: File) {
  progress.value = 0
  try {
    await chatStore.sendFile(f, p => { progress.value = p })
    scroll.scrollToBottom(true)
  } catch { alert('上传失败') }
  progress.value = 0
}
```

To:

```ts
async function doUpload(f: File) {
  progress.value = 0
  await chatStore.sendFile(f, p => { progress.value = p })
  scroll.scrollToBottom(true)
  progress.value = 0
}
```

- [ ] **Step 6: Run frontend build**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: PASS.

- [ ] **Step 7: Checkpoint commit if authorized**

Run only if commits are authorized:

```bash
git -C /home/project/private-chat add frontend/src/views/MobileChat.vue
git -C /home/project/private-chat commit -m "feat: show mobile chat send status"
```

---

## Task 10: Final Verification for Phase 1

**Files:**
- Validate repository state only.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd /home/project/private-chat/backend && go test ./...
```

Expected: PASS.

- [ ] **Step 2: Run backend build**

Run:

```bash
cd /home/project/private-chat/backend && go build ./cmd/privatechat
```

Expected: PASS and no compiler errors.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: PASS and no `vue-tsc` errors.

- [ ] **Step 4: Check formatting and working tree**

Run:

```bash
git -C /home/project/private-chat diff --check
git -C /home/project/private-chat status --short
```

Expected:

```text
```

for `git diff --check`, and `git status --short` lists only intended modified/created files.

- [ ] **Step 5: Manual desktop verification**

Run the app using the project's normal dev/deploy flow. Verify these desktop cases:

```text
1. Open desktop chat page.
2. Send a text message while online.
3. Confirm the message appears immediately as “发送中”.
4. Confirm it becomes “未读” or “已读” after server echo.
5. Disconnect network or stop backend WebSocket.
6. Send another text message.
7. Confirm it displays “待发送”.
8. Restore WebSocket.
9. Confirm queued message sends and no duplicate appears.
10. Scroll upward, receive a new message, confirm “新消息” button appears.
11. Click the button and confirm it scrolls to the bottom.
```

- [ ] **Step 6: Manual upload verification**

Verify these file cases:

```text
1. Upload a small image.
2. Confirm local message shows upload progress.
3. Confirm image message becomes normal after WebSocket echo.
4. Upload a file larger than 50 MB.
5. Confirm Element Plus warning says “文件最大支持 50MB”.
6. Force upload failure by disabling network before upload.
7. Confirm message shows “发送失败，重试”.
8. Restore network and click retry.
9. Confirm upload and send complete without duplicate message.
```

- [ ] **Step 7: Manual mobile verification**

Verify these mobile cases with browser devtools device mode or a real phone:

```text
1. Open mobile chat page.
2. Send text while online.
3. Confirm status changes from “发送中” to “未读/已读”.
4. Disconnect network and send text.
5. Confirm “待发送” and connection notice appear.
6. Restore network and confirm “网络已恢复” appears briefly.
7. Scroll upward and receive a message.
8. Confirm bottom button appears and works.
```

- [ ] **Step 8: Final checkpoint commit if authorized**

Run only if commits are authorized and all verification steps pass:

```bash
git -C /home/project/private-chat add .
git -C /home/project/private-chat commit -m "feat: improve chat reliability experience"
```

---

## Self-Review

### Spec Coverage

- Message sending status: covered by Tasks 3, 4, 7, 8, and 9.
- Failed send retry: covered by Tasks 4, 5, 7, 8, and 9.
- Disconnected queued messages: covered by Tasks 4, 5, 7, 8, and 9.
- WebSocket reconnect feedback: covered by Tasks 4, 7, 8, and 9.
- Manual reconnect: covered by Tasks 4, 7, 8, and 9.
- New-message bottom button: covered by Tasks 6, 7, 8, and 9.
- Upload progress and retry: covered by Tasks 5, 7, 8, and 9.
- Visual companion artifacts: covered by Task 1.
- Backend compatibility for `clientMsgId`: covered by Task 2.

### Type Consistency

- `clientMsgId` is optional on both `Message` and `WsClientChat.data`.
- Local statuses use the single `LocalMessageStatus` union.
- Store actions exposed to pages are `retryMessage`, `reconnectNow`, `pendingChatCount`, and `recoveredNotice`.
- Scroll fields exposed to pages are `newMessageCount`, `showBottomButton`, and `scrollToBottomAndClear`.

### Verification Coverage

- Backend unit tests verify WebSocket payload shape.
- Frontend build validates Vue and TypeScript wiring.
- Manual checks cover desktop, mobile, network interruption, upload failure, and duplicate prevention.
