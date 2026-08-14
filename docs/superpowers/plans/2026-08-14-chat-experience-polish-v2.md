# Chat Experience Polish V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve chat feedback and navigation without changing backend APIs, database schema, WebSocket protocol, file-security semantics, or the disguise/privacy model.

**Architecture:** Keep `ChatPage.vue` and `MobileChat.vue` as orchestration layers. Add focused shared units for conversation-state rendering, attachment ingress, per-contact scroll memory, and tab-visibility decisions; extend the chat store and `useChatScroll` only for state they already own. Preserve the current attachment confirmation and secure upload lifecycle.

**Tech Stack:** Vue 3.5, TypeScript 5.8, Pinia 3, Vue Router 4.5, Element Plus 2.9, TanStack Vue Virtual 3.13, Vitest 4.1.10, Vue Test Utils 2.4.11, jsdom 27.4.0, Vite 6.2.

## Global Constraints

- No backend API changes.
- No database migrations.
- No WebSocket protocol changes.
- No quote/reply, edit, recall, forwarding, message search, typing indicators, reactions, multi-file batching, browser notifications, or push notifications.
- Do not persist drafts or scroll positions in `localStorage`, `sessionStorage`, IndexedDB, or the backend.
- Keep the current 50 MB file limit.
- Paste/drop must never upload automatically; all valid files must still pass through `AttachmentSendDialog.vue` and `useAttachmentComposer.takeConfirmed()` before `chatStore.sendFile()`.
- Keep the disguise browser title `有趣 - 随时随地发现新鲜事`; do not expose chat-specific unread counts in browser chrome.
- Preserve reconnect recovery, optimistic send/retry, authorized same-origin media URLs, virtual scrolling, mobile history-backed overlays, safe-area handling, and iOS viewport behavior.
- Keep interaction-test dependencies out of `package.json`/`package-lock.json`; use the existing `.github/workflows/frontend-interactions.yml` convention.
- Run interaction tests with Node 20 and the existing fixed versions: `vitest@4.1.10`, `@vue/test-utils@2.4.11`, `jsdom@27.4.0`.

## Local Test Setup

From `frontend/`:

```bash
npm ci
npm install --no-save vitest@4.1.10 @vue/test-utils@2.4.11 jsdom@27.4.0
```

Focused tests:

```bash
npm exec vitest run path/to/test.ts
```

Final verification:

```bash
npm exec vitest run
npm run build
```

---

### Task 1: Initial conversation loading/error state and retry UI

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/stores/chat.ts`
- Create: `frontend/src/stores/chat.test.ts`
- Create: `frontend/src/components/ConversationMessageState.vue`
- Create: `frontend/src/components/ConversationMessageState.test.ts`
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`

**Interfaces:**

```ts
export type MessageLoadState = 'idle' | 'loading' | 'loaded' | 'error'
```

`useChatStore()` additionally exposes:

```ts
messageLoadState: Ref<MessageLoadState>
messageLoadError: Ref<string>
retryInitialMessages(): Promise<boolean>
```

`ConversationMessageState.vue`:

```ts
state: MessageLoadState
hasMessages: boolean
error?: string
retry: []
```

- [ ] **Step 1: Write failing store tests**

Create `frontend/src/stores/chat.test.ts` using `createPinia()` / `setActivePinia()` and `vi.mock('../api')`. In `beforeEach`, clear `localStorage`, create a fresh Pinia, and initialize the user with:

```ts
const userStore = useUserStore()
userStore.login('test-token', 99, 'Me')
```

Cover these cases:

```ts
it('transitions initial load from loading to loaded')
it('sets initial load error without fabricating an empty conversation')
it('does not let a stale contact response overwrite the active load state')
```

Use deferred promises for `getMessages()` so the test can assert `messageLoadState === 'loading'` before resolution. Successful mock response:

```ts
{
  data: {
    code: 200,
    data: { messages: [], hasMore: false },
  },
}
```

Failure must end with:

```ts
expect(chatStore.messageLoadState).toBe('error')
expect(chatStore.messageLoadError).toBe('消息加载失败，请重试')
```

- [ ] **Step 2: Run store tests and verify RED**

```bash
npm exec vitest run src/stores/chat.test.ts
```

Expected: FAIL because the load-state fields do not exist.

- [ ] **Step 3: Implement the store state machine**

Add to `types/index.ts`:

```ts
export type MessageLoadState = 'idle' | 'loading' | 'loaded' | 'error'
```

In `chat.ts`:

