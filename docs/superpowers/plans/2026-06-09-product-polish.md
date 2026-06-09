# Product Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the third-stage product polish for contact list, read-status display, media cards, cover-page realism, and auth/kicked safety notices.

**Architecture:** Split by file so work can run concurrently. Keep changes frontend-only except no backend changes; use existing Pinia/API/router patterns and avoid new dependencies.

**Tech Stack:** Vue 3 + TypeScript + Pinia + Element Plus + existing CSS.

---

## File Tasks

### Task 1: Contact list polish

**Files:**
- Modify: `frontend/src/components/ContactList.vue`

- [ ] Sort filtered contacts by unread first, then last message time.
- [ ] Highlight matched nickname text during search.
- [ ] Show compact online/offline text near name.
- [ ] Confirm before emitting logout.
- [ ] Improve empty/search text.

### Task 2: Read status and media card polish

**Files:**
- Modify: `frontend/src/views/ChatPage.vue`
- Modify: `frontend/src/views/MobileChat.vue`

- [ ] Show read/send status only on the latest self-sent message.
- [ ] Add fallback card for local uploading/pending file/image/video messages with no `fileUrl`.
- [ ] Keep existing image/video/file behavior for confirmed media.
- [ ] Ensure retry still works through `MessageStatusIndicator`.

### Task 3: Media preview polish

**Files:**
- Modify: `frontend/src/components/MediaPreview.vue`

- [ ] Add image error state and display “图片加载失败”.
- [ ] Add visible close button.
- [ ] Reset loaded/error state on open/URL/type change.

### Task 4: Cover page and auth safety notices

**Files:**
- Modify: `frontend/src/views/CoverPage.vue`
- Modify: `frontend/src/api/index.ts`
- Modify: `frontend/src/stores/chat.ts`

- [ ] API 401 should set a short sessionStorage notice before redirecting to `/`.
- [ ] WebSocket kicked should set a short sessionStorage notice before clearing state/redirecting.
- [ ] Cover page reads and displays one notice banner, then clears it.
- [ ] Make cover content slightly more natural by randomizing heat/time/order on mount while preserving 3-click hidden entry.

## Verification

- [ ] Run `cd frontend && npm run build`.
- [ ] Run `git diff --check`.
- [ ] Run quick blocking review over changed polish files.

## Self-Review

- Covers contact list, read-status simplification, media cards, media preview, cover page, and safety notices.
- Does not add dependencies or change backend protocol.
