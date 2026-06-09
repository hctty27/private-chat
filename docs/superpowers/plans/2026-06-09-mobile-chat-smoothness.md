# Mobile Chat Smoothness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve mobile chat input smoothness: keyboard viewport fit, emoji panel behavior, tap-to-collapse input, and clearer composer state.

**Architecture:** Keep changes focused in `MobileChat.vue`; reuse existing `useChatScroll()` APIs. Use `visualViewport` to size the chat page while the keyboard is open, and gate auto-scroll so focusing the composer does not interrupt users reading history.

**Tech Stack:** Vue 3 + TypeScript + Pinia + existing mobile chat CSS.

---

## File Structure

- Modify: `frontend/src/views/MobileChat.vue`
  - Owns mobile-only keyboard, emoji, composer and tap-to-collapse behavior.
- Validate: `frontend/src/composables/useChatScroll.ts`
  - No code change expected; use existing `isNearBottom()`, `scrollToBottom()`, and `scrollToBottomAndClear()`.

---

## Task 1: visualViewport keyboard sizing

**Files:**
- Modify: `frontend/src/views/MobileChat.vue`

- [ ] Add `viewportHeight`, `inputFocused`, and `chatPageStyle` in script:

```ts
const viewportHeight = ref(0)
const inputFocused = ref(false)
const chatPageStyle = computed(() => viewportHeight.value ? { height: `${viewportHeight.value}px` } : undefined)
let shouldStickToBottomOnViewportChange = false
```

- [ ] Bind style on chat page:

```vue
<div v-else class="chat-page" :style="chatPageStyle">
```

- [ ] Install a `visualViewport` resize/scroll listener on mount and remove it on unmount:

```ts
function updateViewport() {
  viewportHeight.value = window.visualViewport?.height || window.innerHeight
  if (shouldStickToBottomOnViewportChange) {
    requestAnimationFrame(() => scroll.scrollToBottom(false))
  }
}

function installViewportHandler() {
  updateViewport()
  if (!window.visualViewport || vvHandler) return
  vvHandler = updateViewport
  window.visualViewport.addEventListener('resize', vvHandler)
  window.visualViewport.addEventListener('scroll', vvHandler)
}
```

- [ ] Update unmount cleanup to remove both `resize` and `scroll` listeners.

## Task 2: input focus and tap-to-collapse

**Files:**
- Modify: `frontend/src/views/MobileChat.vue`

- [ ] Add `@click="collapseInput"` to `.msg-scroll`.

- [ ] Replace `onFocus()` / `onBlur()` with:

```ts
function onFocus() {
  inputFocused.value = true
  emojiOpen.value = false
  shouldStickToBottomOnViewportChange = scroll.isNearBottom(120)
  updateViewport()
  if (shouldStickToBottomOnViewportChange) {
    setTimeout(() => scroll.scrollToBottom(false), 100)
    setTimeout(() => scroll.scrollToBottom(false), 350)
  }
}

function onBlur() {
  inputFocused.value = false
  shouldStickToBottomOnViewportChange = false
  setTimeout(updateViewport, 80)
}

function collapseInput() {
  emojiOpen.value = false
  inputEl.value?.blur()
  inputFocused.value = false
  shouldStickToBottomOnViewportChange = false
}
```

## Task 3: emoji panel and composer state

**Files:**
- Modify: `frontend/src/views/MobileChat.vue`

- [ ] Replace emoji button click with:

```vue
<button class="ibtn" :class="{ on: emojiOpen }" @click="toggleEmoji">😊</button>
```

- [ ] Add:

```ts
function toggleEmoji() {
  const opening = !emojiOpen.value
  emojiOpen.value = opening
  shouldStickToBottomOnViewportChange = scroll.isNearBottom(160)
  if (opening) {
    inputEl.value?.blur()
    inputFocused.value = false
  }
  nextTick(() => {
    grow()
    if (shouldStickToBottomOnViewportChange) scroll.scrollToBottom(false)
  })
}
```

- [ ] Keep `addEmoji()` focusing textarea and call `grow()` on next tick:

```ts
function addEmoji(e: string) {
  text.value += e
  inputEl.value?.focus()
  nextTick(grow)
}
```

- [ ] Add ready class to send button:

```vue
<button class="sbtn" :class="{ ready: text.trim() }" :disabled="!text.trim()" @click="send">发送</button>
```

## Task 4: CSS polish

**Files:**
- Modify: `frontend/src/views/MobileChat.vue`

- [ ] Ensure these CSS rules exist or are updated:

```css
.chat-page { min-height: 0; }
.msg-scroll { min-height: 0; }
.input-bar { transition: transform 0.16s ease; }
.input-row { align-items: flex-end; }
.sbtn { background: #b8e8c8; }
.sbtn.ready { background: #07c160; }
.sbtn:disabled { background: #ccc; }
```

## Verification

- [ ] Run:

```bash
cd /home/project/private-chat/frontend && npm run build
```

Expected: PASS; existing Vite chunk warning is acceptable.

- [ ] Run:

```bash
git -C /home/project/private-chat diff --check -- frontend/src/views/MobileChat.vue
```

Expected: no output.

## Self-Review

- Covers visualViewport keyboard fit, input focus, emoji panel open/close, tap-to-collapse, long-text grow, and send button state.
- Does not alter backend, desktop chat, message protocol, or first-stage reliability logic.
