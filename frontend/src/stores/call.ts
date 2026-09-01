import { defineStore } from 'pinia'
import { ref, watch, type WatchStopHandle } from 'vue'
import { getWebRTCIceConfig, getWebRTCStatus } from '../api'
import { useWebRtcCall, type WebRtcPrepareError } from '../composables/useWebRtcCall'
import type {
  CallPhase,
  CallType,
  Contact,
  WsServerMessage,
  WsCallServerMessage,
  WebRTCIceConfig,
} from '../types'
import { useChatStore } from './chat'

const terminalDisplayMs = 1200
const iosAudioDeviceErrorPattern = /No AVAudioSessionCaptureDevice/i

interface PrepareFailureDetails {
  stage: WebRtcPrepareError['stage'] | 'unknown'
  name: string
  message: string
  httpStatus?: number
}

function isCallServerMessage(message: WsServerMessage): message is WsCallServerMessage {
  return message.type.startsWith('call_') || message.type.startsWith('webrtc_')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function readHttpStatus(error: unknown) {
  const response = asRecord(asRecord(error)?.response)
  return typeof response?.status === 'number' ? response.status : undefined
}

function getPrepareFailureDetails(error: unknown): PrepareFailureDetails {
  const wrapper = asRecord(error)
  const stage = wrapper?.stage === 'media' || wrapper?.stage === 'ice-config'
    ? wrapper.stage
    : 'unknown'
  const originalError = 'originalError' in (wrapper ?? {})
    ? wrapper?.originalError
    : error
  const original = asRecord(originalError)
  const name = typeof original?.name === 'string'
    ? original.name
    : originalError instanceof Error
      ? originalError.name
      : 'UnknownError'
  const message = typeof original?.message === 'string'
    ? original.message
    : originalError instanceof Error
      ? originalError.message
      : String(originalError ?? '')

  return {
    stage,
    name,
    message,
    httpStatus: readHttpStatus(originalError),
  }
}

function prepareFailureMessage(error: unknown, kind: CallType) {
  const details = getPrepareFailureDetails(error)
  const video = kind === 'video'

  if (details.stage === 'ice-config') {
    if (details.httpStatus === 401 || details.httpStatus === 403) {
      return '登录状态已失效，请重新进入'
    }
    if (details.httpStatus === 503) {
      return '通话服务暂不可用'
    }
    return '无法获取通话配置，请检查网络后重试'
  }

  if (iosAudioDeviceErrorPattern.test(details.message)) {
    return 'iOS 麦克风服务异常，请完全关闭 Safari 后重新打开'
  }

  switch (details.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return video
        ? '摄像头或麦克风权限未授权，请在浏览器网站设置中允许访问'
        : '麦克风权限未授权，请在浏览器网站设置中允许麦克风'
    case 'NotFoundError':
      return video ? '未检测到可用摄像头或麦克风' : '未检测到可用麦克风'
    case 'NotReadableError':
    case 'AbortError':
      return video
        ? '摄像头或麦克风暂时不可用，请关闭占用设备的应用后重试'
        : '麦克风暂时不可用，请关闭占用麦克风的应用后重试'
    case 'TypeError':
      return typeof window !== 'undefined' && !window.isSecureContext
        ? (video ? '当前页面无法访问摄像头和麦克风，请使用 HTTPS 打开' : '当前页面无法访问麦克风，请使用 HTTPS 打开')
        : (video ? '浏览器无法初始化摄像头或麦克风' : '浏览器无法初始化麦克风')
    default:
      return details.stage === 'media'
        ? (video ? '摄像头或麦克风初始化失败，请重试' : '麦克风初始化失败，请重试')
        : '通话初始化失败，请重试'
  }
}

function logPrepareFailure(direction: 'outgoing' | 'incoming', error: unknown, kind: CallType) {
  const details = getPrepareFailureDetails(error)
  console.error('[voice-call] preparation failed', {
    direction,
    callType: kind,
    stage: details.stage,
    name: details.name,
    message: details.message,
    httpStatus: details.httpStatus,
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  })
}

export const useCallStore = defineStore('call', () => {
  const available = ref(false)
  const phase = ref<CallPhase>('idle')
  const callType = ref<CallType>('audio')
  const callId = ref<string | null>(null)
  const peerUserId = ref<number | null>(null)
  const peerName = ref('')
  const muted = ref(false)
  const cameraOff = ref(false)
  const connectedAt = ref<number | null>(null)
  const durationSeconds = ref(0)
  const error = ref('')
  const localStream = ref<MediaStream | null>(null)
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
      onLocalStream: (stream) => {
        localStream.value = stream
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
    cameraOff.value = false
    connectedAt.value = null
    durationSeconds.value = 0
    localStream.value = null
    remoteStream.value = null
  }

  function resetToIdle() {
    clearResetTimer()
    outgoingPrepareSeq += 1
    preparingOutgoing = false
    cleanupLocal()
    phase.value = 'idle'
    callType.value = 'audio'
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

  async function startCall(contact: Contact, kind: CallType = 'audio') {
    ensureBound()
    if (phase.value !== 'idle' || preparingOutgoing) return
    const chat = useChatStore()
    if (!chat.wsConnected || chat.wsStatus !== 'connected') {
      error.value = '网络未连接'
      return
    }

    clearResetTimer()
    error.value = ''
    callType.value = kind
    peerUserId.value = contact.userId
    peerName.value = contact.nickname
    phase.value = 'preparing'
    preparingOutgoing = true
    const prepareSeq = ++outgoingPrepareSeq

    try {
      await rtc.prepare(kind)
    } catch (prepareError) {
      if (prepareSeq !== outgoingPrepareSeq) return
      preparingOutgoing = false
      logPrepareFailure('outgoing', prepareError, kind)
      finish('failed', prepareFailureMessage(prepareError, kind))
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
      data: { receiverId: contact.userId, callType: kind },
    })
  }

  async function acceptCall() {
    ensureBound()
    if (phase.value !== 'incoming' || !callId.value) return
    const activeCallId = callId.value
    const kind = callType.value
    try {
      await rtc.prepare(kind)
    } catch (prepareError) {
      logPrepareFailure('incoming', prepareError, kind)
      useChatStore().sendWsMessage({
        type: 'call_reject',
        data: { callId: activeCallId, reason: 'media_unavailable' },
      })
      finish('failed', prepareFailureMessage(prepareError, kind))
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

  function toggleCamera() {
    if (callType.value !== 'video') return
    if (phase.value !== 'connected' && phase.value !== 'connecting') return
    cameraOff.value = !cameraOff.value
    rtc.setVideoEnabled(!cameraOff.value)
  }

  async function switchCamera() {
    if (callType.value !== 'video') return
    if (phase.value !== 'connected' && phase.value !== 'connecting') return
    try {
      await rtc.switchCamera()
    } catch (switchError) {
      console.error('[video-call] switch camera failed', switchError)
      error.value = '切换摄像头失败'
    }
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
        callType.value = message.data.callType
        peerUserId.value = message.data.callerId
        peerName.value = resolvePeerName(message.data.callerId)
        phase.value = 'incoming'
        return
      }
      case 'call_ringing': {
        if (peerUserId.value !== message.data.userId) return
        callId.value = message.data.callId
        callType.value = message.data.callType
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
        callType.value = message.data.callType
        phase.value = 'connecting'
        void rtc.startCaller().catch(handleAsyncFailure)
        return
      case 'call_rejected':
        if (matchesCall(message.data.callId)) {
          const mediaUnavailable = callType.value === 'video'
            ? '对方摄像头或麦克风不可用'
            : '对方麦克风不可用'
          finish('ended', message.data.reason === 'media_unavailable' ? mediaUnavailable : '对方已拒绝')
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
    callType,
    callId,
    peerUserId,
    peerName,
    muted,
    cameraOff,
    connectedAt,
    durationSeconds,
    error,
    localStream,
    remoteStream,
    ensureBound,
    checkAvailability,
    startCall,
    acceptCall,
    rejectCall,
    cancelCall,
    hangup,
    toggleMute,
    toggleCamera,
    switchCamera,
    cleanupLocal,
    resetToIdle,
    handleServerMessage,
    dispose,
  }
})
