# Chat Interaction Polish Design

Date: 2026-08-11
Status: Approved design, pending written-spec review
Scope: Frontend interaction refinement for desktop and mobile chat

## 1. Goal

Improve the existing private-chat experience without introducing new message-domain features or backend protocol changes. The work should reduce accidental sends, preserve user context while switching contacts, make mobile navigation behave more like a native chat application, and make frequent controls easier to operate.

The design intentionally builds on the existing chat reliability work: virtualized message rendering, reconnect notices, pending-message status, retry, unread counts, history loading, media preview, and R2-backed attachment delivery remain the foundation.

## 2. Product principles

1. **Prevent costly mistakes before optimizing for speed.** Attachment sending must clearly show the intended recipient before upload/send starts.
2. **Keep routine text messaging fast.** Plain text continues to send directly; no confirmation dialog is added.
3. **Prefer session-only state for sensitive drafts.** Unsent drafts are kept in memory and disappear when the application session ends.
4. **Make mobile browser navigation predictable.** System/browser Back should unwind the current chat UI before leaving the application.
5. **Keep the first iteration narrow.** Do not add recall, delete, quote, forward, multi-file batching, or backend message mutations in this phase.

## 3. Current constraints

- Desktop chat is implemented in `frontend/src/views/ChatPage.vue`.
- Mobile chat is implemented in `frontend/src/views/MobileChat.vue`.
- Contacts are rendered by `frontend/src/components/ContactList.vue`.
- Message rendering already supports text, emoji, image, video, file, pending upload state, read state, and retry.
- Mobile chat already handles `visualViewport` changes for the soft keyboard.
- New attachments are uploaded to R2 through the existing secure file lifecycle; this design must not bypass that lifecycle.

## 4. Scope

### 4.1 In scope

- Per-contact text drafts.
- Attachment preview and explicit recipient confirmation before upload.
- Mobile History API integration for chat and transient overlays.
- Context actions for existing messages.
- Shared touch-target and pressed/disabled interaction rules.
- Focused unit/component tests for the new interaction state.

### 4.2 Out of scope

- Message recall or deletion.
- Quoting/replying to a message.
- Forwarding.
- Editing sent messages.
- Multi-file selection/batching.
- Persistent draft storage in `localStorage`, IndexedDB, or the backend.
- Backend schema/API changes.
- Push notifications.
- Redesign of the disguise/cover/login flow.

## 5. Component boundaries

The implementation should avoid adding more state directly to the already-large desktop/mobile page components. The interaction features should be isolated behind small units with explicit responsibilities.

### 5.1 `useChatDrafts`

Responsibility: keep one in-memory text draft per contact.

Suggested API:

```ts
interface ChatDrafts {
  get(contactId: number): string
  set(contactId: number, value: string): void
  clear(contactId: number): void
  clearAll(): void
}
```

Rules:

- The active textarea reads/writes the draft for `currentContact.userId`.
- Switching contacts must never carry text into another contact.
- Successful text send clears only the active contact's draft.
- Failed send does not need to restore the draft because the existing optimistic message/retry model becomes the source of truth after send is initiated.
- Logout/application teardown clears all drafts.
- Drafts are intentionally not persisted between page reloads.

### 5.2 `AttachmentSendDialog`

Responsibility: stage a selected attachment and obtain explicit confirmation before calling the existing upload/send path.

Inputs should include at minimum:

- selected `File`
- recipient nickname
- recipient id
- detected presentation type (`image`, `video`, `file`) based on existing client-side file classification rules

Displayed information:

- image preview when safe/available
- video/file icon or lightweight preview for other types
- file name
- formatted file size
- `发送给：<nickname>`
- Cancel and Send actions

Rules:

- Selecting a file does **not** start R2 upload.
- Cancel releases temporary preview object URLs and resets the file input.
- Confirm re-validates that the current contact still matches the staged recipient id. If not, abort with a clear warning rather than sending to a different contact.
- File-size validation remains before confirmation so obviously invalid files fail early.
- Once confirmed, the existing secure `sendFile` lifecycle is used unchanged.
- While upload/send is in progress, the confirmation action is disabled to prevent duplicate sends.

