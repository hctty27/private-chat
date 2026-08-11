# Chat Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine desktop and mobile chat interaction by isolating per-contact drafts, confirming attachments before upload, making mobile Back unwind chat UI predictably, adding a small message action menu, and normalizing touch/focus feedback without changing backend APIs or message semantics.

**Architecture:** Keep new behavior out of the already-large page components by introducing focused composables/components. Drafts and transient attachment state remain in memory. Mobile navigation uses Vue Router-managed same-URL history entries with `force: true` and serializable `state` rather than direct `window.history.pushState()`, because this project already uses `createWebHistory()` and Vue Router owns `history.state` bookkeeping.

**Tech Stack:** Vue 3.5, TypeScript 5.8, Pinia 3, Vue Router 4.5, Element Plus 2.9, Vite 6, Vitest, Vue Test Utils, jsdom.

## Global Constraints

- No backend API, database, WebSocket protocol, or message schema changes.
- Plain text continues to send immediately; no text-send confirmation dialog.
- Drafts are session-only and must not use `localStorage`, `sessionStorage`, IndexedDB, or backend persistence.
- Selecting an attachment must not start R2 upload until the user explicitly confirms the staged recipient.
- Attachment sending must keep the existing `chatStore.sendFile()` secure upload lifecycle unchanged.
- Do not add recall, delete, quote/reply, forward, edit, multi-file batching, or push notifications.
- Mobile history state must contain only serializable UI metadata; never put `File`, Blob/object URLs, message bodies, or presigned URLs in history state.
- Do not call `window.history.pushState()` or overwrite `history.state` directly in production code. Use Vue Router navigation APIs so Router-owned history metadata is preserved.
- Mobile UI history must keep the visible URL at `/m/chat`; contact ids and overlay details belong only in history state.
- Primary coarse-pointer controls should target approximately `44 x 44 CSS px`; authored pointer targets must not fall below WCAG 2.2 AA `24 x 24 CSS px` unless a documented exception applies.
- Existing reconnect, optimistic send/retry, read receipts, virtual scrolling, authorized media URLs, safe-area handling, and iOS viewport behavior must remain intact.

## File Map

### Create

- `frontend/vitest.config.ts` — isolated frontend unit/component test configuration.
- `frontend/src/test/setup.ts` — jsdom cleanup and shared browser mocks.
- `frontend/src/composables/useChatDrafts.ts` — in-memory per-contact draft map.
- `frontend/src/composables/useChatDrafts.test.ts` — draft isolation/clear behavior.
- `frontend/src/composables/useAttachmentComposer.ts` — immutable staged file + recipient snapshot and confirm/cancel flow.
- `frontend/src/composables/useAttachmentComposer.test.ts` — pre-confirm/no-upload, recipient mismatch, single-confirm tests.
- `frontend/src/components/AttachmentSendDialog.vue` — attachment metadata/preview confirmation UI.
- `frontend/src/components/AttachmentSendDialog.test.ts` — dialog render/emission/accessibility behavior.
- `frontend/src/composables/useMobileChatHistory.ts` — Vue Router-backed list/chat/overlay history state controller.
- `frontend/src/composables/useMobileChatHistory.test.ts` — exact router push/replace/back contracts.
- `frontend/src/utils/messageActions.ts` — pure message-to-action matrix.
- `frontend/src/utils/messageActions.test.ts` — action matrix coverage.
- `frontend/src/composables/useLongPress.ts` — single active long-press timer with movement cancellation.
- `frontend/src/composables/useLongPress.test.ts` — timer/movement/cancel tests.
- `frontend/src/components/MessageActionMenu.vue` — shared desktop/mobile action surface.
- `frontend/src/components/MessageActionMenu.test.ts` — action rendering/emission/keyboard close tests.

### Modify

- `frontend/package.json` — add Vitest scripts/dev dependencies.
- `frontend/package-lock.json` — lock test dependencies.
- `frontend/src/views/ChatPage.vue` — use per-contact drafts, staged attachment flow, desktop message context menu.
- `frontend/src/views/MobileChat.vue` — use drafts, staged attachments, Router-backed Back behavior, long-press actions.
- `frontend/src/components/MediaPreview.vue` — shared tap-target/focus styling only; keep preview behavior.
- `frontend/src/components/NewMessageButton.vue` — shared tap-target/focus styling.
- `frontend/src/components/ContactList.vue` — shared tap-target/focus styling for logout and clickable rows where applicable.
- `frontend/src/assets/main.css` — shared interaction tokens/classes.