```ts
const messageLoadState = ref<MessageLoadState>('idle')
const messageLoadError = ref('')
```

At the start of an initial load:

```ts
if (mode === 'init') {
  messageLoadState.value = 'loading'
  messageLoadError.value = ''
}
```

Only the latest active initial request may commit the terminal state. On active success:

```ts
messageLoadState.value = 'loaded'
messageLoadError.value = ''
```

On active exception or non-200 response:

```ts
messageLoadState.value = 'error'
messageLoadError.value = '消息加载失败，请重试'
```

Do not modify this state for `loadMore`. Reset it in `clearState()` and when selecting a new contact.

Add and return:

```ts
async function retryInitialMessages() {
  return loadMessages('init')
}
```

- [ ] **Step 4: Run store tests and verify GREEN**

```bash
npm exec vitest run src/stores/chat.test.ts
```

- [ ] **Step 5: Write failing shared-state component tests**

Create `ConversationMessageState.test.ts` and cover:

```ts
it('shows loading but not empty copy while pending')
it('shows empty copy only after loaded')
it('shows retry UI on error and emits retry')
it('renders no state panel when messages exist')
```

- [ ] **Step 6: Implement `ConversationMessageState.vue`**

Visible strings are exactly:

```text
加载消息中...
消息加载失败
重新加载
开始聊天吧
```

Use a real `<button type="button">重新加载</button>`. Loading/error status text may use `role="status"`; do not autofocus anything.

- [ ] **Step 7: Wire desktop and mobile pages**

Replace the current unconditional empty-history branch with:

```vue
<ConversationMessageState
  :state="chatStore.messageLoadState"
  :has-messages="chatStore.messages.length > 0"
  :error="chatStore.messageLoadError"
  @retry="retryInitialMessages"
/>
```

Keep the virtual list mounted only when messages exist.

Page helper:

```ts
async function retryInitialMessages() {
  const loaded = await chatStore.retryInitialMessages()
  if (loaded) scroll.scrollToBottomAndClear(false)
}
```

- [ ] **Step 8: Verify and commit**

```bash
npm exec vitest run src/stores/chat.test.ts src/components/ConversationMessageState.test.ts
npm run build
git add frontend/src/types/index.ts frontend/src/stores/chat.ts frontend/src/stores/chat.test.ts frontend/src/components/ConversationMessageState.vue frontend/src/components/ConversationMessageState.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: expose conversation loading states"
```

---

### Task 2: Load-more error feedback and public scroll-anchor API

**Files:**
- Modify: `frontend/src/composables/useChatScroll.ts`
- Create: `frontend/src/composables/useChatScroll.test.ts`
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`

**Interfaces:**

Define in `useChatScroll.ts` now; Task 5 consumes this exact type:

```ts
export interface ConversationScrollAnchor {
  messageId: number
  offset: number
}
```

`useChatScroll()` additionally returns:

```ts
loadMoreError: Ref<string>
retryLoadMore(): Promise<void>
captureVisibleAnchor(): ConversationScrollAnchor | null
restoreVisibleAnchor(anchor: ConversationScrollAnchor): Promise<boolean>
```

- [ ] **Step 1: Write failing load-more tests**

Mount `useChatScroll` through a minimal Vue harness with a fake scroll container. Mock `chatStore.loadMessages('loadMore')` to return `false`. Assert:

```ts
expect(scroll.loadMoreError.value).toBe('历史消息加载失败，点击重试')
expect(container.scrollTop).toBe(beforeScrollTop)
```

Then make the mock return `true`, call `retryLoadMore()`, and assert the error clears.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest run src/composables/useChatScroll.test.ts
```

- [ ] **Step 3: Expose the existing anchor behavior**

Rename/refactor the private anchor functions without changing their semantics:

```ts
function captureVisibleAnchor(): ConversationScrollAnchor | null
async function restoreVisibleAnchor(anchor: ConversationScrollAnchor): Promise<boolean>
```

`restoreVisibleAnchor()` keeps the existing frame/`nextTick()` stabilization and returns `false` if the anchor message is not loaded.

- [ ] **Step 4: Implement load-more error state**

Add:

```ts
const loadMoreError = ref('')
```

Clear it when a new attempt starts. If `await chatStore.loadMessages('loadMore')` returns `false`, set:

```ts
loadMoreError.value = '历史消息加载失败，点击重试'
```

Do not apply scroll-height compensation after a failed fetch. Always clear `loading` and `isLoadingMore` on exit.

Add:

```ts
async function retryLoadMore() {
  if (loading.value) return
  await loadMore()
}
```

