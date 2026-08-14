# Chat Experience Polish V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve chat feedback and navigation without changing backend APIs, database schema, WebSocket protocol, file-security semantics, or the disguise/privacy model.

**Architecture:** Keep `ChatPage.vue` and `MobileChat.vue` as orchestration layers. Add focused shared units for conversation-state rendering, attachment ingress, and per-contact scroll memory; extend the existing chat store and `useChatScroll` only for state they already own. Preserve the current attachment confirmation and secure upload lifecycle.

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

Focused tests use:

```bash
npm exec vitest run <test-files...>
```

Final frontend verification uses:

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
- Produces:

```ts
export type MessageLoadState = 'idle' | 'loading' | 'loaded' | 'error'
```

- `useChatStore()` additionally exposes:

```ts
messageLoadState: Ref<MessageLoadState>
messageLoadError: Ref<string>
retryInitialMessages(): Promise<boolean>
```

- `ConversationMessageState.vue` props/events:

```ts
state: MessageLoadState
hasMessages: boolean
error?: string
retry: []
```

- [ ] **Step 1: Add failing store tests for initial load state**

Create `frontend/src/stores/chat.test.ts`. Use `createPinia()` + `setActivePinia()` and mock `../api` with Vitest. Cover these exact cases:

```ts
it('transitions initial load from loading to loaded', async () => {
  // Arrange one selected contact and a deferred getMessages promise.
  // Assert messageLoadState === 'loading' before resolving.
  // Resolve { code: 200, data: { messages: [], hasMore: false } }.
  // Assert messageLoadState === 'loaded' and messageLoadError === ''.
})

it('sets initial load error without fabricating an empty conversation', async () => {
  // Reject getMessages.
  // Assert loadMessages('init') === false.
  // Assert messageLoadState === 'error'.
  // Assert messageLoadError === '消息加载失败，请重试'.
})

it('does not let a stale contact response overwrite the active load state', async () => {
  // Start A, switch to B, resolve B successfully, then resolve A.
  // Assert active messages/state still belong to B and stay loaded.
})
```

Use a stable contact factory with all required `Contact` fields and call `userStore.login('token', 99, 'Me')` in test setup so store token-generation guards behave normally.

- [ ] **Step 2: Run store tests and verify RED**

```bash
npm exec vitest run src/stores/chat.test.ts
```

Expected: FAIL because `MessageLoadState`, `messageLoadState`, `messageLoadError`, and retry behavior do not exist.

- [ ] **Step 3: Implement the store state machine**

Add to `frontend/src/types/index.ts`:

```ts
export type MessageLoadState = 'idle' | 'loading' | 'loaded' | 'error'
```

In `chat.ts`, import the type and add:

```ts
const messageLoadState = ref<MessageLoadState>('idle')
const messageLoadError = ref('')
```

For `loadMessages('init')`:

```ts
if (mode === 'init') {
  messageLoadState.value = 'loading'
  messageLoadError.value = ''
}
```

Only the latest active initial request may finish the state transition. For its success path:

```ts
messageLoadState.value = 'loaded'
messageLoadError.value = ''
```

For an active request that throws or returns non-200:

```ts
messageLoadState.value = 'error'
messageLoadError.value = '消息加载失败，请重试'
```

Do not change `messageLoadState` for `loadMore` calls. Reset both values in `clearState()` and when a new contact selection starts.

Add:

```ts
async function retryInitialMessages() {
  return loadMessages('init')
}
```

Return all three new store members.

- [ ] **Step 4: Run store tests and verify GREEN**

```bash
npm exec vitest run src/stores/chat.test.ts
```

Expected: all initial-load tests PASS.

- [ ] **Step 5: Add failing component tests for `ConversationMessageState.vue`**

Cover:

```ts
it('shows loading but not empty copy while initial load is pending')
it('shows empty copy only after loaded with no messages')
it('shows retry UI on error and emits retry')
it('renders nothing when messages already exist')
```

The retry control must be a real `<button type="button">重新加载</button>`.

- [ ] **Step 6: Implement `ConversationMessageState.vue`**

Use a centered state container with these exact visible copies:

```text
加载消息中...
消息加载失败
重新加载
开始聊天吧
```