---

### Task 1: Add the test harness and per-contact drafts

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/composables/useChatDrafts.ts`
- Create: `frontend/src/composables/useChatDrafts.test.ts`
- Modify: `frontend/src/views/ChatPage.vue` (template input binding + script draft state/send/contact-change sections)
- Modify: `frontend/src/views/MobileChat.vue` (template input binding + script draft state/send/contact-change sections)

**Interfaces:**
- Produces:

```ts
export interface ChatDrafts {
  get(contactId: number): string
  set(contactId: number, value: string): void
  clear(contactId: number): void
  clearAll(): void
}

export function useChatDrafts(): ChatDrafts
```

- [ ] **Step 1: Install the minimal frontend test dependencies and scripts**

Run from `frontend/`:

```bash
npm install -D vitest @vue/test-utils jsdom
```

Update `package.json` scripts to include:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
```

Create `src/test/setup.ts`:

```ts
import { afterEach } from 'vitest'
import { cleanup } from '@vue/test-utils'

afterEach(() => {
  cleanup()
})
```

If the installed Vue Test Utils version does not export `cleanup`, remove that import/call; wrapper cleanup is not required for correctness because wrappers are scoped per test. Do not add another test framework.

- [ ] **Step 2: Write the failing draft tests**

Create `src/composables/useChatDrafts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { useChatDrafts } from './useChatDrafts'

describe('useChatDrafts', () => {
  it('isolates drafts by contact id', () => {
    const drafts = useChatDrafts()

    drafts.set(1, 'Alice draft')
    drafts.set(2, 'Bob draft')

    expect(drafts.get(1)).toBe('Alice draft')
    expect(drafts.get(2)).toBe('Bob draft')
    expect(drafts.get(3)).toBe('')
  })

  it('clears one contact without clearing others', () => {
    const drafts = useChatDrafts()
    drafts.set(1, 'A')
    drafts.set(2, 'B')

    drafts.clear(1)

    expect(drafts.get(1)).toBe('')
    expect(drafts.get(2)).toBe('B')
  })

  it('clears all drafts on teardown/logout', () => {
    const drafts = useChatDrafts()
    drafts.set(1, 'A')
    drafts.set(2, 'B')

    drafts.clearAll()

    expect(drafts.get(1)).toBe('')
    expect(drafts.get(2)).toBe('')
  })
})
```

- [ ] **Step 3: Run the focused test and verify RED**

```bash
npm test -- src/composables/useChatDrafts.test.ts
```

Expected: FAIL because `./useChatDrafts` does not exist.

- [ ] **Step 4: Implement the minimal reactive draft map**

Create `src/composables/useChatDrafts.ts`:

```ts
import { reactive } from 'vue'

export interface ChatDrafts {
  get(contactId: number): string
  set(contactId: number, value: string): void
  clear(contactId: number): void
  clearAll(): void
}

export function useChatDrafts(): ChatDrafts {
  const drafts = reactive(new Map<number, string>())

  return {
    get: (contactId) => drafts.get(contactId) ?? '',
    set: (contactId, value) => {
      if (value) drafts.set(contactId, value)
      else drafts.delete(contactId)
    },
    clear: (contactId) => drafts.delete(contactId),
    clearAll: () => drafts.clear(),
  }
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
npm test -- src/composables/useChatDrafts.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 6: Wire drafts into desktop chat**

In `ChatPage.vue`, replace the page-global `const text = ref('')` with one draft manager and a computed active draft:

```ts
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useChatDrafts } from '../composables/useChatDrafts'