- [ ] **Step 5: Update desktop/mobile top-of-history UI**

Use this priority:

```vue
<template v-if="scroll.loading.value">...</template>
<button
  v-else-if="scroll.loadMoreError.value"
  type="button"
  class="load-retry"
  @click="scroll.retryLoadMore"
>
  {{ scroll.loadMoreError.value }}
</button>
<span v-else-if="chatStore.hasMore">↑ 上拉加载更多</span>
<span v-else-if="chatStore.messages.length > 0">没有更早的消息了</span>
```

- [ ] **Step 6: Verify and commit**

```bash
npm exec vitest run src/composables/useChatScroll.test.ts
npm run build
git add frontend/src/composables/useChatScroll.ts frontend/src/composables/useChatScroll.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: retry failed history loads"
```

---

### Task 3: Attach delivery state to every affected outgoing message

**Files:**
- Modify: `frontend/src/components/MessageStatusIndicator.vue`
- Create: `frontend/src/components/MessageStatusIndicator.test.ts`
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`

**Interfaces:**

Add optional prop with compatibility default:

```ts
showReadState?: boolean
```

- [ ] **Step 1: Write failing component tests**

Cover:

```ts
it.each([
  ['uploading', '上传中'],
  ['queued', '排队中'],
  ['sending', '发送中'],
  ['failed', '发送失败'],
])('renders %s status', ...)

it('emits retry from a failed message')
it('shows 已读/未读 only when showReadState is true and no local status exists')
it('renders no read text when showReadState is false and no local status exists')
```

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest run src/components/MessageStatusIndicator.test.ts
```

- [ ] **Step 3: Implement `showReadState`**

Use:

```ts
const props = withDefaults(defineProps<{
  status?: LocalMessageStatus
  isRead: boolean
  progress?: number
  error?: string
  showReadState?: boolean
}>(), {
  showReadState: true,
})
```

Final template fallback:

```vue
<template v-else-if="props.showReadState">
  {{ props.isRead ? '已读' : '未读' }}
</template>
```

- [ ] **Step 4: Change the page rendering rule**

Add to both pages:

```ts
function shouldShowMessageStatus(index: number) {
  const message = chatStore.messages[index]
  if (!message || message.senderId !== uid.value) return false
  return !!message.localStatus || isLastSelfMessage(index)
}
```

Mount the indicator when `shouldShowMessageStatus(vi.index)` and pass:

```vue
:show-read-state="!chatStore.messages[vi.index].localStatus && isLastSelfMessage(vi.index)"
```

An earlier failed/uploading/queued/sending message therefore retains its own status after newer messages are appended.

- [ ] **Step 5: Add a regression assertion**

Test a two-message scenario: the first outgoing message has `localStatus: 'failed'`; the second is confirmed. Assert the first owns a retry button while only the second can render read/unread text.

- [ ] **Step 6: Verify and commit**

```bash
npm exec vitest run src/components/MessageStatusIndicator.test.ts
npm run build
git add frontend/src/components/MessageStatusIndicator.vue frontend/src/components/MessageStatusIndicator.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: show per-message delivery feedback"
```

---

### Task 4: Unify picker, paste, and drag/drop attachment ingress

**Files:**
- Create: `frontend/src/composables/useAttachmentIngress.ts`
- Create: `frontend/src/composables/useAttachmentIngress.test.ts`
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`

**Interfaces:**

Reuse the existing recipient type rather than defining a duplicate:

```ts
import type { AttachmentRecipient } from './useAttachmentComposer'

export interface AttachmentIngressOptions {
  maxBytes: number
  getRecipient: () => AttachmentRecipient | null
  onStage: (file: File, recipient: AttachmentRecipient) => void
  onWarning: (message: string) => void
}

export interface AttachmentIngress {
  acceptFiles(files: FileList | File[]): boolean
  handlePaste(event: ClipboardEvent): boolean
  handleDrop(event: DragEvent): boolean
}

export function useAttachmentIngress(options: AttachmentIngressOptions): AttachmentIngress
```

- [ ] **Step 1: Write failing ingress tests**

Cover:

```ts
it('does not prevent text-only paste')
it('stages exactly one pasted file and prevents default')
it('stages exactly one dropped file and prevents default navigation')
it('rejects multiple files with 暂时只支持一次发送 1 个文件')
it('rejects a file larger than 50 MB with 文件最大支持 50MB')
it('does not stage when there is no active recipient')
```

The composable has no upload callback, so its API itself proves that ingress cannot call `chatStore.sendFile()`.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest run src/composables/useAttachmentIngress.test.ts
```

