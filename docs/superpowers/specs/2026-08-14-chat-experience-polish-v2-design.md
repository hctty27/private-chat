# Chat Experience Polish V2 Design

## Context

The current chat UI already has the core reliability and interaction features needed for day-to-day use: optimistic local messages, retryable sends, upload progress, reconnect recovery, per-contact drafts, attachment confirmation, virtualized message rendering, mobile history-backed overlays, long-press/context-menu message actions, and a “new messages” return-to-bottom control.

The next pass should not add new messaging semantics. It should make the existing flow feel predictable under slow networks, failed requests, long conversations, desktop file workflows, and multi-tab usage.

A privacy constraint is especially important: `frontend/index.html` intentionally uses the disguise title `有趣 - 随时随地发现新鲜事`, and recent work protects the disguise/login flow from leaking private-chat state. This iteration must preserve that browser title and must not expose unread counts or the real application purpose in the browser tab title.

## Goals

1. Make conversation loading states explicit so users can distinguish loading, empty history, and failure.
2. Surface transient and failed delivery state on the exact outgoing message that owns it.
3. Support desktop paste and drag/drop attachments without bypassing the existing recipient confirmation or secure upload lifecycle.
4. Restore the user's previous reading position when switching away from and back to a conversation during the same session.
5. Improve unread/read behavior for hidden tabs without changing the disguise title.

## Non-Goals

- No backend API changes.
- No database migrations.
- No WebSocket protocol changes.
- No quote/reply, edit, recall, forwarding, message search, typing indicators, reactions, multi-file batching, or push notifications.
- No persistent drafts or persistent scroll positions.
- No change to file-size policy; the current 50 MB limit remains authoritative.
- No automatic upload from paste or drop. A selected file must still be staged and explicitly confirmed before upload.
- No unread counter in `document.title`, favicon, or other browser chrome that would weaken the disguise behavior.

## Recommended Architecture

Keep page components as orchestration layers and move reusable behavior into focused composables/components. `ChatPage.vue` and `MobileChat.vue` are already large; this pass should avoid adding another independent state machine directly to either page.

The design introduces three focused units:

- `ConversationMessageState.vue`: shared initial-loading / initial-error / empty-history presentation.
- `useAttachmentIngress.ts`: converts file-picker, paste, and drag/drop input into one validated single-file staging contract.
- `useConversationScrollMemory.ts`: session-only per-contact scroll anchors used by the existing virtualized list.

Existing units remain authoritative for their current responsibilities:

- `useAttachmentComposer.ts` continues to own immutable recipient staging and confirm/cancel semantics.
- `chatStore.sendFile()` continues to own optimistic file messages, upload lifecycle, and retry behavior.
- `MessageStatusIndicator.vue` continues to own delivery-status rendering.
- `useChatScroll.ts` continues to own virtualization, load-more behavior, bottom detection, read checks, and scrolling mechanics.

## 1. Initial Conversation Loading and Error States

### Problem

`selectContact()` clears `messages` before awaiting `loadMessages('init')`. During a slow request, the view can temporarily render the same empty-state copy used for a genuinely empty conversation. If the request fails, the primary user-visible feedback is also insufficient.

### State Model

Add store-level state for initial history loading:

```ts
export type MessageLoadState = 'idle' | 'loading' | 'loaded' | 'error'

const messageLoadState = ref<MessageLoadState>('idle')
const messageLoadError = ref('')
```

For `loadMessages('init')`:

- Before request: `loading`, clear the previous initial-load error.
- Success: `loaded` even when the server returns zero messages.
- Failure / non-200 response: `error` with a stable user-facing message.
- Stale responses caused by contact switching must not overwrite the active conversation's state.

`loadMore` keeps its own transient state in `useChatScroll`; it must not flip the whole conversation back to initial loading.

### UI Contract

`ConversationMessageState.vue` receives:

```ts
state: MessageLoadState
hasMessages: boolean
error?: string
```

and emits:

```ts
retry: []
```

Rendering rules:

- `loading && !hasMessages`: centered spinner + `加载消息中...`.
- `error && !hasMessages`: `消息加载失败` + `重新加载` button.
- `loaded && !hasMessages`: `开始聊天吧`.
- When messages already exist, initial-state UI stays out of the way.

Both loading and error copy should be exposed as status information without forcibly moving keyboard focus. This is compatible with the intent of WCAG status-message guidance.

### Load-More Failure

`useChatScroll` gains `loadMoreError: Ref<string>` and `retryLoadMore()`.

At the top of the list:

- Loading: existing spinner/copy.
- Error: `历史消息加载失败，点击重试` as an explicit button/action.
- Has more: existing `↑ 上拉加载更多` hint.
- Exhausted: existing end-of-history copy.

A failed load-more request must preserve the current scroll anchor and must not clear already loaded messages.

