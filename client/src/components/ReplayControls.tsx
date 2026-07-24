import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from '@ant-design/icons'
import { Button, Select, Slider, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { formatReplayTime } from '../hooks/useCourseReplay'

const { Text } = Typography

type Props = {
  playing: boolean
  currentMs: number
  durationMs: number
  speed: number
  hasTimeline: boolean
  onTogglePlay: () => void
  onSeek: (ms: number) => void
  onSpeedChange: (speed: number) => void
}

const SPEEDS = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
  { value: 4, label: '4x' },
]

export function ReplayControls({
  playing,
  currentMs,
  durationMs,
  speed,
  hasTimeline,
  onTogglePlay,
  onSeek,
  onSpeedChange,
}: Props) {
  const stepMs = 5000
  const [dragging, setDragging] = useState(false)
  const [dragMs, setDragMs] = useState(currentMs)

  useEffect(() => {
    if (!dragging) setDragMs(currentMs)
  }, [currentMs, dragging])

  const sliderValue = dragging ? dragMs : currentMs

  return (
    <div className="replay-controls">
      <div className="replay-controls-row">
        <Button
          type="text"
          icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={onTogglePlay}
          disabled={!hasTimeline}
          className="replay-play-btn"
        >
          {playing ? '暂停' : '播放'}
        </Button>
        <Button
          type="text"
          icon={<StepBackwardOutlined />}
          disabled={!hasTimeline}
          onClick={() => onSeek(Math.max(0, currentMs - stepMs))}
        />
        <Button
          type="text"
          icon={<StepForwardOutlined />}
          disabled={!hasTimeline}
          onClick={() => onSeek(Math.min(durationMs, currentMs + stepMs))}
        />
        <Text className="replay-time">
          {formatReplayTime(sliderValue)} / {formatReplayTime(durationMs)}
        </Text>
        <Slider
          className="replay-slider"
          min={0}
          max={Math.max(durationMs, 1)}
          step={200}
          value={sliderValue}
          disabled={!hasTimeline}
          tooltip={{ formatter: (v) => formatReplayTime(v ?? 0) }}
          onChange={(v) => {
            setDragging(true)
            setDragMs(Number(v) || 0)
          }}
          onChangeComplete={(v) => {
            setDragging(false)
            onSeek(Number(v) || 0)
          }}
        />
        <Select
          size="small"
          value={speed}
          options={SPEEDS}
          disabled={!hasTimeline}
          onChange={onSpeedChange}
          className="replay-speed"
        />
        {!hasTimeline && (
          <Text type="secondary" className="replay-hint">
            暂无回放时间轴，可手动翻页浏览课件
          </Text>
        )}
      </div>
    </div>
  )
}
