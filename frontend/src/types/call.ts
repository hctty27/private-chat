export type CallPhase =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'failed'

export type CallEndReason = 'hangup' | 'failed' | 'disconnected'
export type CallRejectReason = 'rejected' | 'media_unavailable'

export interface WebRTCStatus {
  enabled: boolean
}

export interface WebRTCIceConfig {
  iceServers: RTCIceServer[]
  iceTransportPolicy: RTCIceTransportPolicy
}

export interface WsCallRinging {
  type: 'call_ringing'
  data: { callId: string; userId: number }
}

export interface WsCallIncoming {
  type: 'call_incoming'
  data: { callId: string; callerId: number }
}

export interface WsCallUnavailable {
  type: 'call_unavailable'
  data: { userId: number; reason: 'offline' }
}

export interface WsCallBusy {
  type: 'call_busy'
  data: { userId: number }
}

export interface WsCallAccepted {
  type: 'call_accepted'
  data: { callId: string }
}

export interface WsCallRejected {
  type: 'call_rejected'
  data: { callId: string; reason?: CallRejectReason }
}

export interface WsCallCancelled {
  type: 'call_cancelled'
  data: { callId: string }
}

export interface WsCallTimeout {
  type: 'call_timeout'
  data: { callId: string }
}

export interface WsCallEnded {
  type: 'call_ended'
  data: { callId: string; reason: CallEndReason }
}

export interface WsWebRTCOffer {
  type: 'webrtc_offer'
  data: { callId: string; sdp: RTCSessionDescriptionInit }
}

export interface WsWebRTCAnswer {
  type: 'webrtc_answer'
  data: { callId: string; sdp: RTCSessionDescriptionInit }
}

export interface WsWebRTCIce {
  type: 'webrtc_ice'
  data: { callId: string; candidate: RTCIceCandidateInit }
}

export type WsCallServerMessage =
  | WsCallRinging
  | WsCallIncoming
  | WsCallUnavailable
  | WsCallBusy
  | WsCallAccepted
  | WsCallRejected
  | WsCallCancelled
  | WsCallTimeout
  | WsCallEnded
  | WsWebRTCOffer
  | WsWebRTCAnswer
  | WsWebRTCIce

export interface WsCallInvite {
  type: 'call_invite'
  data: { receiverId: number }
}

export interface WsCallAccept {
  type: 'call_accept'
  data: { callId: string }
}

export interface WsCallReject {
  type: 'call_reject'
  data: { callId: string; reason?: CallRejectReason }
}

export interface WsCallCancel {
  type: 'call_cancel'
  data: { callId: string }
}

export interface WsCallHangup {
  type: 'call_hangup'
  data: { callId: string; reason?: 'hangup' | 'failed' }
}

export interface WsWebRTCOfferClient {
  type: 'webrtc_offer'
  data: { callId: string; sdp: RTCSessionDescriptionInit }
}

export interface WsWebRTCAnswerClient {
  type: 'webrtc_answer'
  data: { callId: string; sdp: RTCSessionDescriptionInit }
}

export interface WsWebRTCIceClient {
  type: 'webrtc_ice'
  data: { callId: string; candidate: RTCIceCandidateInit }
}

export type WsCallClientMessage =
  | WsCallInvite
  | WsCallAccept
  | WsCallReject
  | WsCallCancel
  | WsCallHangup
  | WsWebRTCOfferClient
  | WsWebRTCAnswerClient
  | WsWebRTCIceClient
