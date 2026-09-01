import { defineStore } from 'pinia'
import { ref, watch, type WatchStopHandle } from 'vue'
import { getWebRTCIceConfig, getWebRTCStatus } from '../api'
import { useWebRtcCall } from '../composables/useWebRtcCall'
import type {
  CallPhase,
  Contact,
  WsServerMessage,
  WsCallServerMessage,
  WebRTCIceConfig,
} from '../types'
import { useChatStore } from './chat'

const terminalDisplayMs = 1200

function isCallServerMessage(message: WsServerMessage): message is WsCallServerMessage {
  return message.type.startsWith('call_') || message.type.startsWith('webrtc_')
}

export const useCallStore = defineStore('call', () => {
  const available = ref(false)
  const phase = ref<CallPhase>('idle')
  const callId = ref<string | null>(null)
  const peerUserId = ref<number | null>(null)
  const peerName = ref('')
  const muted = ref(false)
  const connectedAt = ref<number | null>(null)
  const durationSeconds = ref(0)
  const error = ref('')
  const remoteStream = ref<MediaStream | null>(null)

  let cancelPendingInvite = false
  let preparingOutgoing = false
  let outgoingPrepareSeq = 0
  let durationTimer: ReturnType<typeof setInterval> | null = null
  let resetTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribeWs: (() => void) | null = null
  let stopWsWatch: WatchStopHandle | null = null

  const rtc = useWebRtcCall(
    async (): Promise<WebRTCIceConfig> => {
      const response = await getWebRTCIceConfig()
      if (response.data.code !== 200) {
        throw new Error(response.data.message || '获取通话配置失败')
      }
      return response.data.data
    },
    {
      sendOffer: (sdp) => {
        if (!callId.value) return
        useChatStore().sendWsMessage({
          type: 'webrtc_offer',
          data: { callId: callId.value, sdp },
        })
      },
      sendAnswer: (sdp) => {
        if (!callId.value) return
        useChatStore().sendWsMessage({
          type: 'webrtc_answer',
          data: { callId: callId.value, sdp },
        })
      },
      sendIce: (candidate) => {
        if (!callId.value) return
        useChatStore().sendWsMessage({
          type: 'webrtc_ice',
          data: { callId: callId.value, candidate },
        })
      },
      onConnected: () => {
        phase.value = 'connected'
        connectedAt.value = Date.now()
        durationSeconds.value = 0
        startDurationTimer()
      },
      onFailed: () => {
        if (callId.value) {
          useChatStore().sendWsMessage({
            type: 'call_hangup',
            data: { callId: callId.value, reason: 'failed' },
          })
        }
        finish('failed', '通话连接失败')
      },
      onRemoteStream: (stream) => {
        remoteStream.value = stream
      },
    },
  )

  function startDurationTimer() {
    stopDurationTimer()
    durationTimer = setInterval(() => {
      if (!connectedAt.value) return
      durationSeconds.value = Math.max(0, Math.floor((Date.now() - connectedAt.value) / 1000))
    }, 1000)
  }

  function stopDurationTimer() {
    if (durationTimer) clearInterval(durationTimer)
    durationTimer = null
  }

  function clearResetTimer() {
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = null
  }

  function resolvePeerName(userId: number) {
    const contact = useChatStore().contacts.find((item) => item.userId === userId)
    return contact?.nickname || '联系人'
  }

  function cleanupLocal() {
    rtc.cleanup()
    stopDurationTimer()
    muted.value = false
    connectedAt.value = null
    durationSeconds.value = 0
    remoteStream.value = null
  }

  function resetToIdle() {
    clearResetTimer()
    outgoingPrepareSeq += 1
    preparingOutgoing = false
    cleanupLocal()
    phase.value = 'idle'
    callId.value = null
    peerUserId.value = null
    peerName.value = ''
    error.value = ''
    cancelPendingInvite = false
  }

  function finish(target: 'ended' | 'failed', message = '') {
    if (phase.value === 'preparing') outgoingPrepareSeq += 1
    preparingOutgoing = false
    cleanupLocal()
    phase.value = target
    error.value = message
    cancelPendingInvite = false
    clearResetTimer()
    resetTimer = setTimeout(resetToIdle, terminalDisplayMs)
  }

  function ensureBound() {
    if (unsubscribeWs) return
    const chat = useChatStore()
    unsubscribeWs = chat.onWsMessage(handleServerMessage)
    stopWsWatch = watch(
      () => chat.wsStatus,
      (status) => {
        if (status === 'connected') return
        if (phase.value === 'idle' || phase.value === 'ended' || phase.value === 'failed') return
        finish('failed', '网络已断开')
      },
    )
  }

  async function checkAvailability() {
    try {
      const response = await getWebRTCStatus()
      available.value = response.data.code === 200 && response.data.data.enabled
    } catch {
      available.value = false
    }
  }

  async function startCall(contact: Contact) {
    ensureBound()
    if (!available.value || phase.value !== 'idle' || preparingOutgoing) return
    const chat = useChatStore()
    if (!chat.wsConnected || chat.wsStatus !== 'connected') {
      error.value = '网络未连接'
      return
    }

    clearResetTimer()
    error.value = ''
    peerUserId.value = contact.userId
    peerName.value = contact.nickname
    phase.value = 'preparing'
    preparingOutgoing = true
    const prepareSeq = ++outgoingPrepareSeq

    try {
      await rtc.prepare()
    } catch {
      if (prepareSeq !== outgoingPrepareSeq) return
      preparingOutgoing = false
      finish('failed', '无法访问麦克风或通话服务不可用')
      return
    }

    if (
      prepareSeq !== outgoingPrepareSeq ||
      phase.value !== 'preparing' ||
      !chat.wsConnected ||
      chat.wsStatus !== 'connected'
    ) {
      preparingOutgoing = false
      rtc.cleanup()
      if (prepareSeq === outgoingPrepareSeq && phase.value === 'preparing') {
        finish('failed', '网络已断开')
      }
      return
    }

    preparingOutgoing = false
    phase.value = 'outgoing'
    chat.sendWsMessage({
      type: 'call_invite',
      data: { receiverId: contact.userId },
    })
  }

  async function acceptCall() {
    ensureBound()
    if (phase.value !== 'incoming' || !callId.value) return
    const activeCallId = callId.value
    try {
      await rtc.prepare()
    } catch {
      useChatStore().sendWsMessage({
        type: 'call_reject',
        data: { callId: activeCallId, reason: 'media_unavailable' },
      })
      finish('failed', '无法访问麦克风或通话服务不可用')
      return
    }

    if (callId.value !== activeCallId || phase.value !== 'incoming') {
      rtc.cleanup()
      return
    }
    phase.value = 'connecting'
    useChatStore().sendWsMessage({
      type: 'call_accept',
      data: { callId: activeCallId },
    })
  }

  function rejectCall() {
    if (phase.value !== 'incoming' || !callId.value) return
    useChatStore().sendWsMessage({
      type: 'call_reject',
      data: { callId: callId.value, reason: 'rejected' },
    })
    finish('ended')
  }

  function cancelCall() {
    if (phase.value === 'preparing') {
      outgoingPrepareSeq += 1
      preparingOutgoing = false
      finish('ended')
      return
    }
    if (phase.value !== 'outgoing') return
    if (callId.value) {
      useChatStore().sendWsMessage({
        type: 'call_cancel',
        data: { callId: callId.value },
      })
      finish('ended')
      return
    }

    cancelPendingInvite = true
    cleanupLocal()
    phase.value = 'ended'
    clearResetTimer()
    resetTimer = setTimeout(() => {
      if (!cancelPendingInvite) resetToIdle()
    }, terminalDisplayMs)
  }

  function hangup() {
    if (!callId.value || (phase.value !== 'connected' && phase.value !== 'connecting')) return
    useChatStore().sendWsMessage({
      type: 'call_hangup',
      data: { callId: callId.value, reason: 'hangup' },
    })
    finish('ended')
  }

  function toggleMute() {
    if (phase.value !== 'connected' && phase.value !== 'connecting') return
    muted.value = !muted.value
    rtc.setMuted(muted.value)
  }

  function matchesCall(messageCallId: string) {
    return !!callId.value && callId.value === messageCallId
  }

  function handleAsyncFailure() {
    if (callId.value) {
      useChatStore().sendWsMessage({
        type: 'call_hangup',
        data: { callId: callId.value, reason: 'failed' },
      })
    }
    finish('failed', '通话连接失败')
  }

  function handleServerMessage(message: WsServerMessage) {
    if (message.type === 'kicked') {
      if (phase.value !== 'idle') finish('failed', '登录状态已失效')
      return
    }
    if (!isCallServerMessage(message)) return

    switch (message.type) {
      case 'call_incoming': {
        if (preparingOutgoing) {
          useChatStore().sendWsMessage({
            type: 'call_reject',
            data: { callId: message.data.callId, reason: 'rejected' },
          })
          return
        }
        if (phase.value !== 'idle') return
        clearResetTimer()
        error.value = ''
        callId.value = message.data.callId
        peerUserId.value = message.data.callerId
        peerName.value = resolvePeerName(message.data.callerId)
        phase.value = 'incoming'
        return
      }
      case 'call_ringing': {
        if (peerUserId.value !== message.data.userId) return
        callId.value = message.data.callId
        if (cancelPendingInvite) {
          useChatStore().sendWsMessage({
            type: 'call_cancel',
            data: { callId: message.data.callId },
          })
          cancelPendingInvite = false
          finish('ended')
        }
        return
      }
      case 'call_unavailable':
        if (peerUserId.value === message.data.userId) finish('ended', '对方当前不在线')
        return
      case 'call_busy':
        if (peerUserId.value === message.data.userId) finish('ended', '对方正在通话中')
        return
      case 'call_accepted':
        if (!matchesCall(message.data.callId) || phase.value !== 'outgoing') return
        phase.value = 'connecting'
        void rtc.startCaller().catch(handleAsyncFailure)
        return
      case 'call_rejected':
        if (matchesCall(message.data.callId)) {
          finish('ended', message.data.reason === 'media_unavailable' ? '对方麦克风不可用' : '对方已拒绝')
        }
        return
      case 'call_cancelled':
        if (matchesCall(message.data.callId)) finish('ended', '对方已取消')
        return
      case 'call_timeout':
        if (matchesCall(message.data.callId)) finish('ended', '无人接听')
        return
      case 'call_ended':
        if (matchesCall(message.data.callId)) {
          finish(message.data.reason === 'failed' ? 'failed' : 'ended',
            message.data.reason === 'disconnected' ? '对方网络已断开' :
              message.data.reason === 'failed' ? '通话连接失败' : '')
        }
        return
      case 'webrtc_offer':
        if (!matchesCall(message.data.callId) || phase.value !== 'connecting') return
        void rtc.acceptOffer(message.data.sdp).catch(handleAsyncFailure)
        return
      case 'webrtc_answer':
        if (!matchesCall(message.data.callId) || phase.value !== 'connecting') return
        void rtc.applyAnswer(message.data.sdp).catch(handleAsyncFailure)
        return
      case 'webrtc_ice':
        if (!matchesCall(message.data.callId)) return
        void rtc.addRemoteIce(message.data.candidate).catch(handleAsyncFailure)
        return
    }
  }

  function dispose() {
    outgoingPrepareSeq += 1
    preparingOutgoing = false
    unsubscribeWs?.()
    unsubscribeWs = null
    stopWsWatch?.()
    stopWsWatch = null
    resetToIdle()
  }

  return {
    available,
    phase,
    callId,
    peerUserId,
    peerName,
    muted,
    connectedAt,
    durationSeconds,
    error,
    remoteStream,
    ensureBound,
    checkAvailability,
    startCall,
    acceptCall,
    rejectCall,
    cancelCall,
    hangup,
    toggleMute,
    cleanupLocal,
    resetToIdle,
    handleServerMessage,
    dispose,
  }
})
