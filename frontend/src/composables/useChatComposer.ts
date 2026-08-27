import { computed, nextTick, type Ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useChatDrafts } from './useChatDrafts'

type ChatScrollController = {
  scrollToBottomAndClear: (smooth?: boolean) => void
}

export function useChatComposer(options: {
  inputEl: Ref<HTMLTextAreaElement | null>
  emojiOpen: Ref<boolean>
  maxHeight: number
  scroll: ChatScrollController
  closeEmoji?: () => void
}) {
  const chatStore = useChatStore()
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

  function grow() {
    const input = options.inputEl.value
    if (!input) return

    input.style.height = 'auto'
    const borderHeight = input.offsetHeight - input.clientHeight
    const contentHeight = input.scrollHeight + borderHeight
    input.style.height = Math.min(contentHeight, options.maxHeight) + 'px'
    input.style.overflowY = contentHeight > options.maxHeight ? 'auto' : 'hidden'
  }

  function addEmoji(emoji: string) {
    text.value += emoji
    options.inputEl.value?.focus()
    nextTick(grow)
  }

  async function send() {
    const contactId = chatStore.currentContact?.userId
    const value = text.value.trim()
    if (!contactId || !value) return

    if (options.closeEmoji) options.closeEmoji()
    else options.emojiOpen.value = false

    const isEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u.test(value)
    chatStore.sendMessage(value, isEmoji ? 4 : 1)
    drafts.clear(contactId)

    await nextTick()
    if (options.inputEl.value) options.inputEl.value.style.height = 'auto'
    options.scroll.scrollToBottomAndClear(true)
  }

  return {
    drafts,
    text,
    grow,
    addEmoji,
    send,
  }
}