For loading/error feedback, use `role="status"` for passive status text. Do not autofocus the retry button.

- [ ] **Step 7: Wire the shared state into desktop and mobile pages**

Replace the current unconditional `messages.length === 0 -> 开始聊天吧` branch with:

```vue
<ConversationMessageState
  :state="chatStore.messageLoadState"
  :has-messages="chatStore.messages.length > 0"
  :error="chatStore.messageLoadError"
  @retry="retryInitialMessages"
/>
```

Keep the virtual list mounted only when messages exist.

Add page helper:

```ts
async function retryInitialMessages() {
  const loaded = await chatStore.retryInitialMessages()
  if (loaded) scroll.scrollToBottomAndClear(false)
}
```

- [ ] **Step 8: Run focused tests and build**

```bash
npm exec vitest run src/stores/chat.test.ts src/components/ConversationMessageState.test.ts
npm run build
```

Expected: tests PASS; type-check/build succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/stores/chat.ts frontend/src/stores/chat.test.ts frontend/src/components/ConversationMessageState.vue frontend/src/components/ConversationMessageState.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: expose conversation loading states"
```

---

### Task 2: Load-more error feedback and retry without scroll jumps

**Files:**
- Modify: `frontend/src/composables/useChatScroll.ts`
- Create: `frontend/src/composables/useChatScroll.test.ts`
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`

**Interfaces:**
- `useChatScroll()` additionally returns:

```ts
loadMoreError: Ref<string>
retryLoadMore(): Promise<void>
captureVisibleAnchor(): ConversationScrollAnchor | null
restoreVisibleAnchor(anchor: ConversationScrollAnchor): Promise<boolean>
```

`ConversationScrollAnchor` is introduced in Task 4, but define/export it in `useChatScroll.ts` now so Task 4 can import the exact same type:

```ts
export interface ConversationScrollAnchor {
  messageId: number
  offset: number
}
```

- [ ] **Step 1: Write failing tests for load-more failure**

In `useChatScroll.test.ts`, mock the Pinia chat store method `loadMessages` to return `false`. Mount the composable through a minimal harness component with a scroll container. Assert:

```ts
expect(scroll.loadMoreError.value).toBe('历史消息加载失败，点击重试')
expect(container.scrollTop).toBe(beforeScrollTop)
```

Then switch the mock to return `true`, call `retryLoadMore()`, and assert `loadMoreError` clears.

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm exec vitest run src/composables/useChatScroll.test.ts
```

Expected: FAIL because load-more error state/retry are not exposed.

- [ ] **Step 3: Refactor anchor helpers into public composable methods**

Rename the existing private anchor functions to public names without changing behavior:

```ts
function captureVisibleAnchor(): ConversationScrollAnchor | null
async function restoreVisibleAnchor(anchor: ConversationScrollAnchor): Promise<boolean>
```

`restoreVisibleAnchor` should use the existing two-frame + `nextTick()` stabilization and return `false` if the message is absent.

- [ ] **Step 4: Implement load-more error state**

Add:

```ts
const loadMoreError = ref('')
```

At the beginning of a load-more attempt:

```ts
loadMoreError.value = ''
```

If `await chatStore.loadMessages('loadMore')` returns `false`, stop without applying scroll-height compensation and set:

```ts
loadMoreError.value = '历史消息加载失败，点击重试'
```

Always clear `loading` / `isLoadingMore` in `finally`-equivalent cleanup.

Add:

```ts
async function retryLoadMore() {
  if (loading.value) return
  await loadMore()
}
```

Return the new state/methods.

- [ ] **Step 5: Update desktop/mobile history-load UI**

In the existing `.load-more` area, order states as:

```vue
<template v-if="scroll.loading.value">...</template>
<button v-else-if="scroll.loadMoreError.value" type="button" class="load-retry" @click="scroll.retryLoadMore">
  {{ scroll.loadMoreError.value }}
</button>
<span v-else-if="chatStore.hasMore">↑ 上拉加载更多</span>
<span v-else-if="chatStore.messages.length > 0">没有更早的消息了</span>
```

Keep the button compact and keyboard-focusable.

- [ ] **Step 6: Run focused tests and build**

```bash
npm exec vitest run src/composables/useChatScroll.test.ts
npm run build
```

- [ ] **Step 7: Commit**

```bash
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
- Add prop:

