import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AskCard, type AskAnswer } from '@/app/(authed)/plan/[id]/components/AskCard'
import type { AskUserPayload } from '@/lib/planAgent/askUser'

function datePayload(overrides?: Partial<AskUserPayload>): AskUserPayload {
  return { askId: 'ask-1', kind: 'date_range', prompt: '打算什么时候出发？', allowSkip: true, ...overrides }
}

function choicePayload(kind: 'single_choice' | 'multi_choice'): AskUserPayload {
  return {
    askId: 'ask-2',
    kind,
    prompt: '想巡礼哪几部？',
    options: [
      { id: 'a', label: '吹响吧！上低音号' },
      { id: 'b', label: '轻音少女', sublabel: '丰乡小学校' },
      { id: 'c', label: '玉子市场' },
    ],
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DateRangeAsk（精确模式）', () => {
  it('选择起止日期后计算天数并按协议提交 startDate/dayCount', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={datePayload()} onSubmit={onSubmit} />)
    expect(screen.getByText('打算什么时候出发？')).toBeTruthy()
    // 确认按钮在选满日期前不可用
    expect(screen.getByRole('button', { name: '确认' })).toHaveProperty('disabled', true)

    // 切到下个月，避免点到已禁用的过去日期
    fireEvent.click(screen.getByRole('button', { name: '下个月' }))
    fireEvent.click(screen.getByRole('button', { name: '10' }))
    expect(screen.getByRole('button', { name: '确认' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '13' }))
    expect(screen.getByText('共 4 天')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const answer = onSubmit.mock.calls[0][0]
    const nextMonth = new Date()
    nextMonth.setDate(1)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const pad = (n: number) => String(n).padStart(2, '0')
    const expectedStart = `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-10`
    expect(answer.answerValue).toEqual({ startDate: expectedStart, dayCount: 4 })
    expect(answer.readableText).toContain(`${nextMonth.getFullYear()}年`)
    expect(answer.readableText).toContain('共4天')
  })

  it('allowSkip 时跳过提交空 answerValue', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={datePayload()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '跳过' }))
    expect(onSubmit).toHaveBeenCalledWith({ readableText: '（跳过这个问题）', answerValue: {} })
  })
})

describe('DateRangeAsk（模糊模式）', () => {
  it('月份 chips + 天数 stepper 提交纯 dayCount', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={datePayload()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '大概时间' }))

    // chips 按真实当前日期动态生成：本月 / 下个月
    const now = new Date()
    const thisMonthName = `${now.getMonth() + 1}月`
    expect(screen.getByRole('button', { name: new RegExp(`^本月（${thisMonthName}）$`) })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp('^下个月') }))

    // 默认 3 天，+1 → 4 天
    expect(screen.getByText('3 天')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '增加天数' }))
    expect(screen.getByText('4 天')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const answer = onSubmit.mock.calls[0][0]
    expect(answer.answerValue).toEqual({ dayCount: 4 })
    expect(answer.readableText).toBe('大概下个月出发，玩4天')
  })
})

describe('ChoiceAsk（single_choice）', () => {
  it('点击卡片后短暂延迟自动提交 optionId', () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={choicePayload('single_choice')} onSubmit={onSubmit} />)
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /轻音少女/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toEqual({ readableText: '轻音少女', answerValue: { optionId: 'b' } })
  })
})

describe('ChoiceAsk（multi_choice）', () => {
  it('多选后经确认条提交 optionIds，可读文本顿号连接', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={choicePayload('multi_choice')} onSubmit={onSubmit} />)
    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: /玉子市场/ }))
    fireEvent.click(screen.getByRole('button', { name: /吹响吧！上低音号/ }))
    expect(screen.getByText('已选 2 项')).toBeTruthy()

    fireEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // optionIds 按 options 原始顺序（a、c），与点击顺序无关
    expect(onSubmit.mock.calls[0][0]).toEqual({
      readableText: '吹响吧！上低音号、玉子市场',
      answerValue: { optionIds: ['a', 'c'] },
    })
  })

  it('再次点击取消选中', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={choicePayload('multi_choice')} onSubmit={onSubmit} />)
    const card = screen.getByRole('button', { name: /玉子市场/ })
    fireEvent.click(card)
    fireEvent.click(card)
    expect(screen.getByText('已选 0 项')).toBeTruthy()
    expect(screen.getByRole('button', { name: '确认' })).toHaveProperty('disabled', true)
  })
})
