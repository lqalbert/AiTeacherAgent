import {
  cleanSubtitleDisplay,
  isProgressiveUtterance,
  pickProgressiveText,
  stripSubtitlePunctuation,
} from './subtitleText.js'
import { extractSpeakerTexts } from './speakerText.js'

/**
 * 讯飞大模型实时字幕推送：
 * - 中间结果仅 interim 上屏（可改写）
 * - 真正 final / 分片切换 / flush 才落库
 * - 同一句递进结果修订上一段，避免重复
 */
export function createRtasrLlmLiveEmitter({ sendLive, onStoreText, roleSeparation = false }) {
  /** @type {Record<number, { id: number, text: string }>} */
  const activeSegBySpeaker = {}
  /** @type {Record<number, string>} */
  const lastStoredBySpeaker = {}
  /** @type {Record<number, string>} */
  const lastLiveBySpeaker = {}
  /** @type {Record<number, string>} */
  const lastStoredRawBySpeaker = {}
  let currentSpeaker = 1

  function reset() {
    for (const key of Object.keys(activeSegBySpeaker)) delete activeSegBySpeaker[key]
    for (const key of Object.keys(lastStoredBySpeaker)) delete lastStoredBySpeaker[key]
    for (const key of Object.keys(lastLiveBySpeaker)) delete lastLiveBySpeaker[key]
    for (const key of Object.keys(lastStoredRawBySpeaker)) delete lastStoredRawBySpeaker[key]
    currentSpeaker = 1
  }

  function emitLive(speaker, text, stable) {
    const raw = String(text || '').trim()
    if (!raw) return
    const display = cleanSubtitleDisplay(raw)
    if (!display) return

    const key = speaker > 0 ? speaker : 0
    // 中间结果相同可跳过；最终结果即使文案相同也要通知客户端（用于触发上屏）
    if (!stable && lastLiveBySpeaker[key] === display) return
    lastLiveBySpeaker[key] = display

    const spk = speaker > 0 ? speaker : undefined
    sendLive({ text: display, stable, speaker: spk, raw })
  }

  function emitStable(speaker, text) {
    const raw = String(text || '').trim()
    if (!raw) return
    const display = cleanSubtitleDisplay(raw)
    if (!display) return

    const key = speaker > 0 ? speaker : 0
    const spk = speaker > 0 ? speaker : undefined
    const prevDisplay = lastStoredBySpeaker[key] || ''

    if (prevDisplay && isProgressiveUtterance(prevDisplay, display)) {
      const mergedDisplay = pickProgressiveText(prevDisplay, display)
      const useNew =
        mergedDisplay === display ||
        stripSubtitlePunctuation(display).length >= stripSubtitlePunctuation(prevDisplay).length
      const mergedRaw = useNew ? raw : lastStoredRawBySpeaker[key] || raw
      lastStoredBySpeaker[key] = mergedDisplay
      lastStoredRawBySpeaker[key] = mergedRaw
      emitLive(speaker, mergedRaw, true)
      if (mergedDisplay !== prevDisplay) {
        onStoreText(spk ? `[说话人${spk}] ${mergedRaw}` : mergedRaw, { revise: true })
      }
      return
    }

    if (prevDisplay && display === prevDisplay) {
      emitLive(speaker, raw, true)
      return
    }

    lastStoredBySpeaker[key] = display
    lastStoredRawBySpeaker[key] = raw
    emitLive(speaker, raw, true)
    onStoreText(spk ? `[说话人${spk}] ${raw}` : raw, { revise: false })
  }

  function adoptSpeakerSeg(speaker, segId, text) {
    const piece = String(text || '').trim()
    if (!piece) return

    const prev = activeSegBySpeaker[speaker]
    if (prev && segId !== prev.id && prev.text.trim()) {
      // 新分片仍是同一句递进：合并，不要半句先落库
      if (isProgressiveUtterance(prev.text, piece)) {
        const useNew =
          cleanSubtitleDisplay(piece).length >= cleanSubtitleDisplay(prev.text).length
        activeSegBySpeaker[speaker] = { id: segId, text: useNew ? piece : prev.text }
        return
      }
      emitStable(speaker, prev.text)
    }

    if (!prev || segId !== prev.id) {
      activeSegBySpeaker[speaker] = { id: segId, text: piece }
      return
    }

    activeSegBySpeaker[speaker].text = piece
  }

  function resolveSpeakerSegments(parsed) {
    if (!roleSeparation || !parsed.hasRoleSeparation) {
      return [{ speaker: 0, text: parsed.text }]
    }

    const st = parsed.data?.cn?.st
    if (!st) {
      return parsed.speakerSegments?.length
        ? parsed.speakerSegments
        : [{ speaker: 0, text: parsed.text }]
    }

    const { segments, lastSpeaker } = extractSpeakerTexts(st, currentSpeaker)
    currentSpeaker = lastSpeaker
    return segments.length ? segments : [{ speaker: 0, text: parsed.text }]
  }

  return {
    reset,
    flush: () => {
      for (const [speaker, seg] of Object.entries(activeSegBySpeaker)) {
        if (seg.text.trim()) emitStable(Number(speaker), seg.text)
      }
      reset()
    },
    handleResult(parsed) {
      if (!parsed?.text) return

      const segId = parsed.segId ?? parsed.data?.seg_id ?? 0
      const ls = Boolean(parsed.ls ?? parsed.data?.ls)
      const isFinal = Boolean(parsed.isFinal)
      const segments = resolveSpeakerSegments(parsed)

      for (const { speaker, text } of segments) {
        const spk = speaker > 0 ? speaker : 0
        adoptSpeakerSeg(spk, segId, text)
        const current = activeSegBySpeaker[spk]?.text
        if (!current) continue

        if (isFinal) {
          emitStable(spk, current)
          // final 后清掉 active，后续新句用新行
          delete activeSegBySpeaker[spk]
        } else {
          emitLive(spk, current, false)
        }
      }

      if (ls) {
        for (const [speaker, seg] of Object.entries(activeSegBySpeaker)) {
          if (seg.text.trim()) emitStable(Number(speaker), seg.text)
        }
        reset()
      }
    },
  }
}