## 2. Per-Message Delivery Feedback

### Problem

The store already tracks `uploading`, `queued`, `sending`, and `failed` per local message, but the page currently mounts `MessageStatusIndicator` only for the most recent self-authored message. A failed earlier send can therefore become visually detached from its failure/retry affordance.

### Rendering Rule

Every self-authored message should render a status row when either:

- `message.localStatus` exists, or
- it is the last self-authored confirmed message and therefore owns the existing read/unread indicator.

This keeps transient/error feedback attached to every affected message while avoiding permanent “已发送” metadata under the entire history.

`MessageStatusIndicator.vue` remains mostly unchanged:

- `failed`: show failure + retry.
- `uploading`: show upload percentage.
- `queued`: show queued/offline state.
- `sending`: show sending state.
- no `localStatus`: show `已读` / `未读` only when the caller marks this message as the read-receipt owner.

Add a boolean prop such as `showReadState` so non-last confirmed self messages can omit the status row entirely rather than incorrectly showing `未读`.

### Accessibility

Retry remains a real `<button>`. Status text is not made focusable by itself. The failure state remains readable in text rather than color alone.

## 3. Desktop Paste and Drag/Drop Attachments

### Browser Basis

User-initiated paste events expose clipboard data through `ClipboardEvent.clipboardData`, which provides a `DataTransfer`. File drops expose files through `DataTransfer.files` during `drop`. The feature therefore does not require the asynchronous Clipboard API or extra browser permissions.

### Shared Ingress Contract

Create `useAttachmentIngress.ts`:

```ts
export interface AttachmentIngressOptions {
  maxBytes: number
  getRecipient: () => { id: number; nickname: string } | null
  onStage: (file: File, recipient: { id: number; nickname: string }) => void
  onWarning: (message: string) => void
}

export interface AttachmentIngress {
  acceptFiles(files: FileList | File[]): boolean
  handlePaste(event: ClipboardEvent): boolean
  handleDrop(event: DragEvent): boolean
}
```

Rules:

1. No recipient -> reject without staging.
2. Zero files -> return `false`; normal text paste must remain untouched.
3. More than one file -> reject with `暂时只支持一次发送 1 个文件` rather than silently dropping extras.
4. File larger than 50 MB -> reject with existing size-limit copy.
5. Exactly one valid file -> call `attachmentComposer.stage(file, recipient)`.
6. `handlePaste()` calls `preventDefault()` only after a file was actually accepted/rejected as a file operation; ordinary text paste remains browser-native.
7. `handleDrop()` prevents default navigation when a file drop is detected.
8. Staging never calls `chatStore.sendFile()` directly.

### Desktop UI

`ChatPage.vue` adds:

- `@paste` on the composer/message area so screenshots copied from desktop tools can be staged.
- drag-enter/drag-over/drop handling on the chat main area.
- a lightweight drag overlay: `松开以发送文件` while a file is dragged over the chat pane.

The existing `AttachmentSendDialog.vue` remains the only confirm step, so picker, paste, and drop all converge on the same recipient snapshot and upload flow.

### Mobile

No drag overlay is added on mobile. The shared ingress helper may still be used by the file picker for validation consistency, but mobile paste handling should not intercept normal textarea paste unless a real clipboard file is present and supported by the browser.

## 4. Per-Conversation Reading Position Memory

### Problem

The current contact-change flow scrolls to the bottom. If a user is reading older history, switches contacts, and comes back, the reading position is lost.

### Memory Model

Create `useConversationScrollMemory.ts` with an in-memory map:

```ts
export interface ConversationScrollAnchor {
  messageId: number
  offset: number
}

export interface ConversationScrollMemory {
  remember(contactId: number, anchor: ConversationScrollAnchor | null): void
  get(contactId: number): ConversationScrollAnchor | null
  clear(contactId: number): void
  clearAll(): void
}
```

No localStorage/sessionStorage/backend persistence.

### Integration with Virtualization

Reuse the same anchor concept already present in `useChatScroll`: first rendered item intersecting the top edge + its pixel offset from the scroll container.

Expose from `useChatScroll`:

```ts
captureVisibleAnchor(): ConversationScrollAnchor | null
restoreVisibleAnchor(anchor: ConversationScrollAnchor): Promise<boolean>
```

Contact-switch flow:

1. Before changing the contact, capture and store the old contact's visible anchor.
2. Await `chatStore.selectContact(newId)` so initial messages are present.
3. Await render/virtualizer measurement.
4. If a stored anchor exists and its message is present, restore it.
5. Otherwise fall back to the existing bottom behavior.

If the remembered anchor is older than the first page currently loaded and therefore absent, do not automatically issue an unbounded sequence of history requests. Fall back to bottom. This keeps behavior deterministic and avoids expensive surprise fetches.