```ts
showReadState?: boolean
```

Default it to `true` for compatibility.

- [ ] **Step 1: Write failing component tests**

Cover exact statuses:

```ts
it.each([
  ['uploading', '上传中'],
  ['queued', '排队中'],
  ['sending', '发送中'],
  ['failed', '发送失败'],
])(...)
```

Also assert:

```ts
it('emits retry from a failed message')
it('shows 已读/未读 only when showReadState is true and no local status exists')
it('renders no read text when showReadState is false and no local status exists')
```

- [ ] **Step 2: Run test and verify RED**

```bash
npm exec vitest run src/components/MessageStatusIndicator.test.ts
```

- [ ] **Step 3: Implement `showReadState`**

Use `withDefaults(defineProps<...>(), { showReadState: true })`. The final fallback branch becomes conditional:

```vue
<template v-else-if="props.showReadState">
  {{ props.isRead ? '已读' : '未读' }}
</template>
```

- [ ] **Step 4: Replace last-message-only rendering rule in both pages**

Add helper:

```ts
function shouldShowMessageStatus(index: number) {
  const message = chatStore.messages[index]
  if (!message || message.senderId !== uid.value) return false
  return !!message.localStatus || isLastSelfMessage(index)
}
```

Render the status row when `shouldShowMessageStatus(vi.index)` and pass:

```vue
:show-read-state="!chatStore.messages[vi.index].localStatus && isLastSelfMessage(vi.index)"
```

This guarantees an earlier failed/queued/uploading message keeps its own status/retry affordance after newer messages are sent.

- [ ] **Step 5: Add a page-level regression test or pure rendering helper test**

Verify two outgoing messages where the first has `localStatus: 'failed'` and the second is confirmed: the first still renders a retry control and the second owns the read/unread text.

- [ ] **Step 6: Run focused tests and build**

```bash
npm exec vitest run src/components/MessageStatusIndicator.test.ts
npm run build
```

- [ ] **Step 7: Commit**

```bash
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

```ts
export interface AttachmentRecipient {
  id: number
  nickname: string
}

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
it('never calls an upload function because ingress only stages')
```

Build clipboard/drop events with `DataTransfer` and `File` objects in jsdom. Keep tests at the composable boundary; do not depend on `chatStore.sendFile()`.

- [ ] **Step 2: Run test and verify RED**

```bash
npm exec vitest run src/composables/useAttachmentIngress.test.ts
```

- [ ] **Step 3: Implement single-file validation and staging**

Implementation contract:

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

`handlePaste` must inspect `event.clipboardData?.files`. If there are no files, return `false` without calling `preventDefault()`. If files exist, call `preventDefault()` and run validation.

`handleDrop` must inspect `event.dataTransfer?.files`; when at least one file exists, call `preventDefault()` to stop browser navigation, then validate.

- [ ] **Step 4: Wire file picker through the shared ingress helper**

In both pages, replace duplicate size/recipient validation with:

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

Picker handler calls `acceptFiles()` and retains the existing mobile history-overlay push after a successful stage.

- [ ] **Step 5: Add desktop paste and drag/drop UI**

On desktop `ChatPage.vue`:

```vue
<main
  class="chat-main"
  @paste="onPasteAttachment"
  @dragenter.prevent="onDragEnter"
  @dragover.prevent="onDragOver"
  @dragleave="onDragLeave"
  @drop="onDropAttachment"
