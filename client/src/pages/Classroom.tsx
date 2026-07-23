import {
  ArrowLeftOutlined,
  AudioMutedOutlined,
  AudioOutlined,
  FileTextOutlined,
  FullscreenOutlined,
  LeftOutlined,
  RightOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { Badge, Button, Drawer, Modal, Space, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { endSession, getReport, getSession, recordSlide, updateSubtitleStyle } from '../api'
import { PptViewer, type PptViewerHandle } from '../components/PptViewer'
import { ReplayControls } from '../components/ReplayControls'
import { SubtitleLyricsPanel } from '../components/SubtitleLyricsPanel'
import { SubtitleOverlay } from '../components/SubtitleOverlay'
import { SubtitleSettings } from '../components/SubtitleSettings'
import { useAsrSocket } from '../hooks/useAsrSocket'
import { buildReplayData, useCourseReplay } from '../hooks/useCourseReplay'
import { useLiveSubtitle } from '../hooks/useLiveSubtitle'
import { useAudioCapture } from '../hooks/useAudioCapture'
import {
  loadSubtitleStyle,
  saveSubtitleStyle,
  type Session,
  type SubtitleStyle,
} from '../types'

const { Text } = Typography

export function ClassroomPage() {
  const { id } = useParams()
  const sessionId = Number(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const reviewRoundParam = searchParams.get('round')
  const reviewRoundNumber = reviewRoundParam ? Number(reviewRoundParam) : null

  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [replayData, setReplayData] = useState<ReturnType<typeof buildReplayData> | null>(null)
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(loadSubtitleStyle())
  const [recording, setRecording] = useState(false)
  const [asrStreaming, setAsrStreaming] = useState(false)
  const { lines: subtitleLines, onLive, flush: flushSubtitles, reset: resetSubtitles } =
    useLiveSubtitle()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [slideIndex, setSlideIndex] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [classStartMs] = useState(() => Date.now())
  const [ending, setEnding] = useState(false)
  const [pptLayout, setPptLayout] = useState<{ width: number; height: number } | null>(null)

  const pptRef = useRef<PptViewerHandle>(null)
  /** 与 ASR 服务端一致：相对当前课次 started_at_ms 的毫秒偏移 */
  const roundStartRef = useRef(classStartMs)

  useEffect(() => {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      navigate('/courses')
      return
    }
    setSessionLoading(true)
    setReplayData(null)
    getSession(sessionId)
      .then(async (s) => {
        setSession(s)
        if (s.status === 'active') {
          const activeRound = s.rounds?.find((r) => r.status === 'active')
          roundStartRef.current = activeRound?.started_at_ms ?? Date.now()
        }
        if (s.subtitle_style && Object.keys(s.subtitle_style).length) {
          setSubtitleStyle({ ...loadSubtitleStyle(), ...s.subtitle_style })
        }
        if (s.status === 'ended' || reviewRoundNumber) {
          try {
            const round =
              reviewRoundNumber ??
              ((s.ended_round_count ?? 0) > 0
                ? (s.ended_round_count ?? s.current_round ?? 1)
                : (s.current_round ?? s.round_count ?? 1))
            const report = await getReport(sessionId, round)
            setReplayData(buildReplayData(report.slideEvents, report.transcript))
          } catch {
            setReplayData(buildReplayData([], []))
          }
        }
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : '加载失败')
        navigate('/courses')
      })
      .finally(() => setSessionLoading(false))
  }, [sessionId, navigate, reviewRoundNumber])

  const { status: asrStatus, aiPolish, error: asrError, errorHint: asrErrorHint, sendAudio, stop: stopAsr } = useAsrSocket({
    sessionId,
    // 录课期间保持转写连接，避免静音断开导致字幕缺段、翻页页码不同步
    enabled: recording,
    slideIndex,
    onLive,
  })

  const handleSpeechStart = useCallback(() => {
    setAsrStreaming(true)
  }, [])

  const handleSilence = useCallback(() => {
    // 仅刷新字幕展示，不断开转写（断开重连易丢句）
    flushSubtitles()
    setAsrStreaming(false)
  }, [flushSubtitles])

  const { active: micActive, error: micError, start: startMic, stop: stopMic } = useAudioCapture(
    recording,
    sendAudio,
    {
      onSpeechStart: handleSpeechStart,
      onSilence: handleSilence,
    },
  )

  const handleSlideChange = useCallback(
    (index: number, total: number) => {
      setSlideIndex(index)
      setSlideCount(total)
    },
    [],
  )

  const recordSlideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSlideRef = useRef<number | null>(null)

  const isReview = session?.status === 'ended' || reviewRoundNumber != null
  const displayRound = reviewRoundNumber ?? session?.current_round ?? 1

  const replay = useCourseReplay({
    data: replayData,
    pptRef,
    enabled: isReview && !sessionLoading,
    pptReady: slideCount > 0,
  })

  const { pause: pauseReplay, togglePlay: toggleReplayPlay } = replay

  useEffect(() => {
    if (slideCount <= 0 || isReview || !session) return

    pendingSlideRef.current = slideIndex
    if (recordSlideTimer.current) clearTimeout(recordSlideTimer.current)
    recordSlideTimer.current = setTimeout(() => {
      const idx = pendingSlideRef.current
      if (idx == null) return
      recordSlide(sessionId, idx, Date.now() - roundStartRef.current).catch(() => {})
    }, 400)

    return () => {
      if (recordSlideTimer.current) clearTimeout(recordSlideTimer.current)
    }
  }, [slideIndex, slideCount, sessionId, isReview, session])

  const handleSubtitleStyleChange = (style: SubtitleStyle) => {
    setSubtitleStyle(style)
    saveSubtitleStyle(style)
    updateSubtitleStyle(sessionId, style).catch(() => {})
  }

  const handleSubtitlePositionChange = (x: number, y: number) => {
    handleSubtitleStyleChange({
      ...subtitleStyle,
      position: 'custom',
      customX: x,
      customY: y,
    })
  }

  const handlePptLayoutChange = useCallback((layout: { width: number; height: number }) => {
    setPptLayout((prev) =>
      prev?.width === layout.width && prev?.height === layout.height ? prev : layout,
    )
  }, [])

  const activeSubtitleLines = isReview ? replay.subtitleLines : subtitleLines

  const toggleRecording = () => {
    if (recording) {
      flushSubtitles()
      setAsrStreaming(false)
      setRecording(false)
      stopMic()
      stopAsr()
    } else {
      resetSubtitles()
      setAsrStreaming(false)
      setRecording(true)
      // 必须在点击手势里同步启动麦克风，否则 AudioContext 可能一直 suspended
      void startMic()
      // 开始听课时立刻记下当前页，避免必须翻页才有课堂事件
      if (slideCount > 0) {
        recordSlide(sessionId, slideIndex, Date.now() - roundStartRef.current).catch(() => {})
      }
      message.info('已开始听课，请对着麦克风正常讲授')
    }
  }

  const handleEndClass = () => {
    const roundNo = session?.current_round ?? 1
    Modal.confirm({
      title: `结束第 ${roundNo} 节课？`,
      content: '结束后将根据本节转写自动生成评课报告；之后仍可继续上下一节。',
      okText: '结束并生成报告',
      cancelText: '取消',
      onOk: async () => {
        setEnding(true)
        try {
          flushSubtitles()
          setAsrStreaming(false)
          setRecording(false)
          stopMic()
          stopAsr()
          const result = await endSession(sessionId)
          const endedRound = result.endedRound ?? roundNo
          if (result.analysis) {
            message.success(`第 ${endedRound} 节报告已生成`)
          } else if (result.analysisError) {
            message.warning(`第 ${endedRound} 节已结束，报告生成失败，可在报告页手动生成`)
          } else {
            message.success(`第 ${endedRound} 节课已结束`)
          }
          navigate(`/report/${sessionId}?round=${endedRound}`)
        } catch (err) {
          message.error(err instanceof Error ? err.message : '操作失败')
        } finally {
          setEnding(false)
        }
      },
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        if (isReview) pauseReplay()
        pptRef.current?.next()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        if (isReview) pauseReplay()
        pptRef.current?.prev()
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        pptRef.current?.enterFullscreen()
      } else if (isReview && e.key === ' ') {
        e.preventDefault()
        toggleReplayPlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isReview, pauseReplay, toggleReplayPlay])

  const statusTag = () => {
    if (isReview) {
      return (
        <Tag>
          第 {displayRound} 节 · 课件回放
        </Tag>
      )
    }
    return <Tag color="blue">第 {displayRound} 节</Tag>
  }

  const liveStatusTag = () => {
    if (!recording) return <Tag>未听课</Tag>
    if (!asrStreaming) return <Tag color="default">等待说话</Tag>
    if (asrStatus === 'connected') {
      return (
        <Space size={4}>
          <Tag color="green">听课中</Tag>
          {aiPolish && <Tag color="blue">术语校对</Tag>}
        </Space>
      )
    }
    if (asrStatus === 'connecting') return <Tag color="processing">连接中</Tag>
    if (asrStatus === 'error') return <Tag color="red">听课异常</Tag>
    if (asrStatus === 'sleeping') return <Tag color="default">等待说话</Tag>
    return <Tag color="blue">听课中</Tag>
  }

  const roundHasAnalysis = (roundNumber: number) =>
    session?.rounds?.find((r) => r.round_number === roundNumber)?.has_analysis ?? false

  const reportButtonLabel = (roundNumber: number) =>
    roundHasAnalysis(roundNumber) ? '查看报告' : '生成报告'

  return (
    <div className="classroom-page">
      <header className="classroom-toolbar">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/courses')}>
            返回课程
          </Button>
          <Text strong>{session?.title || '加载中…'}</Text>
          {statusTag()}
          {!isReview && liveStatusTag()}
          {micActive && !isReview && <Badge status="processing" text="麦克风" />}
        </Space>
        <Space wrap>
          <Button icon={<LeftOutlined />} onClick={() => { pauseReplay(); pptRef.current?.prev() }}>
            上一页
          </Button>
          <Button icon={<RightOutlined />} onClick={() => { pauseReplay(); pptRef.current?.next() }}>
            下一页
          </Button>
          <Button icon={<FullscreenOutlined />} onClick={() => pptRef.current?.enterFullscreen()}>
            全屏
          </Button>
          {isReview ? (
            <Button
              icon={<FileTextOutlined />}
              onClick={() => navigate(`/report/${sessionId}?round=${displayRound}`)}
            >
              {reportButtonLabel(displayRound)}
            </Button>
          ) : (
            <>
              {(session?.ended_round_count ?? 0) > 0 && (
                <Button
                  icon={<FileTextOutlined />}
                  onClick={() =>
                    navigate(`/report/${sessionId}?round=${session?.ended_round_count ?? 1}`)
                  }
                >
                  {reportButtonLabel(session?.ended_round_count ?? 1)}
                </Button>
              )}
              <Button
                type={recording ? 'default' : 'primary'}
                icon={recording ? <AudioMutedOutlined /> : <AudioOutlined />}
                onClick={toggleRecording}
              >
                {recording ? '暂停听课' : '开始听课'}
              </Button>
              <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
                字幕
              </Button>
              <Button danger icon={<StopOutlined />} loading={ending} onClick={handleEndClass}>
                结束并生成报告
              </Button>
            </>
          )}
          {isReview && (
            <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
              字幕
            </Button>
          )}
        </Space>
      </header>

      {!isReview && (asrError || micError) && (
        <div className="classroom-alert">
          <div>{asrError || micError}</div>
          {asrErrorHint && <div className="classroom-alert-hint">{asrErrorHint}</div>}
        </div>
      )}

      <main className="classroom-stage classroom-split">
        <div
          className="classroom-ppt-pane"
          style={pptLayout ? { width: pptLayout.width, flex: '0 0 auto' } : { flex: '1 1 auto' }}
        >
          {sessionLoading ? (
            <div className="ppt-overlay-msg">加载课程…</div>
          ) : session?.ppt_path ? (
            <PptViewer
              key={session.ppt_path}
              ref={pptRef}
              src={session.ppt_path}
              onSlideChange={handleSlideChange}
              onLayoutChange={handlePptLayoutChange}
              onUserNavigate={isReview ? pauseReplay : undefined}
              overlay={
                <SubtitleOverlay
                  lines={activeSubtitleLines}
                  style={subtitleStyle}
                  onStylePositionChange={handleSubtitlePositionChange}
                />
              }
            />
          ) : (
            <div className="ppt-overlay-msg">该课程未上传课件</div>
          )}
        </div>
        <SubtitleLyricsPanel
          lines={activeSubtitleLines}
          style={subtitleStyle}
          title={isReview ? '回放字幕' : '实时字幕'}
          emptyHint={
            isReview
              ? '该节暂无转写记录'
              : recording
                ? '正在听课，讲完一句后将完整显示字幕'
                : '点击「开始听课」，讲完一句后显示完整字幕'
          }
        />
      </main>

      {isReview && !sessionLoading && (
        <ReplayControls
          playing={replay.playing}
          currentMs={replay.currentMs}
          durationMs={replay.durationMs}
          speed={replay.speed}
          hasTimeline={replay.hasTimeline}
          onTogglePlay={replay.togglePlay}
          onSeek={replay.seek}
          onSpeedChange={replay.setSpeed}
        />
      )}

      <footer className="classroom-footer">
        <Text type="secondary">
          第 {slideIndex + 1}/{slideCount || '?'} 页 · ← → 翻页 · F 全屏
          {isReview ? ' · 空格 播放/暂停' : ''}
        </Text>
      </footer>

      <Drawer
        title="字幕样式"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width={320}
      >
        <SubtitleSettings value={subtitleStyle} onChange={handleSubtitleStyleChange} />
      </Drawer>
    </div>
  )
}
