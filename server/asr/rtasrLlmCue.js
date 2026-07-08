const SENTENCE_END_RE = /[。！？；.!?…]/

/** 从讯飞分段结果生成电影式字幕 cue */
export function createRtasrLlmCueEmitter({ sendCue, onStoreText }) {
  let activeSeg = { id: -1, text: '' }

  function reset() {
    activeSeg = { id: -1, text: '' }
  }

  function mergeSegText(segId, msgText) {
    const piece = String(msgText || '').trim()
    if (!piece) return

    if (segId !== activeSeg.id) {
      flushActiveSeg()
      activeSeg = { id: segId, text: '' }
    }

    if (piece.startsWith(activeSeg.text)) {
      activeSeg.text = piece
    } else if (!activeSeg.text.startsWith(piece)) {
      activeSeg.text += piece
    }
  }

  function emitCue(text) {
    const t = text.trim()
    if (!t) return
    sendCue(t)
    onStoreText(t)
  }

  function flushActiveSeg() {
    if (activeSeg.text.trim()) {
      emitCue(activeSeg.text)
    }
    activeSeg = { id: -1, text: '' }
  }

  function extractCompletedSentences() {
    while (true) {
      const m = activeSeg.text.match(/^(.+?[。！？；.!?…])(.*)$/s)
      if (!m || m[1].trim().length < 2) break
      emitCue(m[1])
      activeSeg.text = m[2].trim()
    }
  }

  return {
    reset,
    flush: flushActiveSeg,
    handleResult(parsed) {
      if (!parsed?.text) return

      const segId = parsed.raw?.data?.seg_id ?? 0
      const ls = Boolean(parsed.raw?.data?.ls)

      mergeSegText(segId, parsed.text)

      // 中间结果只更新缓冲，不展示
      if (!parsed.isFinal) return

      extractCompletedSentences()
      if (ls) flushActiveSeg()
    },
  }
}

export { SENTENCE_END_RE }