const drafts = useChatDrafts()
const text = computed({
  get() {
    const contactId = chatStore.currentContact?.userId
    return contactId ? drafts.get(contactId) : ''
  },
  set(value: string) {
    const contactId = chatStore.currentContact?.userId
    if (contactId) drafts.set(contactId, value)
  },
})
```

Keep the existing `v-model="text"` template unchanged. Update `send()` to clear only the captured active recipient after enqueueing the message:

```ts
async function send() {
  const contactId = chatStore.currentContact?.userId
  const t = text.value.trim()
  if (!contactId || !t) return

  emojiOpen.value = false
  const isEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u.test(t)
  chatStore.sendMessage(t, isEmoji ? 4 : 1)
  drafts.clear(contactId)
  await nextTick()
  if (inputEl.value) inputEl.value.style.height = 'auto'
  scroll.scrollToBottomAndClear(true)
}
```

On contact change, call `nextTick(grow)` after scroll handling so a restored multiline draft gets the correct textarea height.

In `logout()`, call `drafts.clearAll()` before clearing chat state.

- [ ] **Step 7: Wire the same draft contract into mobile chat**

Apply the same computed `text` approach in `MobileChat.vue`. Do not persist drafts when `closeChat()` returns to the contact list; that is required so reopening the same contact restores the draft. Clear all drafts only during logout/application teardown.

Update the current contact watcher to run `nextTick(grow)` after the contact changes.

- [ ] **Step 8: Run unit tests and type/build validation**

```bash
npm test -- src/composables/useChatDrafts.test.ts
npm run build
```

Expected: tests PASS and `vue-tsc --noEmit && vite build` succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/test/setup.ts frontend/src/composables/useChatDrafts.ts frontend/src/composables/useChatDrafts.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: preserve per-contact chat drafts"
```

---

### Task 2: Stage attachments and confirm the recipient before upload

**Files:**
- Create: `frontend/src/composables/useAttachmentComposer.ts`
- Create: `frontend/src/composables/useAttachmentComposer.test.ts`
- Create: `frontend/src/components/AttachmentSendDialog.vue`
- Create: `frontend/src/components/AttachmentSendDialog.test.ts`
- Modify: `frontend/src/views/ChatPage.vue` (file selection/upload sections + dialog mount)
- Modify: `frontend/src/views/MobileChat.vue` (file selection/upload sections + dialog mount)

**Interfaces:**

```ts
export interface AttachmentRecipient {
  id: number
  nickname: string
}

export interface StagedAttachment {
  file: File
  recipient: AttachmentRecipient
}

export function useAttachmentComposer(options: {
  getCurrentRecipient: () => AttachmentRecipient | null
  onRecipientMismatch: () => void
}): {
  staged: Readonly<Ref<StagedAttachment | null>>
  stage(file: File, recipient: AttachmentRecipient): void
  cancel(): void
  takeConfirmed(): File | null
}
```

`takeConfirmed()` must atomically validate the current recipient and clear staged state before returning the file. The page then invokes the existing `doUpload(file)` exactly once.

- [ ] **Step 1: Write failing attachment-composer tests**

Create `useAttachmentComposer.test.ts` covering:

```ts
import { describe, expect, it, vi } from 'vitest'
import { useAttachmentComposer } from './useAttachmentComposer'

describe('useAttachmentComposer', () => {
  it('stages without uploading or consuming the file', () => {
    let current = { id: 1, nickname: 'Alice' }
    const mismatch = vi.fn()
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: mismatch,
    })
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    composer.stage(file, current)

    expect(composer.staged.value?.file).toBe(file)
    expect(mismatch).not.toHaveBeenCalled()
  })

  it('returns the file once when recipient still matches', () => {
    const current = { id: 1, nickname: 'Alice' }
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: vi.fn(),
    })
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    composer.stage(file, current)

    expect(composer.takeConfirmed()).toBe(file)
    expect(composer.takeConfirmed()).toBeNull()
    expect(composer.staged.value).toBeNull()
  })

  it('blocks a changed recipient', () => {
    let current = { id: 1, nickname: 'Alice' }
    const mismatch = vi.fn()
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: mismatch,
    })
    composer.stage(new File(['x'], 'a.png'), current)
    current = { id: 2, nickname: 'Bob' }

    expect(composer.takeConfirmed()).toBeNull()
    expect(composer.staged.value).toBeNull()
    expect(mismatch).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- src/composables/useAttachmentComposer.test.ts
```

Expected: FAIL because the composable does not exist.

- [ ] **Step 3: Implement immutable recipient staging**

Create `useAttachmentComposer.ts`:

```ts
import { readonly, ref, type Ref } from 'vue'

export interface AttachmentRecipient {
  id: number
  nickname: string
}

export interface StagedAttachment {
  file: File
  recipient: AttachmentRecipient
}

export function useAttachmentComposer(options: {
  getCurrentRecipient: () => AttachmentRecipient | null
  onRecipientMismatch: () => void
}) {
  const staged = ref<StagedAttachment | null>(null)

  function stage(file: File, recipient: AttachmentRecipient) {
    staged.value = {
      file,
      recipient: { ...recipient },
    }
  }

  function cancel() {
    staged.value = null
  }

  function takeConfirmed(): File | null {
    const pending = staged.value
    if (!pending) return null

    staged.value = null
    const current = options.getCurrentRecipient()
    if (!current || current.id !== pending.recipient.id) {
      options.onRecipientMismatch()
      return null
    }
    return pending.file
  }

  return {
    staged: readonly(staged) as Readonly<Ref<StagedAttachment | null>>,
    stage,
    cancel,
    takeConfirmed,
  }
}
```

