const SENTENCE_END_RE = /[。！？；.!?…]+/
const COMMA_RE = /[，,]/
/** 无句号时，pending 达到该长度强制分句 */
const MAX_PENDING_CHARS = 18
/** 出现逗号且已有一定长度时分句 */
const COMMA_BREAK_MIN = 6

/** 将流式片段拼成句子，并支持第二行实时预览 */
export class SubtitleSentenceBuffer {
  private pending = ''
  private sentences: string[] = []

  pushFinal(fragment: string): void {
    const piece = fragment.trim()
    if (!piece) return
    this.pending += piece
    this.extractCompleted()
  }

  /** 停顿后把未完结内容收成一句 */
  flushPendingAsSentence(): boolean {
    if (!this.pending.trim()) return false
    this.sentences.push(this.pending.trim())
    this.pending = ''
    return true
  }

  flush(): string | null {
    if (!this.flushPendingAsSentence()) return null
    return this.sentences[this.sentences.length - 1] ?? null
  }

  /**
   * 最多两行：
   * - 第一行：上一句已完结
   * - 第二行：当前正在说的（livePreview 或 pending），即时更新
   */
  getDisplayLines(livePreview?: string): string[] {
    const live = (livePreview?.trim() || this.pending.trim())
    const done = this.sentences

    if (done.length === 0) {
      return live ? [live] : []
    }

    if (done.length === 1) {
      const lines = [done[0]]
      if (live && !done[0].endsWith(live) && live !== done[0]) {
        lines.push(live)
      }
      return lines.slice(-2)
    }

    const prev = done[done.length - 2]
    const last = done[done.length - 1]
    const second = live && live !== last ? live : last
    return [prev, second].slice(-2)
  }

  reset() {
    this.pending = ''
    this.sentences = []
  }

  private extractCompleted() {
    let lastIndex = 0
    const re = new RegExp(SENTENCE_END_RE.source, 'g')
    let match: RegExpExecArray | null

    while ((match = re.exec(this.pending)) !== null) {
      const end = match.index + match[0].length
      const sentence = this.pending.slice(lastIndex, end).trim()
      lastIndex = end
      if (sentence) this.sentences.push(sentence)
    }
    this.pending = this.pending.slice(lastIndex).trim()

    this.flushByCommaOrLength()
  }

  private flushByCommaOrLength() {
    while (this.pending.length >= MAX_PENDING_CHARS) {
      if (!this.flushAtComma()) {
        this.sentences.push(this.pending)
        this.pending = ''
        break
      }
    }
  }

  private flushAtComma(): boolean {
    const m = COMMA_RE.exec(this.pending)
    if (!m || m.index < COMMA_BREAK_MIN) return false
    const end = m.index + 1
    const sentence = this.pending.slice(0, end).trim()
    this.pending = this.pending.slice(end).trim()
    if (sentence) this.sentences.push(sentence)
    return true
  }
}
