import { useEffect, useRef } from 'react'
import type { LiveSubtitleLine } from '../hooks/useLiveSubtitle'
import { SPEAKER_COLORS, speakerLabel } from '../utils/liveSubtitle'
import type { SubtitleStyle } from '../types'

type Props = {
  lines: LiveSubtitleLine[]
  style: SubtitleStyle
  emptyHint?: string
  title?: string
}

export function SubtitleLyricsPanel({
  lines,
  style,
  emptyHint = '开始转写后，字幕将在此滚动显示',
  title = '课堂字幕',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)

  const currentId = lines.find((l) => l.status === 'current')?.id

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentId, lines.length])

  const showBg = style.backgroundOpacity > 0.05
  const lineBg = showBg
    ? { backgroundColor: `rgba(${hexToRgb(style.backgroundColor)}, ${style.backgroundOpacity})` }
    : undefined

  return (
    <aside className="subtitle-lyrics-panel">
      <div className="subtitle-lyrics-panel-header">{title}</div>
      <div className="subtitle-lyrics-panel-scroll" ref={scrollRef}>
        {lines.length === 0 ? (
          <div className="subtitle-lyrics-empty">{emptyHint}</div>
        ) : (
          <div
            className="subtitle-lyrics-list"
            style={{
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              color: style.color,
            }}
          >
            {lines.map((line) => {
              const speakerColor =
                line.speaker > 0
                  ? SPEAKER_COLORS[line.speaker % SPEAKER_COLORS.length] || style.color
                  : style.color
              const label = speakerLabel(line.speaker)
              const isCurrent = line.status === 'current'
              const isUpcoming = line.status === 'upcoming'

              return (
                <div
                  key={line.id}
                  ref={isCurrent ? currentRef : undefined}
                  className={[
                    'subtitle-lyrics-item',
                    isCurrent ? 'is-current' : '',
                    isUpcoming ? 'is-upcoming' : '',
                    line.status === 'past' ? 'is-past' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div
                    className={['subtitle-lyrics-text', showBg ? 'has-bg' : ''].filter(Boolean).join(' ')}
                    style={{ color: speakerColor, ...lineBg }}
                  >
                    {label && <span className="subtitle-speaker">{label}</span>}
                    {line.text}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `${r}, ${g}, ${b}`
}
