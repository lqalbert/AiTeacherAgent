import { ColorPicker, Form, Select, Slider } from 'antd'
import type { SubtitleStyle } from '../types'
import { DEFAULT_SUBTITLE_STYLE } from '../types'

const FONT_OPTIONS = [
  { value: '"HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif', label: 'HarmonyOS（B站默认）' },
  { value: '"Microsoft YaHei", "PingFang SC", sans-serif', label: '微软雅黑' },
  { value: '"PingFang SC", "Microsoft YaHei", sans-serif', label: '苹方' },
  { value: '"Noto Sans SC", sans-serif', label: '思源黑体' },
  { value: 'SimSun, serif', label: '宋体' },
  { value: 'KaiTi, serif', label: '楷体' },
]

type Props = {
  value: SubtitleStyle
  onChange: (style: SubtitleStyle) => void
}

export function SubtitleSettings({ value, onChange }: Props) {
  const update = (patch: Partial<SubtitleStyle>) => onChange({ ...value, ...patch })

  return (
    <Form layout="vertical" size="small" className="subtitle-settings-form">
      <Form.Item label="字体">
        <Select
          value={value.fontFamily}
          options={FONT_OPTIONS}
          onChange={(fontFamily) => update({ fontFamily })}
        />
      </Form.Item>
      <Form.Item label={`字号：${value.fontSize}px`}>
        <Slider
          min={16}
          max={48}
          value={value.fontSize}
          onChange={(fontSize) => update({ fontSize })}
        />
      </Form.Item>
      <Form.Item label="文字颜色">
        <ColorPicker
          value={value.color}
          onChange={(_, hex) => update({ color: hex })}
          showText
        />
      </Form.Item>
      <Form.Item label="实时字幕区背景" extra="课堂页右侧字幕区域背景色">
        <ColorPicker
          value={value.panelBackgroundColor || '#ffffff'}
          onChange={(_, hex) => update({ panelBackgroundColor: hex })}
          showText
        />
      </Form.Item>
      <Form.Item label="文字底衬颜色" extra="字幕文字背后的衬底（全屏与侧栏均生效）">
        <ColorPicker
          value={value.backgroundColor}
          onChange={(_, hex) => update({ backgroundColor: hex })}
          showText
        />
      </Form.Item>
      <Form.Item label={`文字底衬透明度：${Math.round(value.backgroundOpacity * 100)}%`}>
        <Slider
          min={0}
          max={0.75}
          step={0.05}
          value={Math.min(value.backgroundOpacity, 0.75)}
          onChange={(backgroundOpacity) => update({ backgroundOpacity })}
        />
      </Form.Item>
      <Form.Item label="全屏字幕位置" extra="仅在全屏放映 PPT 时生效">
        <Select
          value={value.position}
          options={[
            { value: 'bottom', label: '底部' },
            { value: 'top', label: '顶部' },
            { value: 'custom', label: '自定义（全屏时可拖拽）' },
          ]}
          onChange={(position) => update({ position })}
        />
      </Form.Item>
      <Form.Item>
        <a
          role="button"
          tabIndex={0}
          onClick={() => onChange({ ...DEFAULT_SUBTITLE_STYLE })}
          onKeyDown={(e) => e.key === 'Enter' && onChange({ ...DEFAULT_SUBTITLE_STYLE })}
        >
          恢复默认
        </a>
      </Form.Item>
    </Form>
  )
}
