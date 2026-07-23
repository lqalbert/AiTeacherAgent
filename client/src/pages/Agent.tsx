import {
  BookOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  FormOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import {
  Button,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Typography,
  Upload,
  message,
} from 'antd'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  deleteKnowledgeDoc,
  getAgentConfig,
  getKnowledgeDocText,
  knowledgeFileUrl,
  listKnowledgeDocs,
  saveAgentConfig,
  uploadKnowledgeDoc,
} from '../api'
import { useAuth } from '../auth/AuthContext'
import { PptViewer } from '../components/PptViewer'
import type { AgentConfig, KnowledgeDoc } from '../types/agentConfig'
import { formatBeijingTime } from '../utils/time'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input

type PanelKey = 'role' | 'evaluation' | 'report' | 'knowledge'

type KbPreviewState =
  | { kind: 'text'; docId: string; title: string; text: string; loading?: boolean }
  | { kind: 'pdf'; docId: string; title: string; url: string }
  | { kind: 'pptx'; docId: string; title: string; url: string }
  | null

function knowledgeExt(doc: KnowledgeDoc) {
  const name = doc.filename || doc.storedName || ''
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

const NAV: { key: PanelKey; label: string; icon: ReactNode }[] = [
  { key: 'role', label: '角色设定', icon: <SettingOutlined /> },
  { key: 'evaluation', label: '评价标准', icon: <FormOutlined /> },
  { key: 'report', label: '报告与作业', icon: <FormOutlined /> },
  { key: 'knowledge', label: '知识库', icon: <BookOutlined /> },
]

export function AgentPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [panel, setPanel] = useState<PanelKey>('role')
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [kbPreview, setKbPreview] = useState<KbPreviewState>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, kb] = await Promise.all([getAgentConfig(), listKnowledgeDocs()])
      setConfig(cfg)
      setDocs(kb)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    try {
      const saved = await saveAgentConfig(config)
      setConfig(saved)
      message.success('配置已保存，后续生成报告将按此读取')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const patchConfig = (updater: (prev: AgentConfig) => AgentConfig) => {
    setConfig((prev) => (prev ? updater(prev) : prev))
  }

  const handleUploadKnowledge = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', file.name.replace(/\.[^.]+$/, ''))
      const doc = await uploadKnowledgeDoc(fd)
      setDocs((list) => [doc, ...list])
      message.success('已加入知识库（与上课 PPT 分开）')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
    return false
  }

  const handleDeleteDoc = (doc: KnowledgeDoc) => {
    Modal.confirm({
      title: '确认删除该知识文档？',
      content: `将删除「${doc.title}」，此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteKnowledgeDoc(doc.id)
          setDocs((list) => list.filter((d) => d.id !== doc.id))
          if (kbPreview?.docId === doc.id) setKbPreview(null)
          message.success('已删除')
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败')
          throw err
        }
      },
    })
  }

  const handleDownloadDoc = (doc: KnowledgeDoc) => {
    window.open(knowledgeFileUrl(doc.id, true), '_blank', 'noopener,noreferrer')
  }

  const handlePreviewDoc = async (doc: KnowledgeDoc) => {
    const ext = knowledgeExt(doc)
    if (ext === '.pdf') {
      setKbPreview({ kind: 'pdf', docId: doc.id, title: doc.title, url: knowledgeFileUrl(doc.id) })
      return
    }
    if (ext === '.pptx') {
      setKbPreview({ kind: 'pptx', docId: doc.id, title: doc.title, url: knowledgeFileUrl(doc.id) })
      return
    }
    // txt / md / 其他：展示抽取文本；无文本时仍可下载原文件
    setKbPreview({ kind: 'text', docId: doc.id, title: doc.title, text: '', loading: true })
    try {
      const data = await getKnowledgeDocText(doc.id)
      setKbPreview({
        kind: 'text',
        docId: doc.id,
        title: data.title || doc.title,
        text: data.text?.trim()
          ? data.text
          : '（未能提取可预览文本，请下载原文件查看）',
      })
    } catch (err) {
      setKbPreview(null)
      message.error(err instanceof Error ? err.message : '预览失败')
    }
  }

  const handleOpenDoc = (doc: KnowledgeDoc) => {
    const ext = knowledgeExt(doc)
    if (ext === '.pdf') {
      window.open(knowledgeFileUrl(doc.id), '_blank', 'noopener,noreferrer')
      return
    }
    void handlePreviewDoc(doc)
  }

  if (loading || !config) {
    return (
      <div className="agent-console-page">
        <div className="page center" style={{ paddingTop: 80 }}>
          <Text type="secondary">加载智能体配置…</Text>
        </div>
      </div>
    )
  }

  const sectionEntries = Object.entries(config.report.sections)

  return (
    <div className="agent-console-page">
      <header className="agent-console-top">
        <div className="agent-console-brand">
          <div className="agent-console-avatar" aria-hidden>
            {(config.role.name || '智').slice(0, 1)}
          </div>
          <div>
            <Title level={3} className="app-page-title">
              {config.role.name || '智课随行'}
            </Title>
            <Text type="secondary" className="app-page-subtitle">
              {user?.username ? `${user.username} · ` : ''}
              智能体工作台 · 手动配置，生成报告时自动读取
            </Text>
          </div>
        </div>
        <Space wrap>
          <Button size="large" icon={<FolderOpenOutlined />} onClick={() => navigate('/courses')}>
            我的课程
          </Button>
          <Button
            type="primary"
            size="large"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
          >
            保存配置
          </Button>
          <Button size="large" onClick={() => logout().then(() => navigate('/login'))}>
            退出登录
          </Button>
        </Space>
      </header>

      <div className="agent-console-layout">
        <aside className="agent-console-nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`agent-console-nav-item${panel === item.key ? ' is-active' : ''}`}
              onClick={() => setPanel(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </aside>

        <main className="agent-console-main">
          {panel === 'role' && (
            <section className="agent-panel agent-form-panel">
              <Text strong>角色设定（自主输入）</Text>
              <Paragraph type="secondary">保存后，分析与评课 Prompt 将读取此处内容。</Paragraph>
              <label className="agent-field">
                <span>角色名称</span>
                <Input
                  value={config.role.name}
                  onChange={(e) =>
                    patchConfig((c) => ({ ...c, role: { ...c.role, name: e.target.value } }))
                  }
                />
              </label>
              <label className="agent-field">
                <span>开场白</span>
                <TextArea
                  rows={3}
                  value={config.role.opening}
                  onChange={(e) =>
                    patchConfig((c) => ({ ...c, role: { ...c.role, opening: e.target.value } }))
                  }
                />
              </label>
              <label className="agent-field">
                <span>任务目标</span>
                <TextArea
                  rows={3}
                  value={config.role.mission}
                  onChange={(e) =>
                    patchConfig((c) => ({ ...c, role: { ...c.role, mission: e.target.value } }))
                  }
                />
              </label>
              <label className="agent-field">
                <span>人设与原则</span>
                <TextArea
                  rows={5}
                  value={config.role.persona}
                  onChange={(e) =>
                    patchConfig((c) => ({ ...c, role: { ...c.role, persona: e.target.value } }))
                  }
                />
              </label>
              <label className="agent-field">
                <span>能力边界</span>
                <TextArea
                  rows={4}
                  value={config.role.boundaries}
                  onChange={(e) =>
                    patchConfig((c) => ({
                      ...c,
                      role: { ...c.role, boundaries: e.target.value },
                    }))
                  }
                />
              </label>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                保存角色设定
              </Button>
            </section>
          )}

          {panel === 'evaluation' && (
            <section className="agent-panel agent-form-panel">
              <Text strong>教师课堂评价标准</Text>
              <Paragraph type="secondary">
                生成「教学评价与建议」时，将整段标准注入模型。可按校本要求自由改写。
              </Paragraph>
              <label className="agent-field">
                <span>评价标准正文</span>
                <TextArea
                  rows={10}
                  value={config.evaluation.standards}
                  onChange={(e) =>
                    patchConfig((c) => ({
                      ...c,
                      evaluation: { ...c.evaluation, standards: e.target.value },
                    }))
                  }
                />
              </label>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                评分维度
              </Text>
              {config.evaluation.dimensions.map((dim, idx) => (
                <div key={dim.key} className="agent-inline-row">
                  <Switch
                    checked={dim.enabled}
                    onChange={(checked) =>
                      patchConfig((c) => {
                        const dimensions = [...c.evaluation.dimensions]
                        dimensions[idx] = { ...dimensions[idx], enabled: checked }
                        return { ...c, evaluation: { ...c.evaluation, dimensions } }
                      })
                    }
                  />
                  <Input
                    value={dim.label}
                    onChange={(e) =>
                      patchConfig((c) => {
                        const dimensions = [...c.evaluation.dimensions]
                        dimensions[idx] = { ...dimensions[idx], label: e.target.value }
                        return { ...c, evaluation: { ...c.evaluation, dimensions } }
                      })
                    }
                    style={{ maxWidth: 200 }}
                  />
                  <Text type="secondary">字段 {dim.key}</Text>
                </div>
              ))}
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                保存评价标准
              </Button>
            </section>
          )}

          {panel === 'report' && (
            <section className="agent-panel agent-form-panel">
              <Text strong>报告内容项目</Text>
              <Paragraph type="secondary">关闭后，生成报告时将跳过对应模块。</Paragraph>
              {sectionEntries.map(([key, section]) => (
                <div key={key} className="agent-inline-row">
                  <Switch
                    checked={section.enabled}
                    onChange={(checked) =>
                      patchConfig((c) => ({
                        ...c,
                        report: {
                          ...c.report,
                          sections: {
                            ...c.report.sections,
                            [key]: { ...section, enabled: checked },
                          },
                        },
                      }))
                    }
                  />
                  <Input
                    value={section.label}
                    onChange={(e) =>
                      patchConfig((c) => ({
                        ...c,
                        report: {
                          ...c.report,
                          sections: {
                            ...c.report.sections,
                            [key]: { ...section, label: e.target.value },
                          },
                        },
                      }))
                    }
                    style={{ maxWidth: 220 }}
                  />
                  <Text type="secondary">{key}</Text>
                </div>
              ))}

              <Text strong style={{ display: 'block', margin: '20px 0 8px' }}>
                课后作业题型与题量
              </Text>
              <Paragraph type="secondary" style={{ marginTop: 0 }}>
                可自由开关题型，并设置每种题型数量（生成时严格按此配置）。
              </Paragraph>
              {config.homework.types.map((item, idx) => (
                <div key={item.type} className="agent-inline-row">
                  <Switch
                    checked={item.enabled}
                    onChange={(checked) =>
                      patchConfig((c) => {
                        const types = [...c.homework.types]
                        types[idx] = { ...types[idx], enabled: checked }
                        return { ...c, homework: { ...c.homework, types } }
                      })
                    }
                  />
                  <Input
                    value={item.label}
                    onChange={(e) =>
                      patchConfig((c) => {
                        const types = [...c.homework.types]
                        types[idx] = { ...types[idx], label: e.target.value }
                        return { ...c, homework: { ...c.homework, types } }
                      })
                    }
                    style={{ maxWidth: 140 }}
                  />
                  <InputNumber
                    min={0}
                    max={20}
                    value={item.count}
                    onChange={(val) =>
                      patchConfig((c) => {
                        const types = [...c.homework.types]
                        types[idx] = { ...types[idx], count: Number(val) || 0 }
                        return { ...c, homework: { ...c.homework, types } }
                      })
                    }
                  />
                  <Text type="secondary">题 · {item.type}</Text>
                </div>
              ))}
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                保存报告与作业配置
              </Button>
            </section>
          )}

          {panel === 'knowledge' && (
            <section className="agent-panel agent-form-panel">
              <Text strong>知识库（≠ 上课 PPT）</Text>
              <Paragraph type="secondary">
                知识库用于存放课程标准、校本要求、参考讲义等<strong>补充资料</strong>
                。上课时上传的 PPT 只负责放映与翻页对齐，不会自动进入本知识库。
              </Paragraph>
              <Space wrap style={{ marginBottom: 16 }}>
                <Upload
                  accept=".txt,.md,.pdf,.pptx"
                  showUploadList={false}
                  beforeUpload={handleUploadKnowledge}
                  disabled={uploading}
                >
                  <Button type="primary" icon={<PlusOutlined />} loading={uploading}>
                    上传知识文档
                  </Button>
                </Upload>
                <Text type="secondary">支持 .txt / .md / .pdf / .pptx</Text>
              </Space>

              {docs.length === 0 ? (
                <Paragraph type="secondary">暂无文档。请上传后保存配置，分析时会一并读取。</Paragraph>
              ) : (
                docs.map((doc) => (
                  <div key={doc.id} className="agent-kb-row">
                    <div className="agent-kb-info">
                      <button
                        type="button"
                        className="agent-kb-title-btn"
                        onClick={() => handleOpenDoc(doc)}
                        title="打开 / 预览"
                      >
                        <Text strong>{doc.title}</Text>
                      </button>
                      <div className="agent-kb-meta">
                        {doc.filename} · {doc.charCount} 字
                        {doc.hasText ? '' : ' · 未能提取文本'} ·{' '}
                        {formatBeijingTime(doc.createdAt)}
                      </div>
                    </div>
                    <Space size={4} wrap className="agent-kb-actions">
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => void handlePreviewDoc(doc)}
                      >
                        预览
                      </Button>
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => handleDownloadDoc(doc)}
                      >
                        下载
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteDoc(doc)}
                      >
                        删除
                      </Button>
                    </Space>
                  </div>
                ))
              )}

              <Modal
                open={kbPreview != null}
                title={kbPreview?.title || '预览'}
                onCancel={() => setKbPreview(null)}
                footer={
                  kbPreview ? (
                    <Space>
                      <Button
                        icon={<DownloadOutlined />}
                        onClick={() =>
                          window.open(
                            knowledgeFileUrl(kbPreview.docId, true),
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                      >
                        下载原文件
                      </Button>
                      <Button type="primary" onClick={() => setKbPreview(null)}>
                        关闭
                      </Button>
                    </Space>
                  ) : null
                }
                width={kbPreview?.kind === 'pptx' || kbPreview?.kind === 'pdf' ? '90vw' : 720}
                destroyOnClose
                className="agent-kb-preview-modal"
                styles={{
                  body: {
                    maxHeight: kbPreview?.kind === 'text' ? '60vh' : '75vh',
                    overflow: 'auto',
                    paddingTop: 12,
                  },
                }}
              >
                {kbPreview?.kind === 'text' && (
                  <pre className="agent-kb-preview-text">
                    {kbPreview.loading ? '加载中…' : kbPreview.text}
                  </pre>
                )}
                {kbPreview?.kind === 'pdf' && (
                  <iframe
                    title={kbPreview.title}
                    src={kbPreview.url}
                    className="agent-kb-preview-frame"
                  />
                )}
                {kbPreview?.kind === 'pptx' && (
                  <div className="agent-kb-preview-ppt">
                    <PptViewer src={kbPreview.url} />
                  </div>
                )}
              </Modal>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
