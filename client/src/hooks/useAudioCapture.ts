import { useCallback, useEffect, useRef, useState } from 'react'
import {
  pcmRms,
  SILENCE_DISCONNECT_MS,
  SPEECH_RMS_THRESHOLD,
  SPEECH_START_FRAMES,
} from '../utils/voiceActivity'

const TARGET_SAMPLE_RATE = 16000
/** 讯飞推荐：40ms @ 16kHz => 1280 bytes */
const CHUNK_SAMPLES = 640

type Options = {
  /** 检测到用户开始说话 */
  onSpeechStart?: () => void
  /** 静音超过阈值回调（不再用于断连） */
  onSilence?: () => void
  silenceMs?: number
}

function downsample(buffer: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return buffer
  const ratio = inputRate / outputRate
  const newLength = Math.floor(buffer.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = buffer[idx] ?? 0
    const s1 = buffer[idx + 1] ?? s0
    result[i] = s0 + frac * (s1 - s0)
  }
  return result
}

function floatTo16BitPCM(float32: Float32Array) {
  const buffer = new ArrayBuffer(float32.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

export function useAudioCapture(
  enabled: boolean,
  onPcm: (pcm: ArrayBuffer) => void,
  options: Options = {},
) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const bufferRef = useRef<Float32Array>(new Float32Array(0))
  const onPcmRef = useRef(onPcm)
  const optionsRef = useRef(options)
  const voiceActiveRef = useRef(false)
  const speechFramesRef = useRef(0)
  const lastVoiceAtRef = useRef(0)
  const silenceMsRef = useRef(options.silenceMs ?? SILENCE_DISCONNECT_MS)

  onPcmRef.current = onPcm
  optionsRef.current = options
  silenceMsRef.current = options.silenceMs ?? SILENCE_DISCONNECT_MS

  const resetVoiceState = useCallback(() => {
    voiceActiveRef.current = false
    speechFramesRef.current = 0
    lastVoiceAtRef.current = 0
  }, [])

  const stop = useCallback(() => {
    const ctx = ctxRef.current as (AudioContext & { __cleanupResume?: () => void }) | null
    ctx?.__cleanupResume?.()
    processorRef.current?.disconnect()
    processorRef.current = null
    gainRef.current?.disconnect()
    gainRef.current = null
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    bufferRef.current = new Float32Array(0)
    resetVoiceState()
    setActive(false)
  }, [resetVoiceState])

  const handleVoiceLevel = useCallback((level: number) => {
    const now = Date.now()
    const { onSpeechStart, onSilence } = optionsRef.current

    if (level >= SPEECH_RMS_THRESHOLD) {
      speechFramesRef.current += 1
      lastVoiceAtRef.current = now

      if (!voiceActiveRef.current && speechFramesRef.current >= SPEECH_START_FRAMES) {
        voiceActiveRef.current = true
        onSpeechStart?.()
      }
      return
    }

    speechFramesRef.current = 0
    if (!voiceActiveRef.current) return

    if (now - lastVoiceAtRef.current >= silenceMsRef.current) {
      voiceActiveRef.current = false
      onSilence?.()
    }
  }, [])

  const start = useCallback(async () => {
    stop()
    setError(null)
    if (!window.isSecureContext) {
      setError(
        '麦克风需要在 HTTPS 或 localhost 下使用。当前为 HTTP + IP 访问，浏览器会禁用麦克风。请改用 https:// 域名访问本站点。',
      )
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持麦克风，请使用 Chrome / Edge / Safari 最新版')
      return
    }
    try {
      // 必须在用户点击的同步阶段创建并 resume AudioContext。
      // 若放在 await getUserMedia 之后，手势上下文已丢失，常见表现是：
      // 点「开始听课」无字幕，翻页（再次手势）后 AudioContext 才跑起来。
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' })
      ctxRef.current = ctx
      try {
        await ctx.resume()
      } catch {
        // ignore
      }

      const resumeCtx = () => {
        const c = ctxRef.current
        if (c && c.state === 'suspended') {
          c.resume().catch(() => {})
        }
      }
      queueMicrotask(resumeCtx)
      window.setTimeout(resumeCtx, 0)
      window.setTimeout(resumeCtx, 100)

      const onVisibility = () => {
        if (document.visibilityState === 'visible') resumeCtx()
      }
      document.addEventListener('visibilitychange', onVisibility)
      const resumeTimer = window.setInterval(resumeCtx, 2000)
      const onUserGesture = () => resumeCtx()
      window.addEventListener('pointerdown', onUserGesture)
      window.addEventListener('keydown', onUserGesture)
      ;(ctx as AudioContext & { __cleanupResume?: () => void }).__cleanupResume = () => {
        document.removeEventListener('visibilitychange', onVisibility)
        window.clearInterval(resumeTimer)
        window.removeEventListener('pointerdown', onUserGesture)
        window.removeEventListener('keydown', onUserGesture)
      }

      // 关闭 noiseSuppression，减少课堂小声/方言被抹掉；AGC 保留以抬升音量
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      })
      // 若在 await 期间被 stop()，放弃后续接线
      if (ctxRef.current !== ctx) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      resumeCtx()

      const source = ctx.createMediaStreamSource(stream)
      // 静音节点：保持处理图运行，但不回放麦克风（避免啸叫 / 浏览器压麦）
      const silentGain = ctx.createGain()
      silentGain.gain.value = 0
      gainRef.current = silentGain

      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        if (ctx.state === 'suspended') resumeCtx()
        const input = e.inputBuffer.getChannelData(0)
        const down = downsample(input, ctx.sampleRate, TARGET_SAMPLE_RATE)
        handleVoiceLevel(pcmRms(down))

        const prev = bufferRef.current
        const merged = new Float32Array(prev.length + down.length)
        merged.set(prev)
        merged.set(down, prev.length)
        bufferRef.current = merged

        while (bufferRef.current.length >= CHUNK_SAMPLES) {
          const chunk = bufferRef.current.slice(0, CHUNK_SAMPLES)
          bufferRef.current = bufferRef.current.slice(CHUNK_SAMPLES)
          onPcmRef.current(floatTo16BitPCM(chunk))
        }
      }

      source.connect(processor)
      processor.connect(silentGain)
      silentGain.connect(ctx.destination)
      setActive(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法访问麦克风')
      setActive(false)
    }
  }, [stop, handleVoiceLevel])

  // 仅在关闭听课时停麦。不要在 effect 里 start()——会脱离用户点击手势，
  // 导致 AudioContext 挂起（表现为「开始听课后无字幕，翻页后才有」）。
  // 也不要在 enabled:false→true 的 cleanup 里 stop()，否则会掐掉点击里刚启动的麦克风。
  useEffect(() => {
    if (!enabled) stop()
  }, [enabled, stop])

  useEffect(() => () => stop(), [stop])

  return { active, error, start, stop }
}
