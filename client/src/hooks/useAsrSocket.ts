import { useCallback, useEffect, useRef, useState } from 'react'
import { wsAsrUrl } from '../api'

export type AsrStatus = 'idle' | 'sleeping' | 'connecting' | 'connected' | 'error' | 'closed'

type UseAsrOptions = {
  sessionId: number
  /** 是否建立转写 WebSocket（说话时为 true，静音休眠时为 false） */
  enabled: boolean
  slideIndex: number
  onLive: (text: string, stable: boolean, speaker?: number) => void
}

/** 约 4 秒缓冲（40ms/帧），重连时尽量不丢句首 */
const MAX_PENDING_CHUNKS = 100

export function useAsrSocket({ sessionId, enabled, slideIndex, onLive }: UseAsrOptions) {
  const [status, setStatus] = useState<AsrStatus>('idle')
  const [aiPolish, setAiPolish] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorHint, setErrorHint] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAudioRef = useRef<ArrayBuffer[]>([])
  const intentionalCloseRef = useRef(false)
  const enabledRef = useRef(enabled)
  const slideRef = useRef(slideIndex)
  const onLiveRef = useRef(onLive)

  enabledRef.current = enabled
  slideRef.current = slideIndex
  onLiveRef.current = onLive

  const flushPendingAudio = useCallback(() => {
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) return
    const pending = pendingAudioRef.current.splice(0)
    for (const chunk of pending) ws.send(chunk)
  }, [])

  const cleanup = useCallback((keepPending = false) => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (!keepPending) pendingAudioRef.current = []
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    // 重连时保留缓冲音频，避免句首丢失
    cleanup(true)
    if (!enabledRef.current) return

    intentionalCloseRef.current = false
    setStatus('connecting')
    setError(null)
    setErrorHint(null)

    const ws = new WebSocket(wsAsrUrl(sessionId))
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      setError(null)
      setErrorHint(null)
      // 重连后必须立刻同步当前页，否则口述会全部记在旧页/第 1 页
      try {
        ws.send(JSON.stringify({ type: 'slide', slideIndex: slideRef.current }))
      } catch {
        // ignore
      }
      flushPendingAudio()
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'connected') {
          setStatus('connected')
          setError(null)
          setErrorHint(null)
          setAiPolish(Boolean(msg.aiPolish))
        } else if (msg.type === 'live' && msg.text) {
          const speaker =
            typeof msg.speaker === 'number' && msg.speaker > 0 ? msg.speaker : 0
          onLiveRef.current(msg.text, Boolean(msg.stable), speaker)
        } else if (msg.type === 'error') {
          setError(msg.message || '转写错误')
          setErrorHint(msg.hint || null)
          setStatus('error')
        } else if (msg.type === 'xfyun_closed') {
          if (!enabledRef.current || intentionalCloseRef.current) return
          setStatus('connecting')
          reconnectTimer.current = setTimeout(() => connect(), 400)
        }
      } catch {
        // ignore
      }
    }

    ws.onerror = () => {
      setError('WebSocket 连接失败，请确认后端服务已启动（npm run dev）')
      setStatus('error')
    }

    ws.onclose = () => {
      if (!enabledRef.current || intentionalCloseRef.current) {
        setStatus('sleeping')
        return
      }
      setStatus('connecting')
      reconnectTimer.current = setTimeout(() => connect(), 800)
    }
  }, [cleanup, flushPendingAudio, sessionId])

  useEffect(() => {
    if (!enabled) {
      intentionalCloseRef.current = true
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'end' }))
      }
      cleanup()
      setStatus('sleeping')
      return
    }

    intentionalCloseRef.current = false
    connect()
  }, [enabled, connect, cleanup])

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'slide', slideIndex }))
    }
  }, [slideIndex])

  const sendAudio = useCallback((pcm: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(pcm)
      return
    }
    if (enabledRef.current) {
      pendingAudioRef.current.push(pcm)
      if (pendingAudioRef.current.length > MAX_PENDING_CHUNKS) {
        pendingAudioRef.current.shift()
      }
    }
  }, [])

  const stop = useCallback(() => {
    intentionalCloseRef.current = true
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end' }))
    }
    cleanup()
    setStatus('idle')
  }, [cleanup])

  return { status, aiPolish, error, errorHint, sendAudio, stop, reconnect: connect }
}