>
```

Track a drag-depth counter or equivalent boolean that is reset on drop. Show an overlay only while a file drag is active:

```text
松开以发送文件
```

Do not intercept ordinary text paste.

- [ ] **Step 6: Keep mobile behavior conservative**

Mobile continues to use the picker through `acceptFiles()`. Do not add a drag overlay. Do not add a global mobile paste listener; normal textarea paste remains native unless a later platform-specific need is proven.

- [ ] **Step 7: Run tests and build**

```bash
npm exec vitest run src/composables/useAttachmentIngress.test.ts src/composables/useAttachmentComposer.test.ts src/components/AttachmentSendDialog.test.ts
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/composables/useAttachmentIngress.ts frontend/src/composables/useAttachmentIngress.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: support paste and drop attachments"
```

---

### Task 5: Remember and restore per-conversation reading position

**Files:**
- Create: `frontend/src/composables/useConversationScrollMemory.ts`
- Create: `frontend/src/composables/useConversationScrollMemory.test.ts`
- Modify: `frontend/src/composables/useChatScroll.ts`
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

- [ ] **Step 1: Write failing memory tests**

Cover:

```ts
it('isolates anchors by contact id')
it('overwrites one contact without changing another')
it('clears one contact')
it('clears all contacts')
it('stores immutable anchor copies rather than caller-owned objects')
```

- [ ] **Step 2: Run test and verify RED**

```bash
npm exec vitest run src/composables/useConversationScrollMemory.test.ts
```

- [ ] **Step 3: Implement the in-memory map**

Use a plain `Map<number, ConversationScrollAnchor>`; no browser storage.

```ts
remember(contactId, anchor) {
  if (anchor) anchors.set(contactId, { ...anchor })
  else anchors.delete(contactId)
}
```

- [ ] **Step 4: Add anchor API regression tests to `useChatScroll.test.ts`**

Build a fake scroll viewport containing `.virtual-item[data-msg-id]` elements with deterministic mocked `getBoundingClientRect()` values. Assert:

```ts
captureVisibleAnchor() // returns first item intersecting top edge + offset
restoreVisibleAnchor(anchor) // adjusts scrollTop and returns true
restoreVisibleAnchor(missingAnchor) // returns false
```

- [ ] **Step 5: Wire desktop contact switching**

Before `chatStore.selectContact(id)`:

```ts
const oldContactId = chatStore.currentContact?.userId
if (oldContactId) scrollMemory.remember(oldContactId, scroll.captureVisibleAnchor())
```

After `selectContact(id)` and render:

```ts
const remembered = scrollMemory.get(id)
const restored = remembered ? await scroll.restoreVisibleAnchor(remembered) : false
if (!restored) scroll.scrollToBottomAndClear(false)
```

Avoid calling both the old unconditional `onSelectContact()` bottom-scroll and the new restore path.

- [ ] **Step 6: Wire mobile open/close/back behavior**

When leaving a chat for the contact list, remember the active contact anchor before clearing messages/current contact. When opening or restoring a contact from router history, attempt its remembered anchor after `selectContact()` + render; fall back to bottom if unavailable.

Overlay transitions (`media`, `emoji`, `attachment`) must not capture or overwrite contact scroll memory because they do not represent a conversation switch.

- [ ] **Step 7: Clear memory on logout/unmount**

Call `scrollMemory.clearAll()` during logout and mobile teardown, alongside existing draft cleanup.

- [ ] **Step 8: Run focused regressions and build**

```bash
npm exec vitest run src/composables/useConversationScrollMemory.test.ts src/composables/useChatScroll.test.ts src/composables/useMobileChatHistory.test.ts
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/composables/useConversationScrollMemory.ts frontend/src/composables/useConversationScrollMemory.test.ts frontend/src/composables/useChatScroll.ts frontend/src/composables/useChatScroll.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: restore conversation reading position"
```

---

### Task 6: Make read receipts and unread badges visibility-aware

**Files:**
- Modify: `frontend/src/composables/useChatScroll.ts`
- Modify: `frontend/src/composables/useChatScroll.test.ts`
- Modify: `frontend/src/stores/chat.ts`
- Modify: `frontend/src/stores/chat.test.ts`

**Interfaces:**
- Add internal helper in `useChatScroll.ts`:

```ts
function isDocumentVisible() {
  return typeof document === 'undefined' || !document.visibilityState || document.visibilityState === 'visible'
}
```

- [ ] **Step 1: Write failing read-receipt visibility test**

In `useChatScroll.test.ts`, set `document.visibilityState` to `hidden`, make an unread incoming message visible in the virtualizer, trigger the read check, and assert `chatStore.sendWsMessage` is not called.

Then set visibility to `visible`, dispatch `visibilitychange`, rerun/schedule the read check, and assert the read receipt is sent once.

Restore the original property descriptor after each test.

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm exec vitest run src/composables/useChatScroll.test.ts
```

