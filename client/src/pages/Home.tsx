import {
  DeleteOutlined,
  FileAddOutlined,
  FilePptOutlined,
  PlayCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSession, continueSession, deleteRound, deleteSession, listSessions } from '../api'
import { loadSubtitleStyle } from '../types'
import type { LessonRound, Session } from '../types'

const { Title, Paragraph, Text } = Typography

export function HomePage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()
  const [pptFile, setPptFile] = useState<File | null>(null)

  const fetchSessions = async () => {
    setLoading(true)
    try {
      const data = await listSessions()
      setSessions(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSessions()
  }, [])

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      if (!pptFile) {
        message.warning('请上传 .pptx 课件')
        return
      }
      setCreating(true)
      const fd = new FormData()
      fd.append('title', values.title)
      fd.append('ppt', pptFile)
      fd.append('pptOriginalName', pptFile.name)
      fd.append('subtitleStyle', JSON.stringify(loadSubtitleStyle()))
      const session = await createSession(fd)
      message.success('课程已创建')
      setModalOpen(false)
      form.resetFields()
      setPptFile(null)
      navigate(`/classroom/${session.id}`)
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  const handleContinue = async (item: Session) => {
    try {
      const nextRound = item.next_round_number ?? (item.current_round ?? 0) + 1
      await continueSession(item.id)
      message.success(`已开始第 ${nextRound} 节课`)
      navigate(`/classroom/${item.id}`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteSession(id)
      message.success('已删除')
      fetchSessions()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleDeleteRound = async (sessionId: number, roundNumber: number) => {
    try {
      await deleteRound(sessionId, roundNumber)
      message.success(`第 ${roundNumber} 节已删除`)
      fetchSessions()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const renderRoundItem = (item: Session, round: LessonRound) => {
    const isActive = round.status === 'active'

    return (
      <div key={round.id} className="round-list-item">
        <Space size="small" wrap>
          <Text>第 {round.round_number} 节</Text>
          <Tag color={isActive ? 'green' : 'default'}>{isActive ? '进行中' : '已结束'}</Tag>
          {round.has_analysis && <Tag color="blue">已有报告</Tag>}
          <Text type="secondary">
            {round.started_at}
            {round.ended_at ? ` → ${round.ended_at}` : ''}
          </Text>
          <Text type="secondary">{round.segment_count ?? 0} 条转写</Text>
        </Space>
        <Space size="small" wrap className="round-list-actions">
          {!isActive && (
            <Button
              type="link"
              size="small"
              icon={<FileAddOutlined />}
              onClick={() => navigate(`/report/${item.id}?round=${round.round_number}`)}
            >
              {round.has_analysis ? '查看报告' : '生成报告'}
            </Button>
          )}
          {!isActive && item.ppt_path && (
            <Button
              type="link"
              size="small"
              icon={<FilePptOutlined />}
              onClick={() => navigate(`/classroom/${item.id}?round=${round.round_number}`)}
            >
              课件回放
            </Button>
          )}
          <Popconfirm
            title={`确定删除第 ${round.round_number} 节？`}
            description="将同时删除该节的转写与报告，且不可恢复"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            disabled={isActive}
            onConfirm={() => handleDeleteRound(item.id, round.round_number)}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={isActive}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      </div>
    )
  }

  return (
    <div className="page home-page">
      <div className="page-header">
        <div>
          <Title level={2} style={{ margin: 0 }}>
            智能课堂助手
          </Title>
          <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
            PPT 放映 · 实时字幕 · AI 课后分析
          </Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setModalOpen(true)}>
          新建课程
        </Button>
      </div>

      <Card title="课程列表" loading={loading}>
        {sessions.length === 0 ? (
          <Empty description="暂无课程，点击「新建课程」开始" />
        ) : (
          <List
            dataSource={sessions}
            renderItem={(item) => {
              const endedRounds = item.ended_round_count ?? 0
              const inProgress = item.status !== 'ended'
              const rounds = item.rounds ?? []

              return (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space wrap className="session-title-row">
                        <Text strong>{item.title}</Text>
                        <Tag color={inProgress ? 'green' : 'default'}>
                          {inProgress
                            ? endedRounds > 0
                              ? `第 ${item.current_round ?? 1} 节 · 进行中（已完成 ${endedRounds} 节）`
                              : `第 ${item.current_round ?? 1} 节 · 进行中`
                            : `已结束 · 共 ${item.round_count ?? 1} 节`}
                        </Tag>
                        {inProgress ? (
                          <Button
                            type="link"
                            size="small"
                            icon={<PlayCircleOutlined />}
                            onClick={() => navigate(`/classroom/${item.id}`)}
                          >
                            继续上课
                          </Button>
                        ) : (
                          <Button
                            type="link"
                            size="small"
                            icon={<PlayCircleOutlined />}
                            onClick={() => handleContinue(item)}
                          >
                            继续上课（第{item.next_round_number ?? (item.current_round ?? 0) + 1}节）
                          </Button>
                        )}
                        <Popconfirm
                          title="确定删除该课程？"
                          description="将删除该课程下所有课次、转写与报告，且不可恢复"
                          okText="删除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => handleDelete(item.id)}
                        >
                          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    }
                    description={
                      <div className="session-rounds">
                        <Space split="·" style={{ marginBottom: rounds.length ? 8 : 0 }}>
                          <span>{item.ppt_filename || '无课件'}</span>
                          <span>{item.started_at}</span>
                          <span>{item.segment_count ?? 0} 条转写</span>
                        </Space>
                        {rounds.length > 0 && (
                          <div className="round-list">
                            {rounds.map((round) => renderRoundItem(item, round))}
                          </div>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              )
            }}
          />
        )}
      </Card>

      <Modal
        title="新建课程"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="开始上课"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="课程标题"
            rules={[{ required: true, message: '请输入课程标题' }]}
          >
            <Input placeholder="例如：高一数学 · 函数的概念" />
          </Form.Item>
          <Form.Item label="上传课件（.pptx）" required>
            <Upload
              accept=".pptx"
              maxCount={1}
              beforeUpload={(file) => {
                setPptFile(file)
                return false
              }}
              onRemove={() => setPptFile(null)}
              fileList={
                pptFile
                  ? [{ uid: '-1', name: pptFile.name, status: 'done' as const }]
                  : []
              }
            >
              <Button icon={<PlusOutlined />}>选择 PPT 文件</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