- [ ] **Step 3: Implement single-file validation**

Core function:

```ts
function acceptFiles(input: FileList | File[]) {
  const files = Array.from(input)
  if (files.length === 0) return false
  if (files.length > 1) {
    options.onWarning('暂时只支持一次发送 1 个文件')
    return false
  }

  const recipient = options.getRecipient()
  if (!recipient) return false

  const file = files[0]
  if (file.size > options.maxBytes) {
    options.onWarning('文件最大支持 50MB')
    return false
  }

  options.onStage(file, { ...recipient })
  return true
}
```

`handlePaste()` checks `event.clipboardData?.files`. If there are no files, return `false` without preventing normal text paste. If there are files, call `preventDefault()` and validate them.

`handleDrop()` checks `event.dataTransfer?.files`. If there are files, call `preventDefault()` to stop browser navigation, then validate them.

- [ ] **Step 4: Route both file pickers through ingress**

In both pages:

```ts
const attachmentIngress = useAttachmentIngress({
  maxBytes: 50 * 1024 * 1024,
  getRecipient: () => {
    const contact = chatStore.currentContact
    return contact ? { id: contact.userId, nickname: contact.nickname } : null
  },
  onStage: (file, recipient) => attachmentComposer.stage(file, recipient),
  onWarning: (message) => ElMessage.warning(message),
})
```

The picker handler calls `acceptFiles()`. Mobile keeps its existing history-overlay push only after staging succeeds.

- [ ] **Step 5: Add desktop paste and drag/drop**

Add handlers on desktop `chat-main`:

```vue
@paste="onPasteAttachment"
@dragenter.prevent="onDragEnter"
@dragover.prevent="onDragOver"
@dragleave="onDragLeave"
@drop="onDropAttachment"
```

Use a drag-depth counter so child enter/leave events do not flicker the overlay. While an actual file drag is active, show:

```text
松开以发送文件
```

Drop/paste only stage the file; the existing `AttachmentSendDialog.vue` remains the sole confirmation point.

- [ ] **Step 6: Keep mobile paste native**

Mobile uses ingress for picker validation only. Do not install a global mobile paste handler or drag overlay.

- [ ] **Step 7: Verify and commit**

```bash
npm exec vitest run src/composables/useAttachmentIngress.test.ts src/composables/useAttachmentComposer.test.ts src/components/AttachmentSendDialog.test.ts
npm run build
git add frontend/src/composables/useAttachmentIngress.ts frontend/src/composables/useAttachmentIngress.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: support paste and drop attachments"
```

---

### Task 5: Remember and restore per-conversation reading position

**Files:**
- Create: `frontend/src/composables/useConversationScrollMemory.ts`
- Create: `frontend/src/composables/useConversationScrollMemory.test.ts`
- Modify: `frontend/src/composables/useChatScroll.ts`
- Modify: `frontend/src/composables/useChatScroll.test.ts`
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`

**Interfaces:**

```ts
import type { ConversationScrollAnchor } from './useChatScroll'

export interface ConversationScrollMemory {
  remember(contactId: number, anchor: ConversationScrollAnchor | null): void
  get(contactId: number): ConversationScrollAnchor | null
  clear(contactId: number): void
  clearAll(): void
}

export function useConversationScrollMemory(): ConversationScrollMemory
```

Extend the existing contact-change hook to let callers suppress the old unconditional bottom scroll:

```ts
onContactChange(options?: { scrollToBottom?: boolean }): void
```

- [ ] **Step 1: Write failing scroll-memory tests**

Cover:

```ts
it('isolates anchors by contact id')
it('overwrites one contact without changing another')
it('clears one contact')
it('clears all contacts')
it('stores immutable copies')
```

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest run src/composables/useConversationScrollMemory.test.ts
```

- [ ] **Step 3: Implement the session-only map**

```ts
const anchors = new Map<number, ConversationScrollAnchor>()

remember(contactId, anchor) {
  if (anchor) anchors.set(contactId, { ...anchor })
  else anchors.delete(contactId)
}
```

Do not use browser storage.

- [ ] **Step 4: Add anchor API tests**

In `useChatScroll.test.ts`, use fake `.virtual-item[data-msg-id]` nodes with mocked `getBoundingClientRect()` to verify:

```ts
captureVisibleAnchor()
restoreVisibleAnchor(existingAnchor) === true
restoreVisibleAnchor(missingAnchor) === false
```

