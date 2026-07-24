import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Typography, message } from 'antd'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const { Title } = Typography

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) {
    return <Navigate to="/" replace />
  }

  const onFinish = async (values: { username: string; password: string }) => {
    setSubmitting(true)
    try {
      await login(values.username.trim(), values.password)
      message.success('登录成功')
      navigate('/', { replace: true })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <Card className="login-card">
        <div className="login-brand">
          <div className="agent-console-avatar" aria-hidden>
            智
          </div>
          <Title level={3} style={{ margin: '12px 0 8px' }}>
            智课随行
          </Title>
          <Typography.Paragraph type="secondary" className="login-tagline">
            课中字幕 · 课后评课
          </Typography.Paragraph>
        </div>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false} style={{ marginTop: 8 }}>
          <Form.Item
            name="username"
            label="账号"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="账号" size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              size="large"
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            登录
          </Button>
          <Typography.Paragraph type="secondary" className="login-hint">
            演示账号：admin1 / admin123（或 admin2 / admin123）
          </Typography.Paragraph>
        </Form>
      </Card>
    </div>
  )
}
