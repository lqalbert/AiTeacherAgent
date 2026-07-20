export type AgentRoleConfig = {
  name: string
  opening: string
  mission: string
  persona: string
  boundaries: string
}

export type AgentEvalDimension = {
  key: string
  label: string
  enabled: boolean
}

export type AgentReportSection = {
  enabled: boolean
  label: string
}

export type AgentHomeworkType = {
  type: string
  label: string
  count: number
  enabled: boolean
}

export type AgentSkillConfig = {
  key: string
  label: string
  detail: string
  tool: string
  enabled: boolean
}

export type AgentWorkflowStep = {
  key: string
  title: string
  desc: string
  enabled: boolean
}

export type AgentConfig = {
  role: AgentRoleConfig
  evaluation: {
    standards: string
    dimensions: AgentEvalDimension[]
  }
  report: {
    sections: Record<string, AgentReportSection>
  }
  homework: {
    types: AgentHomeworkType[]
  }
  skills: AgentSkillConfig[]
  workflow: AgentWorkflowStep[]
}

export type KnowledgeDoc = {
  id: string
  title: string
  filename: string
  storedName: string
  createdAt: string
  charCount: number
  hasText: boolean
}