- [ ] **Step 3: Gate read checks on visibility**

At the top of `checkVisibleUnread()`:

```ts
if (!isDocumentVisible()) return
```

Register one `visibilitychange` handler inside the composable that calls `scheduleReadCheck()` when the page becomes visible; remove it in `cleanup()`.

- [ ] **Step 4: Write failing hidden-tab unread store test**

In `chat.test.ts`, simulate an incoming chat message for the currently selected contact while `document.visibilityState === 'hidden'`. The contact starts with `unreadCount: 0`. Assert it becomes `1` even though the conversation is selected.

Also keep a regression test that an incoming message in a visible selected conversation does not increment the badge, and an existing server `read` event clears the badge.

For testability, extract the contact-unread decision into a small exported pure helper in `chat.ts` or `frontend/src/utils/chatVisibility.ts` rather than exposing private WebSocket internals. Preferred helper:

```ts
export function shouldIncrementUnread(options: {
  senderId: number
  currentUserId: number
  contactId: number
  currentContactId: number | null
  documentVisible: boolean
}) {
  if (options.senderId === options.currentUserId) return false
  return options.currentContactId !== options.contactId || !options.documentVisible
}
```

- [ ] **Step 5: Implement visibility-aware unread increment**

Use the helper in `handleWsMessage('chat')` with:

```ts
const documentVisible = typeof document === 'undefined' || !document.visibilityState || document.visibilityState === 'visible'
```

Increment the contact badge when the message is from another user and either another conversation is selected or the document is hidden.

Do not send any new WebSocket message from the store; `useChatScroll` remains responsible for read receipts.

- [ ] **Step 6: Run visibility tests**

```bash
npm exec vitest run src/stores/chat.test.ts src/composables/useChatScroll.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stores/chat.ts frontend/src/stores/chat.test.ts frontend/src/composables/useChatScroll.ts frontend/src/composables/useChatScroll.test.ts
git commit -m "fix: respect tab visibility for unread state"
```

---

### Task 7: Full interaction regression and privacy verification

**Files:**
- Modify only if a regression test exposes a defect in files already in scope.
- Do not change backend, migrations, `frontend/index.html`, or browser-title behavior.

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

- [ ] **Step 3: Run targeted privacy assertions**

Verify existing cover/login tests still pass:

```bash
npm exec vitest run src/views/CoverPage.test.ts src/views/LoginPage.test.ts
```

Verify `frontend/index.html` still contains exactly:

```html
<title>有趣 - 随时随地发现新鲜事</title>
```

and no production code writes a chat unread count into `document.title`:

```bash
grep -R "document.title" -n src || true
```

Expected: no new chat-specific title mutation.

- [ ] **Step 4: Review acceptance cases manually in code/test form**

Confirm each requirement has a passing automated test or direct code assertion:

1. Initial slow load never renders `开始聊天吧` early.
2. Initial failure exposes `重新加载`.
3. Load-more failure is retryable without anchor loss.
4. Every local transient/failed outgoing message owns its status row.
5. Earlier failed message can retry after newer messages exist.
6. One pasted/dropped desktop file reaches attachment confirmation.
7. Multiple pasted/dropped files are explicitly rejected.
8. Paste/drop never calls upload before confirmation.
9. A -> B -> A restores A's anchor when present in the first loaded page.
10. Hidden tabs do not send read receipts.
11. Hidden selected conversation can accumulate an in-app unread badge until read.
12. Browser disguise title is unchanged.
13. Existing mobile overlay/back semantics still pass.

- [ ] **Step 5: Final commit only if verification required fixes**

If Task 7 exposes and fixes an in-scope regression:

```bash
git add <only-files-modified-by-the-regression-fix>
git commit -m "test: harden chat experience regressions"
```

Otherwise do not create an empty commit.

## Final Verification Commands

Run from repository root:

```bash
cd frontend
npm ci
npm install --no-save vitest@4.1.10 @vue/test-utils@2.4.11 jsdom@27.4.0
npm exec vitest run
npm run build
```

The PR should rely on the existing `Frontend interactions` workflow and normal repository CI; no workflow dependency-version change is required for this feature.