- [ ] **Step 5: Make `onContactChange` restoration-friendly**

Change it to:

```ts
function onContactChange(options: { scrollToBottom?: boolean } = {}) {
  prevMsgCount = chatStore.messages.length
  newMessageCount.value = 0
  showBottomButton.value = false
  bindScrollListener()
  if (options.scrollToBottom !== false) scrollToBottom(false)
}
```

Existing callers keep current behavior by default. Restore-aware flows pass `{ scrollToBottom: false }`.

- [ ] **Step 6: Wire desktop switching**

Before selecting a new contact:

```ts
const oldContactId = chatStore.currentContact?.userId
if (oldContactId) {
  scrollMemory.remember(oldContactId, scroll.captureVisibleAnchor())
}
```

After `await chatStore.selectContact(id)`:

```ts
scroll.onContactChange({ scrollToBottom: false })
await nextTick()
const remembered = scrollMemory.get(id)
const restored = remembered ? await scroll.restoreVisibleAnchor(remembered) : false
if (!restored) scroll.scrollToBottomAndClear(false)
```

Remove the redundant old `onSelectContact()` bottom-scroll from this path.

- [ ] **Step 7: Wire mobile list/chat transitions**

Before a history state changes from chat to list, remember the active contact anchor. When `ensureChat()` loads/restores a contact, call `onContactChange({ scrollToBottom: false })`, await render, then restore its memory; fall back to bottom if unavailable.

Do not capture/overwrite memory for `media`, `emoji`, or `attachment` overlay transitions.

- [ ] **Step 8: Clear memory on logout/unmount**

Call:

```ts
scrollMemory.clearAll()
```

alongside existing draft/attachment cleanup.

- [ ] **Step 9: Verify and commit**

```bash
npm exec vitest run src/composables/useConversationScrollMemory.test.ts src/composables/useChatScroll.test.ts src/composables/useMobileChatHistory.test.ts
npm run build
git add frontend/src/composables/useConversationScrollMemory.ts frontend/src/composables/useConversationScrollMemory.test.ts frontend/src/composables/useChatScroll.ts frontend/src/composables/useChatScroll.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: restore conversation reading position"
```

---

### Task 6: Make read receipts and unread badges visibility-aware

**Files:**
- Create: `frontend/src/utils/chatVisibility.ts`
- Create: `frontend/src/utils/chatVisibility.test.ts`
- Modify: `frontend/src/composables/useChatScroll.ts`
- Modify: `frontend/src/composables/useChatScroll.test.ts`
- Modify: `frontend/src/stores/chat.ts`
- Modify: `frontend/src/stores/chat.test.ts`

**Interfaces:**

```ts
export function isDocumentVisible(): boolean

export function shouldIncrementUnread(options: {
  senderId: number
  currentUserId: number
  contactId: number
  currentContactId: number | null
  documentVisible: boolean
}): boolean
```

- [ ] **Step 1: Write failing pure visibility tests**

Create `chatVisibility.test.ts`:

```ts
it('treats a hidden selected conversation as unread')
it('does not increment for a visible selected conversation')
it('increments for another conversation')
it('never increments for the current user own message')
```

Expected rule:

```ts
senderId !== currentUserId &&
(currentContactId !== contactId || !documentVisible)
```

- [ ] **Step 2: Implement the pure helpers**

`isDocumentVisible()`:

```ts
export function isDocumentVisible() {
  return typeof document === 'undefined' ||
    !document.visibilityState ||
    document.visibilityState === 'visible'
}
```

`shouldIncrementUnread()` implements the rule above.

- [ ] **Step 3: Write failing read-receipt visibility test**

In `useChatScroll.test.ts`, temporarily redefine `document.visibilityState` to `hidden`, make an unread incoming message part of the visible virtual range, trigger the scheduled read check, and assert `chatStore.sendWsMessage` is not called.

Then set visibility to `visible`, dispatch `visibilitychange`, flush timers, and assert the read receipt is sent. Restore the original property descriptor after the test.

- [ ] **Step 4: Gate read checks and register visibility retry**

Import `isDocumentVisible`. At the top of `checkVisibleUnread()`:

```ts
if (!isDocumentVisible()) return
```

Register one `visibilitychange` listener inside `useChatScroll`; when visibility becomes visible, call `scheduleReadCheck()`. Remove the listener in `cleanup()`.

- [ ] **Step 5: Add store integration regression tests**

In `chat.test.ts`, cover:

