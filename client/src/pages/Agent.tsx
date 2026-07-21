import {
  BookOutlined,
  FolderOpenOutlined,
  FormOutlined,
  PlusOutlined,
  RocketOutlined,
  SaveOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  Button,
  Input,
  InputNumber,
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
  listKnowledgeDocs,
  saveAgentConfig,
  uploadKnowledgeDoc,
} from '../api'
import { useAuth } from '../auth/AuthContext'
import type { AgentConfig, KnowledgeDoc } from '../types/agentConfig'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input

type PanelKey = 'overview' | 'role' | 'evaluation' | 'report' | 'knowledge' | 'skills'

const NAV: { key: PanelKey; label: string; icon: ReactNode }[] = [
  { key: 'overview', label: '对话与任务', icon: <ThunderboltOutlined /> },
  { key: 'role', label: '角色设定', icon: <SettingOutlined /> },
  { key: 'evaluation', label: '评价标准', icon: <FormOutlined /> },
  { key: 'report', label: '报告与作业', icon: <FormOutlined /> },
  { key: 'knowledge', label: '知识库', icon: <BookOutlined /> },
  { key: 'skills', label: '技能与工作流', icon: <RocketOutlined /> },
]

export function AgentPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [panel, setPanel] = useState<PanelKey>('overview')
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

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

  const handleDeleteDoc = async (id: string) => {
    try {
      await deleteKnowledgeDoc(id)
      setDocs((list) => list.filter((d) => d.id !== id))
      message.success('已删除')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
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
            <Title level={3} style={{ margin: 0 }}>
              {config.role.name || '智课随行'}
            </Title>
            <Text type="secondary">
              {user?.username ? `${user.username} · ` : ''}
              智能体工作台 · 手动配置，生成报告时自动读取
            </Text>
          </div>
        </div>
        <Space wrap>
          <Button icon={<FolderOpenOutlined />} onClick={() => navigate('/courses')}>
            我的课程
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            保存配置
          </Button>
          <Button onClick={() => logout().then(() => navigate('/login'))}>退出登录</Button>
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
          {panel === 'overview' && (
            <section className="agent-panel">
              <div className="agent-chat-window">
                <div className="agent-chat-bubble is-agent">
                  <div className="agent-chat-name">{config.role.name}</div>
                  <p>{config.role.opening || '请先在「角色设定」中填写开场白。'}</p>
                </div>
                <div className="agent-chat-bubble is-system">
                  <p>
                    知识库文档 {docs.length} 份 · 报告项目{' '}
                    {sectionEntries.filter(([, s]) => s.enabled).map(([, s]) => s.label).join('、') ||
                      '未启用'}{' '}
                    · 作业题量{' '}
                    {config.homework.types
                      .filter((t) => t.enabled)
                      .reduce((n, t) => n + Number(t.count || 0), 0)}{' '}
                    道
                  </p>
                </div>
              </div>

              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                请先配置角色、评价标准、报告项目与知识库，再进入「我的课程」上课。上课 PPT
                仅用于放映，<strong>不等于</strong>知识库。
              </Paragraph>

              <div className="agent-quick-grid">
                <button type="button" className="agent-quick-card" onClick={() => setPanel('role')}>
                  <SettingOutlined />
                  <strong>编辑角色</strong>
                  <span>自主输入名称、人设与边界</span>
                </button>
                <button
                  type="button"
                  className="agent-quick-card"
                  onClick={() => setPanel('evaluation')}
                >
                  <FormOutlined />
                  <strong>评价标准</strong>
                  <span>自定义课堂评价维度与要求</span>
                </button>
                <button type="button" className="agent-quick-card" onClick={() => setPanel('report')}>
                  <FormOutlined />
                  <strong>报告与作业</strong>
                  <span>勾选报告项，设置题型题量</span>
                </button>
                <button
                  type="button"
                  className="agent-quick-card"
                  onClick={() => setPanel('knowledge')}
                >
                  <BookOutlined />
                  <strong>知识库</strong>
                  <span>上传补充资料（非上课 PPT）</span>
                </button>
                <button type="button" className="agent-quick-card" onClick={() => setPanel('skills')}>
                  <RocketOutlined />
                  <strong>技能与工作流</strong>
                  <span>启停技能节点与流程步骤</span>
                </button>
                <button
                  type="button"
                  className="agent-quick-card"
                  onClick={() => navigate('/courses')}
                >
                  <FolderOpenOutlined />
                  <strong>我的课程</strong>
                  <span>上传上课 PPT，开始听课</span>
                </button>
              </div>
            </section>
          )}

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
                    <div>
                      <Text strong>{doc.title}</Text>
                      <div className="agent-kb-meta">
                        {doc.filename} · {doc.charCount} 字
                        {doc.hasText ? '' : ' · 未能提取文本'} ·{' '}
                        {new Date(doc.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <Button size="small" danger onClick={() => handleDeleteDoc(doc.id)}>
                      删除
                    </Button>
                  </div>
                ))
              )}
            </section>
          )}

          {panel === 'skills' && (
            <section className="agent-panel agent-form-panel">
              <Text strong>技能配置</Text>
              <Paragraph type="secondary">关闭技能后，对应生成步骤将跳过。</Paragraph>
              {config.skills.map((skill, idx) => (
                <div key={skill.key} className="agent-skill-edit">
                  <div className="agent-inline-row">
                    <Switch
                      checked={skill.enabled}
                      onChange={(checked) =>
                        patchConfig((c) => {
                          const skills = [...c.skills]
                          skills[idx] = { ...skills[idx], enabled: checked }
                          return { ...c, skills }
                        })
                      }
                    />
                    <Input
                      value={skill.label}
                      onChange={(e) =>
                        patchConfig((c) => {
                          const skills = [...c.skills]
                          skills[idx] = { ...skills[idx], label: e.target.value }
                          return { ...c, skills }
                        })
                      }
                      style={{ maxWidth: 160 }}
                    />
                  </div>
                  <Input
                    value={skill.detail}
                    placeholder="技能说明"
                    onChange={(e) =>
                      patchConfig((c) => {
                        const skills = [...c.skills]
                        skills[idx] = { ...skills[idx], detail: e.target.value }
                        return { ...c, skills }
                      })
                    }
                    style={{ marginBottom: 6 }}
                  />
                  <Input
                    value={skill.tool}
                    placeholder="对应工具"
                    onChange={(e) =>
                      patchConfig((c) => {
                        const skills = [...c.skills]
                        skills[idx] = { ...skills[idx], tool: e.target.value }
                        return { ...c, skills }
                      })
                    }
                  />
                </div>
              ))}

              <Text strong style={{ display: 'block', margin: '20px 0 8px' }}>
                工作流步骤
              </Text>
              {config.workflow.map((step, idx) => (
                <div key={step.key} className="agent-inline-row" style={{ alignItems: 'flex-start' }}>
                  <Switch
                    checked={step.enabled}
                    onChange={(checked) =>
                      patchConfig((c) => {
                        const workflow = [...c.workflow]
                        workflow[idx] = { ...workflow[idx], enabled: checked }
                        return { ...c, workflow }
                      })
                    }
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Input
                      value={step.title}
                      onChange={(e) =>
                        patchConfig((c) => {
                          const workflow = [...c.workflow]
                          workflow[idx] = { ...workflow[idx], title: e.target.value }
                          return { ...c, workflow }
                        })
                      }
                      style={{ marginBottom: 6 }}
                    />
                    <Input
                      value={step.desc}
                      onChange={(e) =>
                        patchConfig((c) => {
                          const workflow = [...c.workflow]
                          workflow[idx] = { ...workflow[idx], desc: e.target.value }
                          return { ...c, workflow }
                        })
                      }
                    />
                  </div>
                </div>
              ))}
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                保存技能与工作流
              </Button>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
