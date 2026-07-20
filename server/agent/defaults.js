/** 智能体工作台默认配置（用户可在前端覆盖并持久化） */

export const DEFAULT_AGENT_CONFIG = {
  role: {
    name: '智课随行',
    opening:
      '你好，我是智课随行。请先完善角色与知识库配置，再进入课堂开始听课；结束后我会按你设定的报告项目与评价标准生成成长报告。',
    mission:
      '服务中职真实课堂：课中为学生提供实时字幕，课后为教师按自定义标准生成可成长的评课报告。',
    persona:
      '任务型教育智能体，不闲聊、不替代教师授课。\n严格依据课件原文、知识库资料与课堂转写证据作答，禁止凭标题臆造。\n课中优先低延迟听写；课后执行多技能教研编排。',
    boundaries:
      '不编造课堂上未出现的知识点或教学行为。\n按页无转写不等于未讲授，需结合完整转写与翻页证据。\n不做与本节课无关的通用百科问答。',
  },
  evaluation: {
    standards: `请从以下维度评价本节课，要求具体、可操作、基于课堂证据：
1. 教学内容：知识点是否准确、是否覆盖本节目标
2. 讲解逻辑：结构是否清晰、过渡是否自然
3. 重点把握：重点是否突出、时间分配是否合理
4. 语言表达：术语是否规范、是否存在口头冗余
5. 课堂节奏：翻页与讲授是否匹配、学生可跟进程度`,
    dimensions: [
      { key: 'content', label: '教学内容', enabled: true },
      { key: 'logic', label: '讲解逻辑', enabled: true },
      { key: 'focus', label: '重点把握', enabled: true },
      { key: 'expression', label: '语言表达', enabled: true },
    ],
  },
  report: {
    sections: {
      summary: { enabled: true, label: '课堂总结' },
      keyPoints: { enabled: true, label: '重点' },
      difficultPoints: { enabled: true, label: '难点' },
      evaluation: { enabled: true, label: '教学评价与建议' },
      mindMap: { enabled: true, label: '思维导图' },
      homework: { enabled: true, label: '课后作业' },
      knowledgeTags: { enabled: true, label: '知识点标签' },
    },
  },
  homework: {
    types: [
      { type: 'choice', label: '选择题', count: 3, enabled: true },
      { type: 'blank', label: '填空题', count: 2, enabled: true },
      { type: 'short', label: '简答题', count: 2, enabled: true },
    ],
  },
  skills: [
    {
      key: 'listen',
      label: '听写技能',
      detail: '实时转写与字幕上屏',
      tool: '麦克风 / 讯飞 ASR',
      enabled: true,
    },
    {
      key: 'align',
      label: '对齐技能',
      detail: '课件文本与口述时间轴对齐',
      tool: '翻页事件 + PPT 解析',
      enabled: true,
    },
    {
      key: 'evaluate',
      label: '评课技能',
      detail: '按评价标准生成亮点与改进建议',
      tool: 'DeepSeek 评课模块',
      enabled: true,
    },
    {
      key: 'structure',
      label: '结构技能',
      detail: '重难点提炼与思维导图',
      tool: '知识结构模块',
      enabled: true,
    },
    {
      key: 'quiz',
      label: '巩固技能',
      detail: '按题型与题量生成课后作业',
      tool: '出题模块',
      enabled: true,
    },
  ],
  workflow: [
    {
      key: 'sense',
      title: '感知',
      desc: '语音流 · PPT 翻页 · 课次状态',
      enabled: true,
    },
    {
      key: 'memory',
      title: '记忆',
      desc: '转写 · 时间轴 · 课次报告 · 知识库',
      enabled: true,
    },
    {
      key: 'reason',
      title: '推理',
      desc: '总结 · 评课 · 导图 · 出题',
      enabled: true,
    },
    {
      key: 'act',
      title: '行动',
      desc: '字幕上屏 · 报告 · 导出',
      enabled: true,
    },
  ],
}

export function mergeAgentConfig(raw) {
  const base = structuredClone(DEFAULT_AGENT_CONFIG)
  if (!raw || typeof raw !== 'object') return base

  if (raw.role && typeof raw.role === 'object') {
    base.role = { ...base.role, ...raw.role }
  }
  if (raw.evaluation && typeof raw.evaluation === 'object') {
    base.evaluation.standards =
      typeof raw.evaluation.standards === 'string'
        ? raw.evaluation.standards
        : base.evaluation.standards
    if (Array.isArray(raw.evaluation.dimensions)) {
      base.evaluation.dimensions = raw.evaluation.dimensions
    }
  }
  if (raw.report?.sections && typeof raw.report.sections === 'object') {
    for (const [key, val] of Object.entries(raw.report.sections)) {
      if (!base.report.sections[key]) continue
      if (typeof val === 'boolean') {
        base.report.sections[key].enabled = val
      } else if (val && typeof val === 'object') {
        base.report.sections[key] = { ...base.report.sections[key], ...val }
      }
    }
  }
  if (Array.isArray(raw.homework?.types)) {
    base.homework.types = raw.homework.types.map((t) => ({
      type: String(t.type || 'short'),
      label: String(t.label || t.type || '题目'),
      count: Math.max(0, Math.min(20, Number(t.count) || 0)),
      enabled: t.enabled !== false,
    }))
  }
  if (Array.isArray(raw.skills)) {
    base.skills = raw.skills.map((s) => ({
      key: String(s.key || s.label || Math.random()),
      label: String(s.label || ''),
      detail: String(s.detail || ''),
      tool: String(s.tool || ''),
      enabled: s.enabled !== false,
    }))
  }
  if (Array.isArray(raw.workflow)) {
    base.workflow = raw.workflow.map((s) => ({
      key: String(s.key || s.title || Math.random()),
      title: String(s.title || ''),
      desc: String(s.desc || ''),
      enabled: s.enabled !== false,
    }))
  }
  return base
}
