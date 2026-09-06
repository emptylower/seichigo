import { describe, it, expect } from 'vitest'
import { PLAN_AGENT_SYSTEM_PROMPT } from '@/lib/planAgent/prompt'

describe('PLAN_AGENT_SYSTEM_PROMPT 回复语言段', () => {
  it('语气段的"中文回复，"指令已删除', () => {
    // 注：追加的回复语言段含"要用中文回复"字样（计划原文如此），此处断言
    // 的是原语气段那条指令句式 "中文回复，" 不复存在
    expect(PLAN_AGENT_SYSTEM_PROMPT).not.toContain('中文回复，')
  })

  it('末尾追加了"## 回复语言"段', () => {
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('## 回复语言')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('不要被它们带偏')
    expect(PLAN_AGENT_SYSTEM_PROMPT.trimEnd().endsWith('餐食条目标题用该语言的“午餐 / 晚餐”对应词。')).toBe(true)
  })

  it('其余段落原样保留', () => {
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('## 工作流程（严格遵守）')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('## 语气')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('## 事实与来源')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('## 强制 ask_user 提问协议')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('## 交通方式与偏远地区')
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('## 行程编排规则')
  })

  it('语气段首条去掉"中文回复，"后其余保留', () => {
    expect(PLAN_AGENT_SYSTEM_PROMPT).toContain('- 热情但不啰嗦。懂圣地巡礼文化')
  })
})