### 5.3 `useMobileChatHistory`

Responsibility: make browser/system Back unwind mobile chat UI deterministically.

State model:

```text
list
  -> chat(contactId)
       -> overlay(kind)
```

Supported overlay kinds in this phase:

- media preview
- emoji panel
- attachment confirmation

Rules:

1. The list view is the baseline entry.
2. Opening a contact pushes exactly one `chat` history entry.
3. Opening a supported overlay from chat pushes at most one `overlay` entry.
4. Closing an overlay through its visible close/cancel action should consume that overlay entry instead of leaving stale history behind.
5. Browser/system Back from an overlay closes the overlay and returns to chat.
6. Back from chat returns to the contact list.
7. Back from the contact list is not intercepted; the browser resumes its normal behavior.
8. Repeated open/close operations must not produce unbounded duplicate entries. The controller owns all `pushState`, `replaceState`, and `popstate` handling.
9. Programmatic UI state changes caused by `popstate` must not recursively create new history entries.

Desktop does not adopt this History model in this phase.

### 5.4 `MessageActionMenu`

Responsibility: expose a small action set without adding new backend semantics.

Invocation:

- Desktop: right-click / `contextmenu` on a message.
- Mobile: long press on a message, with movement cancellation so normal scrolling does not accidentally open the menu.

Action matrix:

| Message state/type | Actions |
|---|---|
| Text | Copy |
| Emoji | Copy |
| Image | View, Save |
| Video | Open/View, Save when browser-supported |
| File | Open, Save |
| Failed text message | Retry, Copy |
| Failed attachment message | Retry |

Rules:

- Do not show actions that cannot succeed for the specific message.
- Native context-menu suppression should be limited to messages where the custom menu is actually used.
- Clipboard failure must surface a small non-blocking error instead of silently failing.
- Save/open actions must continue to use the existing authorized same-origin file endpoint; no presigned URL is persisted or exposed by this feature.
- The menu closes on outside click/tap, Escape, route/contact change, and successful action.

### 5.5 Shared interaction sizing

Create a small shared interaction rule/token instead of independently sizing each button.

Target behavior:

- Primary mobile controls should expose an effective hit area of approximately 44 x 44 CSS px where layout permits.
- Visible glyphs may remain smaller; hit-area size and icon size are separate concerns.
- No authored pointer target should fall below WCAG 2.2 AA requirements without satisfying the documented spacing/equivalent-control exception.
- Buttons must have visible pressed, disabled, and keyboard-focus states.
- Existing safe-area handling must continue to work on iOS.

Candidate controls:

- mobile Back
- emoji toggle
- attachment button
- send button
- preview/dialog close
- new-message button
- message-menu items
- logout control where layout permits

## 6. Interaction flows

### 6.1 Contact switch with drafts

```text
Alice selected
  -> user types "晚上几点？"
  -> draft[Alice] updated
  -> user returns/selects Bob
  -> Bob textarea reads draft[Bob]
  -> Alice draft remains untouched
  -> user returns to Alice
  -> "晚上几点？" is restored
```

A draft is cleared only after a send is initiated successfully for that contact or the chat state is explicitly cleared/logout occurs.

### 6.2 Attachment send

```text
Choose file
  -> validate size/type needed for presentation
  -> stage file locally
  -> show recipient + preview dialog
      -> Cancel: cleanup, no upload
      -> Send: verify same recipient
          -> call existing upload/send flow
          -> show existing progress/message status
```

This prevents accidental selection from immediately producing a remote upload or message.

### 6.3 Mobile Back

```text
Contact list
  -> open Alice
Chat(Alice)
  -> open image
Overlay(media)

Back #1 -> close media, remain in Chat(Alice)
Back #2 -> contact list
Back #3 -> normal browser history
```

Emoji and attachment confirmation follow the same overlay rule.

### 6.4 Message long press

```text
pointer/touch down
  -> start long-press timer
  -> movement beyond threshold OR pointer up early: cancel
  -> threshold reached: open action menu
```

