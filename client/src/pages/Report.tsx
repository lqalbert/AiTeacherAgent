import {
  ArrowLeftOutlined,
  FileMarkdownOutlined,
  FilePptOutlined,
  FileWordOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Collapse,
  Empty,
  List,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { analyzeSession, exportUrl, getReport } from '../api'
import { MindMapView } from '../components/MindMapView'
import type { AnalysisResult, Question, Report } from '../types'
import { normalizeEvaluationPoints } from '../utils/evaluationPoints'
import { joinTranscriptSegments } from '../utils/transcriptText'

const { Title, Paragraph, Text } = Typography

const TYPE_LABEL: Record<string, string> = {
  choice: '选择题',
  blank: '填空题',
  short: '简答题',
}

type TocItem = { id: string; label: string }

function buildReportToc(analysis: AnalysisResult | null | undefined, hasQuestions: boolean, hasTranscript: boolean): TocItem[] {
  const items: TocItem[] = []
  if (!analysis) {
    if (hasTranscript) items.push({ id: 'report-transcript', label: '转写记录' })
    return items
  }
  items.push({ id: 'report-evaluation', label: '课堂评价' })
  items.push({ id: 'report-summary', label: '课堂总结' })
  items.push({ id: 'report-keypoints', label: '重点' })
  items.push({ id: 'report-difficult', label: '难点' })
  items.push({ id: 'report-mindmap', label: '思维导图' })
  if (hasQuestions) items.push({ id: 'report-questions', label: '课后习题' })
  if (hasTranscript) items.push({ id: 'report-transcript', label: '转写记录' })
  return items
}

function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function ReportPage() {
  const { id } = useParams()
  const sessionId = Number(id)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [tocOpen, setTocOpen] = useState(true)
  const [activeTocId, setActiveTocId] = useState<string>('')

  const load = useCallback(
    async (round?: number) => {
      setLoading(true)
      try {
        const data = await getReport(sessionId, round)
        setReport(data)
        const activeRound = data.currentRound?.round_number
        if (activeRound != null) {
          const currentParam = searchParams.get('round')
          if (currentParam !== String(activeRound)) {
            setSearchParams({ round: String(activeRound) }, { replace: true })
          }
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    },
    [sessionId, searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      navigate('/courses')
      return
    }
    const roundParam = searchParams.get('round')
    const round = roundParam ? Number(roundParam) : undefined
    load(round)
  }, [sessionId, navigate, searchParams.get('round')])

  const viewingRound = report?.currentRound?.round_number ?? Number(searchParams.get('round')) ?? 1
  const endedRounds = (report?.rounds ?? []).filter((r) => r.status === 'ended')

  const switchRound = async (round: number) => {
    setSearchParams({ round: String(round) }, { replace: true })
    setLoading(true)
    try {
      const data = await getReport(sessionId, round)
      setReport(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const runAnalyze = async () => {
    setAnalyzing(true)
    try {
      await analyzeSession(sessionId, viewingRound)
      message.success(`第 ${viewingRound} 节报告已生成`)
      await switchRound(viewingRound)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '分析失败，请检查 API Key 配置')
    } finally {
      setAnalyzing(false)
    }
  }

  const download = (format: 'md' | 'docx') => {
    window.open(exportUrl(sessionId, format, viewingRound), '_blank')
  }

  const finalText = report ? joinTranscriptSegments(report.transcript) : ''
  const tocItems = useMemo(
    () => buildReportToc(report?.analysis, (report?.questions?.length ?? 0) > 0, Boolean(finalText)),
    [report?.analysis, report?.questions, finalText],
  )

  useEffect(() => {
    if (tocItems.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target?.id) setActiveTocId(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5] },
    )
    for (const item of tocItems) {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [tocItems, report, loading])

  if (loading && !report) {
    return (
      <div className="page center">
        <Spin size="large" tip="加载报告…" />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="page center">
        <Empty description="课程不存在" />
      </div>
    )
  }

  const { session, analysis, questions, rounds } = report

  const roundSwitcher =
    endedRounds.length > 1 ? (
      <Segmented
        size="small"
        value={viewingRound}
        options={endedRounds.map((r) => ({
          label: `第 ${r.round_number} 节`,
          value: r.round_number,
        }))}
        onChange={(v) => switchRound(Number(v))}
      />
    ) : endedRounds.length === 1 ? (
      <Tag>第 {endedRounds[0].round_number} 节</Tag>
    ) : report.currentRound ? (
      <Tag>第 {report.currentRound.round_number} 节</Tag>
    ) : null

  return (
    <div className="page report-page">
      <div className="page-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/courses')}>
            返回课程
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            {session.title}
          </Title>
          <Tag>
            {session.ended_at
              ? `共 ${session.round_count ?? rounds?.length ?? 1} 节 · 已结束`
              : (session.ended_round_count ?? endedRounds.length) > 0
                ? `第 ${session.current_round ?? 1} 节 · 进行中（已完成 ${session.ended_round_count ?? endedRounds.length} 节）`
                : `第 ${session.current_round ?? 1} 节 · 进行中`}
          </Tag>
        </Space>
        <Space wrap>
          {roundSwitcher}
          {session.ppt_path && (
            <Button
              icon={<FilePptOutlined />}
              onClick={() => navigate(`/classroom/${sessionId}?round=${viewingRound}`)}
            >
              课件回放
            </Button>
          )}
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={analyzing}
            onClick={runAnalyze}
          >
            {analysis ? '重新分析' : '生成报告'}
          </Button>
          <Button icon={<FileMarkdownOutlined />} onClick={() => download('md')}>
            下载 Markdown
          </Button>
          <Button icon={<FileWordOutlined />} onClick={() => download('docx')}>
            下载 Word
          </Button>
        </Space>
      </div>

      <div className={`report-layout${tocOpen ? '' : ' is-toc-collapsed'}`}>
        <aside className="report-toc" aria-label="报告目录">
          <div className="report-toc-head">
            {tocOpen ? <Text strong>目录</Text> : null}
            <Button
              type="text"
              size="small"
              className="report-toc-toggle"
              icon={tocOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={() => setTocOpen((v) => !v)}
              title={tocOpen ? '收起目录' : '展开目录'}
              aria-label={tocOpen ? '收起目录' : '展开目录'}
            />
          </div>
          {tocOpen && (
            <nav className="report-toc-nav">
              {tocItems.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  暂无章节
                </Text>
              ) : (
                tocItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`report-toc-item${activeTocId === item.id ? ' is-active' : ''}`}
                    onClick={() => {
                      setActiveTocId(item.id)
                      scrollToSection(item.id)
                    }}
                  >
                    {item.label}
                  </button>
                ))
              )}
            </nav>
          )}
        </aside>

        <div className="report-main">
          <Card title={`第 ${viewingRound} 节 · 课堂报告`} loading={loading && !!report}>
            {!analysis ? (
              <Empty
                description="该节尚未生成报告，点击「生成报告」"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <>
                <AnalysisSection analysis={analysis} />
                {questions?.length > 0 && <QuestionsSection questions={questions} />}
              </>
            )}
          </Card>

          <div id="report-transcript" className="report-anchor" style={{ marginTop: 16 }}>
            <Card title={`第 ${viewingRound} 节 · 转写记录`}>
              {finalText ? (
                <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{finalText}</Paragraph>
              ) : (
                <Text type="secondary">该节暂无转写内容</Text>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function AnalysisSection({ analysis }: { analysis: AnalysisResult }) {
  const ev = analysis.evaluation
  const strengths = normalizeEvaluationPoints(ev?.strengths)
  const improvements = normalizeEvaluationPoints(ev?.improvements)
  const dimLabels: Record<string, string> = {
    content: '教学内容',
    logic: '讲解逻辑',
    focus: '重点把握',
    expression: '语言表达',
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <div id="report-evaluation" className="report-anchor">
        {ev?.summary ? (
          <Card
            title="课堂评价"
            type="inner"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>基于本节转写 · 附证据引用</Text>}
          >
            <Paragraph>{ev.summary}</Paragraph>
            <Tag color="blue">教学综合评分 {ev.score}/5</Tag>
            {ev.dimensions && (
              <div style={{ marginTop: 12 }}>
                <Space wrap>
                  {Object.entries(ev.dimensions).map(([key, val]) => (
                    <Tag key={key}>
                      {dimLabels[key] || key} {val}/5
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
            {strengths.length > 0 && (
              <>
                <Text strong style={{ display: 'block', marginTop: 16 }}>
                  教学亮点
                </Text>
                <List
                  size="small"
                  dataSource={strengths}
                  renderItem={(item) => (
                    <List.Item className="eval-point-item">
                      <div className="eval-point">
                        <div className="eval-point-claim">• {item.claim}</div>
                        {(item.page || item.quote) && (
                          <div className="eval-point-evidence">
                            <span className="eval-point-evidence-label">证据</span>
                            {item.page ? <Tag className="eval-point-page">第 {item.page} 页</Tag> : null}
                            {item.quote ? <span className="eval-point-quote">「{item.quote}」</span> : null}
                          </div>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
              </>
            )}
            {improvements.length > 0 && (
              <>
                <Text strong style={{ display: 'block', marginTop: 8 }}>
                  改进建议
                </Text>
                <List
                  size="small"
                  dataSource={improvements}
                  renderItem={(item) => (
                    <List.Item className="eval-point-item">
                      <div className="eval-point">
                        <div className="eval-point-claim">• {item.claim}</div>
                        {(item.page || item.quote) && (
                          <div className="eval-point-evidence">
                            <span className="eval-point-evidence-label">证据</span>
                            {item.page ? <Tag className="eval-point-page">第 {item.page} 页</Tag> : null}
                            {item.quote ? <span className="eval-point-quote">「{item.quote}」</span> : null}
                          </div>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
              </>
            )}
          </Card>
        ) : (
          <Card title="课堂评价" type="inner">
            <Text type="secondary">暂无评价，点击「重新分析」根据转写生成</Text>
          </Card>
        )}
      </div>
      <div id="report-summary" className="report-anchor">
        <Card title="课堂总结" type="inner">
          <Paragraph>{analysis.summary}</Paragraph>
          <Tag color="blue">整体难度 {analysis.difficultyLevel}/5</Tag>
          {analysis.knowledgeTags?.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </Card>
      </div>
      <div id="report-keypoints" className="report-anchor">
        <Card title="重点" type="inner">
          <List
            size="small"
            dataSource={analysis.keyPoints}
            renderItem={(item) => <List.Item>• {item}</List.Item>}
            locale={{ emptyText: '暂无' }}
          />
        </Card>
      </div>
      <div id="report-difficult" className="report-anchor">
        <Card title="难点" type="inner">
          <List
            size="small"
            dataSource={analysis.difficultPoints}
            renderItem={(item) => <List.Item>• {item}</List.Item>}
            locale={{ emptyText: '暂无' }}
          />
        </Card>
      </div>
      <div id="report-mindmap" className="report-anchor">
        {analysis.mindMap && (analysis.mindMap.children?.length ?? 0) > 0 ? (
          <Card
            title="思维导图"
            type="inner"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>基于本节转写</Text>}
          >
            <MindMapView root={analysis.mindMap} />
          </Card>
        ) : (
          <Card title="思维导图" type="inner">
            <Text type="secondary">暂无思维导图，点击「重新分析」根据转写生成</Text>
          </Card>
        )}
      </div>
    </Space>
  )
}

function QuestionsSection({ questions }: { questions: Question[] }) {
  return (
    <div id="report-questions" className="report-anchor" style={{ marginTop: 16 }}>
      <Card title="课后习题" type="inner">
        <Collapse
          items={questions.map((q, i) => ({
            key: String(i),
            label: (
              <Space>
                <Text strong>第 {i + 1} 题</Text>
                <Tag>{TYPE_LABEL[q.questionType] || q.questionType}</Tag>
                <Tag color="orange">难度 {q.difficulty}/5</Tag>
              </Space>
            ),
            children: (
              <div>
                <Paragraph>{q.stem}</Paragraph>
                {q.options && (
                  <List
                    size="small"
                    dataSource={Object.entries(q.options)}
                    renderItem={([k, v]) => (
                      <List.Item>
                        {k}. {v}
                      </List.Item>
                    )}
                  />
                )}
                <Paragraph>
                  <Text strong>答案：</Text>
                  {q.answer}
                </Paragraph>
                {q.explanation && (
                  <Paragraph type="secondary">
                    <Text strong>解析：</Text>
                    {q.explanation}
                  </Paragraph>
                )}
              </div>
            ),
          }))}
        />
      </Card>
    </div>
  )
}