```ts
it('increments unread for the selected conversation while the tab is hidden')
it('does not increment unread for the selected conversation while visible')
it('server read event still clears the contact unread badge')
```

Drive the pure unread decision through the store's incoming chat handling; do not add a new WebSocket protocol or browser notification path.

- [ ] **Step 6: Use the visibility helper in `chat.ts`**

In `handleWsMessage('chat')`, replace the current contact-only unread condition with:

```ts
if (contact && shouldIncrementUnread({
  senderId: msg.senderId,
  currentUserId: userStore.userId,
  contactId,
  currentContactId: currentContact.value?.userId ?? null,
  documentVisible: isDocumentVisible(),
})) {
  contact.unreadCount++
}
```

Keep read receipt sending in `useChatScroll`; the store only owns badge state.

- [ ] **Step 7: Verify and commit**

```bash
npm exec vitest run src/utils/chatVisibility.test.ts src/stores/chat.test.ts src/composables/useChatScroll.test.ts
npm run build
git add frontend/src/utils/chatVisibility.ts frontend/src/utils/chatVisibility.test.ts frontend/src/stores/chat.ts frontend/src/stores/chat.test.ts frontend/src/composables/useChatScroll.ts frontend/src/composables/useChatScroll.test.ts
git commit -m "fix: respect tab visibility for unread state"
```

---

### Task 7: Full interaction regression and privacy verification

**Files:**
- No planned production file outside Tasks 1-6.
- If verification exposes a regression, fix only files already listed in Tasks 1-6.

- [ ] **Step 1: Run the complete interaction suite**

```bash
cd frontend
npm exec vitest run
```

Expected: all existing and new interaction tests PASS.

- [ ] **Step 2: Run production type-check/build**

```bash
npm run build
```

Expected: `vue-tsc --noEmit && vite build` succeeds.

- [ ] **Step 3: Re-run disguise/login privacy tests**

```bash
npm exec vitest run src/views/CoverPage.test.ts src/views/LoginPage.test.ts
```

- [ ] **Step 4: Assert browser-title privacy directly**

From repository root:

```bash
grep -F '<title>有趣 - 随时随地发现新鲜事</title>' frontend/index.html
grep -R "document.title" -n frontend/src || true
```

Expected: the disguise title line exists and no new chat-specific title mutation exists.

- [ ] **Step 5: Check every acceptance case against tests/code**

Confirm all 13 outcomes:

1. Slow initial load never shows `开始聊天吧` early.
2. Initial failure exposes `重新加载`.
3. Load-more failure is retryable without a scroll jump.
4. Every local transient/failed outgoing message owns its status row.
5. Earlier failed messages retain retry after newer messages exist.
6. One pasted/dropped desktop file reaches attachment confirmation.
7. Multiple pasted/dropped files are explicitly rejected.
8. Paste/drop never uploads before confirmation.
9. A -> B -> A restores A's anchor when it is in the first loaded page.
10. Hidden tabs do not send read receipts.
11. A hidden selected conversation can accumulate an in-app unread badge until read.
12. Browser disguise title remains unchanged.
13. Existing mobile history/back/overlay tests still pass.

- [ ] **Step 6: Commit only if verification required an in-scope fix**

If Step 1-5 required a fix, stage the complete allowed scope (unchanged files are ignored by Git) and commit:

```bash
git add \
  frontend/src/types/index.ts \
  frontend/src/stores/chat.ts frontend/src/stores/chat.test.ts \
  frontend/src/components/ConversationMessageState.vue frontend/src/components/ConversationMessageState.test.ts \
  frontend/src/components/MessageStatusIndicator.vue frontend/src/components/MessageStatusIndicator.test.ts \
  frontend/src/composables/useChatScroll.ts frontend/src/composables/useChatScroll.test.ts \
  frontend/src/composables/useAttachmentIngress.ts frontend/src/composables/useAttachmentIngress.test.ts \
  frontend/src/composables/useConversationScrollMemory.ts frontend/src/composables/useConversationScrollMemory.test.ts \
  frontend/src/utils/chatVisibility.ts frontend/src/utils/chatVisibility.test.ts \
  frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "test: harden chat experience regressions"
```

If no fix was needed, do not create an empty commit.

## Final Verification Commands

From repository root:

```bash
cd frontend
npm ci
npm install --no-save vitest@4.1.10 @vue/test-utils@2.4.11 jsdom@27.4.0
npm exec vitest run
npm run build
```

The PR should use the existing `Frontend interactions` workflow plus normal repository CI. No workflow dependency-version change is part of this feature.