- [ ] **Step 4: Run composable tests and verify GREEN**

```bash
npm test -- src/composables/useAttachmentComposer.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Write failing dialog component tests**

Test these behaviors in `AttachmentSendDialog.test.ts`:

- renders `发送给：Alice`, file name, formatted size;
- renders image preview for `image/*` using an object URL;
- emits `cancel` from Cancel;
- emits `confirm` once from Send;
- Send is disabled when `busy=true`;
- root has `role="dialog"` and `aria-modal="true"`;
- Escape emits `cancel`;
- object URL is revoked when file changes/unmounts.

Stub `URL.createObjectURL` and `URL.revokeObjectURL` with `vi.stubGlobal`/`vi.spyOn`.

- [ ] **Step 6: Implement `AttachmentSendDialog.vue`**

Use a `Teleport` overlay with a focused dialog card. Required props/emits:

```ts
const props = defineProps<{
  visible: boolean
  file: File | null
  recipientName: string
  busy?: boolean
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
```

Preview rules:

```ts
const presentation = computed(() => {
  if (!props.file) return 'file'
  if (props.file.type.startsWith('image/')) return 'image'
  if (props.file.type.startsWith('video/')) return 'video'
  return 'file'
})
```

Create/revoke object URLs only for image/video preview. Never persist an object URL outside the component. Use the existing `formatFileSize` helper for size text.

Dialog keyboard behavior:

- focus Send on open;
- Escape emits Cancel;
- Tab/Shift+Tab cycles within actionable controls while visible;
- on close/unmount restore focus to the element that was active immediately before the dialog opened.

- [ ] **Step 7: Integrate desktop staging before upload**

In `ChatPage.vue`, replace immediate `doUpload(inp.files[0])` with:

```ts
const attachmentComposer = useAttachmentComposer({
  getCurrentRecipient: () => {
    const c = chatStore.currentContact
    return c ? { id: c.userId, nickname: c.nickname } : null
  },
  onRecipientMismatch: () => ElMessage.warning('联系人已切换，请重新选择文件'),
})

function onFile(e: Event) {
  const inp = e.target as HTMLInputElement
  const file = inp.files?.[0]
  inp.value = ''
  if (!file) return
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning('文件最大支持 50MB')
    return
  }
  const c = chatStore.currentContact
  if (!c) return
  attachmentComposer.stage(file, { id: c.userId, nickname: c.nickname })
}

function confirmAttachment() {
  const file = attachmentComposer.takeConfirmed()
  if (!file) return
  void doUpload(file)
}
```

Mount `AttachmentSendDialog` once near `MediaPreview`, binding the staged snapshot recipient — never `chatStore.currentContact.nickname` directly:

```vue
<AttachmentSendDialog
  :visible="!!attachmentComposer.staged.value"
  :file="attachmentComposer.staged.value?.file ?? null"
  :recipient-name="attachmentComposer.staged.value?.recipient.nickname ?? ''"
  @cancel="attachmentComposer.cancel"
  @confirm="confirmAttachment"
/>
```

- [ ] **Step 8: Integrate the same staging path on mobile**

Apply the same file validation and immutable recipient snapshot in `MobileChat.vue`. Do not start `doUpload()` until confirmation.

At this task, visible Cancel can directly call `attachmentComposer.cancel()`; Task 3 will route attachment-dialog opening/closing through mobile history.

- [ ] **Step 9: Run tests and build**

```bash
npm test -- src/composables/useAttachmentComposer.test.ts src/components/AttachmentSendDialog.test.ts
npm run build
```

Expected: all focused tests PASS and build succeeds.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/composables/useAttachmentComposer.ts frontend/src/composables/useAttachmentComposer.test.ts frontend/src/components/AttachmentSendDialog.vue frontend/src/components/AttachmentSendDialog.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: confirm attachment recipient before upload"
```

---

### Task 3: Make mobile Back unwind list/chat/overlay using Vue Router state

**Files:**
- Create: `frontend/src/composables/useMobileChatHistory.ts`
- Create: `frontend/src/composables/useMobileChatHistory.test.ts`
- Modify: `frontend/src/views/MobileChat.vue` (navigation/open/close/pop synchronization sections)

**Interfaces:**

```ts
export type MobileOverlayKind = 'media' | 'emoji' | 'attachment'

export type MobileChatUiState =
  | { kind: 'list' }
  | { kind: 'chat'; contactId: number }
  | { kind: 'overlay'; contactId: number; overlay: MobileOverlayKind }

export interface MobileChatHistoryController {
  read(): MobileChatUiState
  replaceList(): Promise<void>
  pushChat(contactId: number): Promise<void>
  pushOverlay(contactId: number, overlay: MobileOverlayKind): Promise<void>
  back(): void
  subscribe(listener: (state: MobileChatUiState) => void): () => void
}
```

Use a namespaced state key such as `privateChatUi`.

- [ ] **Step 1: Write failing controller tests against a mocked Vue Router**

Test exact navigation contracts:

```ts
expect(router.replace).toHaveBeenCalledWith({
  name: 'mobile-chat',
  force: true,
  state: { privateChatUi: { kind: 'list' } },
})

expect(router.push).toHaveBeenCalledWith({
  name: 'mobile-chat',
  force: true,
  state: { privateChatUi: { kind: 'chat', contactId: 7 } },
})

expect(router.push).toHaveBeenCalledWith({
  name: 'mobile-chat',
  force: true,
  state: { privateChatUi: { kind: 'overlay', contactId: 7, overlay: 'media' } },
})
```

Also verify:

- `pushOverlay()` is ignored when current state is already the same overlay;
- `back()` calls `router.back()` exactly once;
- `read()` falls back to `{ kind: 'list' }` for missing/malformed `history.state.privateChatUi`;
- `subscribe()` emits on `popstate` and removes its listener when unsubscribed.

- [ ] **Step 2: Run focused history tests and verify RED**

```bash
npm test -- src/composables/useMobileChatHistory.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement Router-owned same-URL history entries**

Core navigation must use Vue Router APIs:

```ts
async function pushState(state: MobileChatUiState) {
  await router.push({
    name: 'mobile-chat',
    force: true,
    state: { [STATE_KEY]: state },
  })
}

async function replaceList() {
  await router.replace({
    name: 'mobile-chat',
    force: true,
    state: { [STATE_KEY]: { kind: 'list' } },
  })
}
```

Do not pass `query`, `params`, or a different path; `/m/chat` must remain unchanged. Do not call `history.pushState()`.

`subscribe()` may listen to `window.popstate` only to *read/synchronize* the new state; it must never push another history entry from inside the pop handler.

- [ ] **Step 4: Run history tests and verify GREEN**

```bash
npm test -- src/composables/useMobileChatHistory.test.ts
```

Expected: all controller tests PASS.

- [ ] **Step 5: Make contact open/back use the controller**

In `MobileChat.vue`:

- initialize the baseline entry on mount with `await mobileHistory.replaceList()` after authentication/route entry is established;
- after `chatStore.selectContact(id)` succeeds, set `chatting=true`, then `await mobileHistory.pushChat(id)`;
- replace the current top-left `closeChat()` direct state mutation with `mobileHistory.back()`;
- do not intercept Back while the UI state is `list` — the next browser Back must leave `/m/chat` normally.

Keep a local sync sequence to prevent stale async `selectContact()` work from re-opening a chat after the user has already navigated back:

```ts
let historySyncSeq = 0

async function applyHistoryState(state: MobileChatUiState) {
  const seq = ++historySyncSeq
  // close transient UI first
  // select contact only for chat/overlay states
  // after await, return if seq !== historySyncSeq
}
```

- [ ] **Step 6: Put media/emoji/attachment confirmation into one overlay layer**

Opening from chat:

- media: set `previewUrl/type`, then `pushOverlay(contactId, 'media')`;
- emoji: when transitioning closed -> open, `pushOverlay(contactId, 'emoji')`;
- attachment: after staging file, `pushOverlay(contactId, 'attachment')`.

Visible close/cancel actions call `mobileHistory.back()` rather than directly creating/replacing history entries.

`applyHistoryState()` rules:

```text
list       -> close all overlays; chatting=false; clear current displayed conversation
chat(id)   -> close overlays; ensure contact id selected; chatting=true
overlay(id, media)      -> ensure chat; show media only if preview payload still exists
overlay(id, emoji)      -> ensure chat; emojiOpen=true
overlay(id, attachment) -> ensure chat; show dialog only if staged file still exists
```

If Forward reaches an overlay entry after its transient payload was already discarded (for example a canceled attachment), normalize with a Router `replace()` to `{ kind: 'chat', contactId }`; do not create another entry.

- [ ] **Step 7: Preserve current mobile keyboard/viewport behavior**

`collapseInput()` may close the soft keyboard without manipulating browser history. If `emojiOpen` represents a history overlay, tapping the message area should close it via `mobileHistory.back()`; do not both mutate `emojiOpen=false` and push/replace another state.

Do not remove existing `visualViewport` resize/scroll handling or bottom-stick logic.

- [ ] **Step 8: Run tests/build and perform a browser Back regression pass**

```bash
npm test -- src/composables/useMobileChatHistory.test.ts
npm run build
```

Manual mobile sequence:

```text
/m/chat list
-> open Alice
-> open image
Back: image closes
Back: Alice chat closes to list
Back: browser leaves /m/chat
```

Repeat with Emoji and attachment confirmation. Then open/close the same overlay at least 5 times and verify one Back closes only one current layer.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/composables/useMobileChatHistory.ts frontend/src/composables/useMobileChatHistory.test.ts frontend/src/views/MobileChat.vue
git commit -m "feat: align mobile chat with browser back navigation"
```

---

### Task 4: Add the message action matrix and desktop/mobile invocation

**Files:**
- Create: `frontend/src/utils/messageActions.ts`
- Create: `frontend/src/utils/messageActions.test.ts`
- Create: `frontend/src/composables/useLongPress.ts`
- Create: `frontend/src/composables/useLongPress.test.ts`
- Create: `frontend/src/components/MessageActionMenu.vue`
- Create: `frontend/src/components/MessageActionMenu.test.ts`
- Modify: `frontend/src/views/ChatPage.vue` (message wrapper + menu state/actions)
- Modify: `frontend/src/views/MobileChat.vue` (message wrapper + long press + menu state/actions)

**Interfaces:**

```ts
export type MessageAction = 'copy' | 'view' | 'open' | 'save' | 'retry'
export function getMessageActions(message: Message): MessageAction[]

export function useLongPress<T>(
  onTrigger: (payload: T, event: PointerEvent) => void,
  options?: { delayMs?: number; movementPx?: number },
): {
  start(event: PointerEvent, payload: T): void
  move(event: PointerEvent): void
  cancel(): void
}
```

`MessageActionMenu` receives the selected message, action list, desktop coordinates, and emits `action`/`close`.

- [ ] **Step 1: Write failing pure action-matrix tests**

Expected matrix:

```ts
text                 -> ['copy']
emoji                -> ['copy']
image with fileUrl   -> ['view', 'save']
video with fileUrl   -> ['view', 'save']
file with fileUrl    -> ['open', 'save']
failed text          -> ['retry', 'copy']
failed attachment    -> ['retry']
```

Do not expose save/open/view when `fileUrl` is absent.

- [ ] **Step 2: Implement `getMessageActions()` and verify GREEN**

Use message `msgType`, `localStatus`, `content`, and `fileUrl` only. Keep it pure and deterministic.

Run:

```bash
npm test -- src/utils/messageActions.test.ts
```

Expected: action-matrix tests PASS.

- [ ] **Step 3: Write failing long-press tests with fake timers**

Use `vi.useFakeTimers()` and verify:

- trigger after 500 ms with < 10 px movement;
- pointer up/cancel before threshold prevents trigger;
- movement > 10 px cancels so scrolling wins;
- starting a second long press cancels the first timer.

- [ ] **Step 4: Implement `useLongPress()` and verify GREEN**

Track only one active pointer:

```ts
let timer: ReturnType<typeof setTimeout> | null = null
let startX = 0
let startY = 0
let payload: T | null = null
let startEvent: PointerEvent | null = null
```

On movement, cancel when `Math.hypot(dx, dy) > movementPx`.

- [ ] **Step 5: Write failing `MessageActionMenu` tests**

Verify:

- renders only provided action labels;
- clicking an item emits exactly one action then close;
- Escape emits close;
- outside pointerdown emits close;
- desktop mode applies bounded x/y positioning;
- mobile/coarse mode renders as bottom sheet via CSS media query, not separate business logic.

- [ ] **Step 6: Implement `MessageActionMenu.vue`**

Action labels:

```ts
const labels: Record<MessageAction, string> = {
  copy: '复制',
  view: '查看',
  open: '打开',
  save: '保存',
  retry: '重试',
}
```

Use semantic `<button>` items. Close on Escape, outside interaction, unmount, and action selection.

- [ ] **Step 7: Integrate desktop right-click + keyboard context-menu access**

In `ChatPage.vue`, on each rendered message wrapper:

```vue
<div
  class="msg"
  tabindex="0"
  @contextmenu.prevent="openMessageMenu($event, message)"
  @keydown.shift.f10.prevent="openMessageMenuFromElement($event, message)"
>
```

Keep one selected `actionMessage` and menu position outside the virtualized item. Close the menu when:

- selected contact changes;
- message list is replaced;
- Escape/outside click;
- an action completes.

Action handlers:

- `copy`: `navigator.clipboard.writeText(message.content ?? '')`; on failure `ElMessage.error('复制失败')`;
- `retry`: call existing `retryMessageByClientId(message.clientMsgId)`;
- `view`: call existing `openPreview(message.fileUrl!, message.msgType === 2 ? 'image' : 'video')`;
- `open`: open the existing same-origin authorized `fileUrl` in a user-initiated navigation;
- `save`: create an `<a>` pointing to the same authorized `fileUrl`, set `download` to `fileName || 'download'`, click, then remove it. Do not fetch/store presigned URLs.

- [ ] **Step 8: Integrate mobile long press**

In `MobileChat.vue`, bind pointer handlers on the message wrapper:

```vue
@pointerdown="longPress.start($event, message)"
@pointermove="longPress.move($event)"
@pointerup="longPress.cancel"
@pointercancel="longPress.cancel"
```

Do not call `preventDefault()` on pointer down/move; vertical scrolling must continue to work. Once triggered, show the same shared `MessageActionMenu`.

Use the existing iOS behavior for file/video opening instead of forcing the `download` attribute where Safari cannot honor it reliably.

- [ ] **Step 9: Run all focused tests/build**

```bash
npm test -- src/utils/messageActions.test.ts src/composables/useLongPress.test.ts src/components/MessageActionMenu.test.ts
npm run build
```

Expected: tests PASS and build succeeds.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/utils/messageActions.ts frontend/src/utils/messageActions.test.ts frontend/src/composables/useLongPress.ts frontend/src/composables/useLongPress.test.ts frontend/src/components/MessageActionMenu.vue frontend/src/components/MessageActionMenu.test.ts frontend/src/views/ChatPage.vue frontend/src/views/MobileChat.vue
git commit -m "feat: add chat message action menu"
```

---

### Task 5: Normalize hit targets, pressed/disabled states, and focus visibility

**Files:**
- Modify: `frontend/src/assets/main.css`
- Modify: `frontend/src/views/MobileChat.vue`
- Modify: `frontend/src/components/AttachmentSendDialog.vue`
- Modify: `frontend/src/components/MessageActionMenu.vue`
- Modify: `frontend/src/components/MediaPreview.vue`
- Modify: `frontend/src/components/NewMessageButton.vue`
- Modify: `frontend/src/components/ContactList.vue`

**Interfaces:**
- Produces shared CSS utility classes/tokens only; no JavaScript API.

- [ ] **Step 1: Add shared interaction tokens/classes**

In `main.css` add:

```css
:root {
  --pointer-target-min: 24px;
  --touch-target-comfortable: 44px;
}

.tap-target {
  min-width: var(--pointer-target-min);
  min-height: var(--pointer-target-min);
}

.tap-target:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.tap-target:disabled,
.tap-target[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (pointer: coarse), (max-width: 767px) {
  .tap-target {
    min-width: var(--touch-target-comfortable);
    min-height: var(--touch-target-comfortable);
  }
}
```

Do not set icon font-size to 44 px; hit box and glyph size remain independent.

- [ ] **Step 2: Apply `tap-target` to frequent controls**

Apply to:

- mobile Back;
- emoji toggle;
- attachment chooser;
- Send;
- attachment-dialog Cancel/Send/Close;
- message action items;
- media preview close;
- new-message button;
- contact list Logout.

Keep existing safe-area padding and fixed input layout unchanged.

- [ ] **Step 3: Normalize pressed/disabled behavior without layout shift**

Buttons that already scale on `:active` may keep a small transform (`0.96`–`0.98`) if it does not move adjacent layout. Disabled controls must not keep an active transform/color that looks actionable.

For send buttons, preserve the existing disabled logic (`!text.trim()`) and add a visible enabled state rather than changing click semantics.

- [ ] **Step 4: Add/retain keyboard focus visibility**

Do not remove browser focus outlines unless replaced by `:focus-visible`. Verify attachment dialog, message menu, media close, logout, new-message button, desktop message wrappers, and send/input controls are reachable/visible by keyboard.

- [ ] **Step 5: Run build and a focused DOM-size sanity check**

Where component tests can inspect computed classes, assert `tap-target` is present on the relevant control. Do not assert jsdom pixel layout because jsdom does not perform layout.

Run:

```bash
npm test
npm run build
```

Expected: entire frontend unit suite PASS and build succeeds.

- [ ] **Step 6: Manual coarse-pointer regression**

On a mobile viewport/device verify:

- Back, Emoji, `+`, Send, close buttons, and message actions can be tapped reliably;
- keyboard open/close still keeps latest messages visible;
- iOS safe-area bottom padding is unchanged;
- no horizontal overflow appears at 320 px CSS width.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/assets/main.css frontend/src/views/MobileChat.vue frontend/src/components/AttachmentSendDialog.vue frontend/src/components/MessageActionMenu.vue frontend/src/components/MediaPreview.vue frontend/src/components/NewMessageButton.vue frontend/src/components/ContactList.vue
git commit -m "style: improve chat interaction targets and feedback"
```

---

### Task 6: Full regression verification and cleanup

**Files:**
- Modify only files from Tasks 1–5 if verification exposes defects.

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Run the complete frontend unit suite**

```bash
cd frontend
npm test
```

Expected: all tests PASS with no unhandled promise rejections or leaked timers.

- [ ] **Step 2: Run production type/build validation**

```bash
npm run build
```

Expected: `vue-tsc --noEmit` and Vite production build PASS.

- [ ] **Step 3: Run the existing repository quality checks that are unaffected by frontend-only changes**

From repository root, run the same CI-relevant commands available locally:

```bash
cd backend
gofmt -l .
go test ./...
go vet ./...

cd ../frontend
npm ci
npm test
npm run build
```

Expected: no Go regressions; clean npm install reproduces passing frontend tests/build.

- [ ] **Step 4: Manual acceptance checklist**

Verify exactly:

```text
Drafts
- Alice draft never appears in Bob.
- Leaving Alice for list and reopening Alice restores Alice draft.
- Sending Alice clears Alice only.
- Reload/logout clears all drafts.

Attachment confirmation
- Choosing a file opens confirmation and performs no upload before Send.
- Recipient name is the staged recipient.
- Switching contact before confirming blocks the send.
- Cancel performs no upload.
- Confirm produces exactly one upload/message.

Mobile history
- Back closes media/emoji/attachment overlay first.
- Next Back returns chat -> list.
- Next Back uses normal browser history.
- Repeating open/close does not require extra Back presses.

Message actions
- Desktop right-click and Shift+F10 expose the approved action set.
- Mobile long press works without breaking scroll.
- Failed text exposes Retry + Copy.
- Failed attachment exposes Retry only.
- File actions continue through authorized same-origin URLs.

Interaction sizing
- Frequent mobile controls are comfortably tappable.
- Disabled and focus-visible states are obvious.
- No iOS keyboard/safe-area regression.
```

- [ ] **Step 5: Inspect the final diff for scope creep**

```bash
git diff master...HEAD -- frontend docs/superpowers
```

Reject any accidental additions of:

- backend/schema/API changes;
- persistent draft storage;
- raw `window.history.pushState()` production calls;
- contact/message content in history state;
- recall/delete/reply/forward behavior.

- [ ] **Step 6: Commit any verification-only fixes**

If no fixes are required, do not create an empty commit. If fixes were required:

```bash
git add frontend
git commit -m "fix: harden chat interaction polish"
```

## External implementation references

- Vue Router `RouteLocationOptions` supports both `force` and serializable `state`; `force` allows a same-location navigation to create another history entry. Use this instead of direct `pushState()`.
- Vue Router documents that it stores its own navigation metadata in `history.state`, so any manual replacement must preserve Router state; this plan avoids direct production mutation entirely.
- MDN documents that `pushState()` adds session-history entries whose serializable state is surfaced by `popstate`; Vue Router is the owning abstraction in this application.
- WCAG 2.2 SC 2.5.8 defines the Level AA pointer-target minimum as `24 x 24 CSS px`, subject to documented exceptions.
- Apple interface guidance recommends touch hit targets of at least `44 x 44 points`; the project uses approximately 44 CSS px as a practical coarse-pointer comfort target while retaining the WCAG minimum baseline.