Mobile returning from chat to the contact list must remember the anchor. Logout/unmount clears scroll-memory state.

## 5. Hidden-Tab Read and Unread Semantics

### Privacy Constraint

Keep the disguise title exactly unchanged. Do not write unread counts into `document.title`.

### Problem

A hidden tab can still have the current contact selected. Treating “current contact selected” as equivalent to “user saw the message” can suppress unread feedback or send a read receipt while the document is not visible.

### Design

Read checks in `useChatScroll` must require:

```ts
document.visibilityState === 'visible'
```

before sending a read receipt.

When an incoming message belongs to the selected conversation but the document is hidden, the contact's unread count should increase in that tab. When the document becomes visible again, the existing visibility/read check should run; after the message is actually visible, the normal read receipt clears the unread count.

This keeps multi-tab state compatible with server read events: another visible tab may read the conversation first, and the server's read event can clear the hidden tab's local badge through the existing WebSocket flow.

No browser-level notification or title badge is introduced.

## Error Handling

- Initial history errors remain local to the currently selected conversation and are retryable.
- Load-more errors never discard the loaded list or move the user's current anchor.
- Paste/drop validation failures use the existing Element Plus warning surface and do not create optimistic messages.
- Attachment recipient snapshots are still validated by `useAttachmentComposer.takeConfirmed()`; switching contacts after staging cannot send to the wrong recipient.
- Scroll restore failure is non-fatal: fall back to the bottom without a toast.
- Visibility API absence should degrade to the current behavior by treating the document as visible.

## Testing Strategy

### Store Tests

Cover:

- initial history transitions `loading -> loaded`.
- initial request failure -> `error`.
- stale contact request cannot overwrite active state.
- hidden selected conversation increments unread rather than being treated as immediately viewed.
- server read event still clears unread.

### Component Tests

`ConversationMessageState.vue`:

- loading copy.
- empty copy only after loaded.
- error copy and retry emission.

`MessageStatusIndicator.vue`:

- every transient/error local status.
- read state only when `showReadState` is true.
- retry emission.

### Composable Tests

`useAttachmentIngress.ts`:

- text-only paste is not prevented.
- one pasted image is staged.
- one dropped file is staged.
- multiple files rejected.
- >50 MB rejected.
- staging never triggers upload itself.

`useConversationScrollMemory.ts`:

- anchors isolated by contact.
- overwrite one contact without changing another.
- clear one / clear all.

`useChatScroll.ts` additions:

- capture/restore anchor contract.
- load-more error state and retry.
- hidden document does not send read receipt.

### Page Integration Tests

Desktop:

- loading is not rendered as empty conversation.
- failed initial load exposes retry.
- earlier failed outgoing message still has its own retry action.
- pasted/dropped file reaches the existing attachment confirmation dialog.
- switching A -> B -> A restores A's remembered anchor when available.

Mobile:

- initial loading/error behavior matches desktop.
- leaving a chat remembers its anchor.
- existing history-backed Back/overlay semantics remain intact.

## Acceptance Criteria

1. Slow initial history requests never show `开始聊天吧` before the request completes.
2. Initial history failures have a visible retry path.
3. Load-more failure is visible and retryable without jumping the list.
4. Any outgoing local message in `uploading`, `queued`, `sending`, or `failed` state shows its own state row.
5. A failed non-last outgoing message can be retried directly from that message.
6. Desktop users can paste a screenshot/file or drag one file into chat and reach the same attachment confirmation dialog as the `＋` picker.
7. Multiple pasted/dropped files are rejected explicitly; no file is silently ignored.
8. No paste/drop path uploads before explicit confirmation.
9. Switching away from an older reading position and back restores that position when its anchor exists in the loaded first page.
10. Hidden tabs do not send read receipts merely because the conversation is selected.
11. Hidden-tab incoming messages can still contribute to in-app unread badges until a read event clears them.
12. The disguise browser title remains unchanged and never contains chat-specific unread information.
13. Existing reconnect, optimistic send/retry, authorized media URLs, virtual scrolling, mobile history, attachment confirmation, safe-area, and iOS viewport behavior continue to pass their existing tests.

## Trade-offs

### Scroll memory only restores anchors present in the first loaded page

Automatically paginating backward until a remembered old anchor is found would be more magical but can cause unpredictable network cost and long waits. Session-only best-effort restoration gives most of the UX benefit without creating a hidden fetch loop.

### Confirmed historical messages do not all show permanent delivery metadata

Showing `已发送`/`已读` under every outgoing message would add significant visual noise. The recommended rule gives each transient/failed message its own feedback, then preserves the existing last-self-message read receipt convention after confirmation.

### No browser-title unread count

This intentionally gives up a common chat convenience because this project's disguise/privacy model makes browser-chrome leakage a worse trade-off than the extra notification visibility.