Scrolling must win over long-press when meaningful pointer movement occurs.

## 7. Error handling

- **Recipient changed during attachment confirmation:** cancel the staged send and tell the user to select the file again for the current contact.
- **Object URL creation/preview failure:** still allow file confirmation using metadata-only presentation.
- **Clipboard unavailable/fails:** show a non-blocking copy failure notice.
- **History state missing or externally modified:** fall back to local UI close behavior; never trap the user in the page.
- **Upload failure after confirmation:** reuse the existing message status/retry mechanism; do not reopen the confirmation dialog automatically.
- **Unsupported download behavior on iOS:** preserve the current safe open behavior instead of forcing a desktop-only download mechanism.

## 8. Accessibility and browser behavior

- Use semantic `button` elements for interactive controls.
- Preserve visible keyboard focus on desktop.
- Message actions exposed through right-click must also remain reachable through normal focus/activation where practical; the first iteration may provide an explicit overflow/action trigger if keyboard-only access cannot otherwise reach the menu.
- Dialogs must keep focus inside while open and restore focus to the invoking control when closed.
- Overlay close/cancel must remain available without drag gestures.

External guidance used for this design:

- MDN History `pushState()` documents that it creates session-history entries and associates serializable state consumed by `popstate`: https://developer.mozilla.org/en-US/docs/Web/API/History/pushState
- WCAG 2.2 Success Criterion 2.5.8 defines a 24 x 24 CSS px minimum target size at Level AA, with documented exceptions: https://www.w3.org/TR/WCAG22/#target-size-minimum
- Apple UI guidance recommends hit targets of at least 44 x 44 points for touch controls: https://developer.apple.com/design/tips/

## 9. Testing strategy

### 9.1 Drafts

- draft is isolated by contact id
- switching contacts restores the correct value
- sending clears only the active draft
- logout/clear removes all drafts

### 9.2 Attachment confirmation

- file selection does not call upload before confirmation
- cancel never uploads
- confirm uploads exactly once
- recipient mismatch blocks send
- preview object URL is released on cancel/close/unmount
- oversized files still fail before staging

### 9.3 Mobile history

- opening chat adds one chat entry
- Back from chat returns to list
- opening one overlay adds one overlay entry
- Back closes overlay before chat
- visible close/cancel does not leave a stale overlay entry
- repeated overlay operations do not grow duplicate state unexpectedly
- popstate-driven transitions do not recursively push history

### 9.4 Message actions

- right-click opens correct desktop actions
- long press opens on mobile
- movement cancels long press
- Copy copies correct content
- failed messages expose Retry only where supported
- menu closes on outside interaction/contact change/Escape

### 9.5 Interaction sizing

- key mobile controls have the intended hit-area dimensions
- disabled controls cannot be activated
- focus-visible styling remains present for keyboard users

## 10. Implementation order

1. Extract/add `useChatDrafts` and wire desktop/mobile text input.
2. Add `AttachmentSendDialog` and stage-before-upload flow.
3. Add `useMobileChatHistory` and integrate chat/overlay navigation.
4. Add `MessageActionMenu` with desktop and mobile invocation.
5. Normalize touch targets, pressed states, disabled states, and focus styling.
6. Run frontend build plus focused tests/manual mobile regression checks.

Each step should be independently testable and should not require backend changes.

## 11. Acceptance criteria

The phase is complete when all of the following are true:

- Unsent text never appears in the wrong contact after switching conversations.
- Selecting an attachment never uploads or sends it before the user confirms the recipient.
- On mobile, Back closes a transient chat overlay first, then leaves the chat for the contact list, then returns control to normal browser history.
- Text/media/file messages expose only the small approved action set; no recall/delete/quote/forward behavior is introduced.
- Frequent mobile controls are reliably tappable and provide visible interaction feedback.
- Existing reconnect, optimistic-send/retry, read-state, virtual scrolling, media authorization, and R2 upload behavior remain intact.
- Frontend build and targeted interaction tests pass.
