import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AskCard, type AskAnswer } from '@/app/(authed)/plan/[id]/components/AskCard'
import type { AskUserPayload } from '@/lib/planAgent/askUser'

function datePayload(overrides?: Partial<AskUserPayload>): AskUserPayload {
  return { askId: 'ask-1', kind: 'date_range', taskType: 'date_range', prompt: '打算什么时候出发？', allowSkip: true, ...overrides }
}

function choicePayload(kind: 'single_choice' | 'multi_choice'): AskUserPayload {
  return {
    askId: 'ask-2',
    kind,
    taskType: 'work_selection',
    prompt: '想巡礼哪几部？',
    options: [
      { id: 'a', label: '吹响吧！上低音号' },
      { id: 'b', label: '轻音少女', sublabel: '丰乡小学校' },
      { id: 'c', label: '玉子市场' },
    ],
  }
}

function opinionPayload(kind: 'single_choice' | 'multi_choice'): AskUserPayload {
  return {
    askId: 'ask-3',
    kind,
    taskType: 'opinion',
    prompt: '这次山区行程以什么交通方式为主？',
    options: [
      { id: 'car', label: '自驾/租车', sublabel: '山区公交班次少，自驾最灵活', preferenceOnly: true },
      { id: 'transit', label: '公共交通', sublabel: '经济但换乘耗时', preferenceOnly: true },
      { id: 'mix', label: '混合方式', sublabel: '城市段公交+山区段租车', preferenceOnly: true },
      { id: '__custom__', label: '其他（自行输入）' },
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

describe('ChoiceAsk（single_choice，始终多选交互）', () => {
  it('点一张不自动提交；确认后按契约回传 { optionId }', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={choicePayload('single_choice')} onSubmit={onSubmit} />)
    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: /轻音少女/ }))
    // 多选交互：点选只切换选中态，不触发提交
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('已选 1 项')).toBeTruthy()

    fireEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // single_choice 恰好选 1 项 → 保持 { optionId } 契约
    expect(onSubmit.mock.calls[0][0]).toEqual({ readableText: '轻音少女', answerValue: { optionId: 'b' } })
  })

  it('single_choice 选两张再确认回传 { optionIds }，readableText 顿号拼接两个 label', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={choicePayload('single_choice')} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: /轻音少女/ }))
    fireEvent.click(screen.getByRole('button', { name: /玉子市场/ }))
    expect(screen.getByText('已选 2 项')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toEqual({
      readableText: '轻音少女、玉子市场',
      answerValue: { optionIds: ['b', 'c'] },
    })
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

describe('ChoiceAsk（最终澄清：作品卡没有自定义卡）', () => {  it('不渲染"其他（自行输入）"选项卡或卡内输入框——自由文本由全局输入框兜底', () => {
    const { container } = render(<AskCard payload={choicePayload('single_choice')} onSubmit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /其他（自行输入）/ })).toBeNull()
    expect(screen.queryByText('其他（自行输入）')).toBeNull()
    expect(screen.queryByPlaceholderText('输入你的回答…')).toBeNull()
    // 也没有意见卡样式的虚线自定义行
    expect(container.querySelectorAll('.border-dashed').length).toBe(0)
    // 三张作品封面卡照常在场
    expect(screen.getByRole('button', { name: /吹响吧！上低音号/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /轻音少女/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /玉子市场/ })).toBeTruthy()
  })

  it('历史残留的 __custom__ 选项被隐藏/忽略——旧作品卡 UI 不变', () => {
    const stale = choicePayload('multi_choice')
    stale.options = [
      ...(stale.options ?? []),
      { id: '__custom__', label: '其他（自行输入）' },
    ]
    const { container } = render(<AskCard payload={stale} onSubmit={vi.fn()} />)
    expect(screen.queryByText('其他（自行输入）')).toBeNull()
    expect(container.querySelectorAll('.border-dashed').length).toBe(0)
    // 保留项不参与选择与提交：仍只有三张模型卡
    const cards = screen.getAllByRole('button').filter((b) => b.textContent && /吹响吧|轻音少女|玉子市场/.test(b.textContent))
    expect(cards).toHaveLength(3)
  })
})

describe('OpinionChoiceAsk（taskType=opinion）', () => {
  it('文本优先渲染：无 img、无 3:4 封面、无首字渐变占位，选项带 A/B/C 顺序标识与 sublabel', () => {
    const { container } = render(<AskCard payload={opinionPayload('single_choice')} onSubmit={vi.fn()} />)
    expect(screen.getByText('这次山区行程以什么交通方式为主？')).toBeTruthy()
    // 绝不出现作品封面语义：无图片元素、无 3:4 比例类、无渐变占位
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('aspect-[3/4]')
    expect(container.querySelectorAll('.bg-gradient-to-br').length).toBe(0)
    // 文本选项与顺序标识、sublabel 都在场
    expect(screen.getByText('自驾/租车')).toBeTruthy()
    expect(screen.getByText('山区公交班次少，自驾最灵活')).toBeTruthy()
    expect(screen.getByText('公共交通')).toBeTruthy()
    expect(screen.getByText('混合方式')).toBeTruthy()
    const markers = Array.from(container.querySelectorAll('[aria-hidden]'))
      .map((el) => el.textContent?.trim())
      .filter((t) => /^[A-Z]$/.test(t ?? ''))
    expect(markers).toEqual(['A', 'B', 'C'])
    // 末位自定义入口在场且仍是最后一个选项
    const buttons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent && !b.textContent.includes('跳过'))
    expect(buttons[buttons.length - 1]?.textContent).toContain('其他（自行输入）')
  })

  it('单选：点选后延迟提交 optionId', () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={opinionPayload('single_choice')} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: /公共交通/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toEqual({ readableText: '公共交通', answerValue: { optionId: 'transit' } })
  })

  it('多选：勾选后经确认提交 optionIds', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={opinionPayload('multi_choice')} onSubmit={onSubmit} />)
    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: /自驾\/租车/ }))
    fireEvent.click(screen.getByRole('button', { name: /混合方式/ }))
    expect(screen.getByText('已选 2 项')).toBeTruthy()
    fireEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toEqual({
      readableText: '自驾/租车、混合方式',
      answerValue: { optionIds: ['car', 'mix'] },
    })
  })

  it('末位自定义入口打开卡内输入框，回传 { custom }', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={opinionPayload('single_choice')} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: /其他（自行输入）/ }))
    const input = screen.getByPlaceholderText('输入你的回答…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '包车带司机' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(onSubmit).toHaveBeenCalledWith({ readableText: '包车带司机', answerValue: { custom: '包车带司机' } })
  })

  it('多选 + 自定义输入可以并存提交', () => {
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    render(<AskCard payload={opinionPayload('multi_choice')} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: /自驾\/租车/ }))
    fireEvent.click(screen.getByRole('button', { name: /其他（自行输入）/ }))
    const input = screen.getByPlaceholderText('补充自定义内容（可与所选选项并存）') as HTMLInputElement
    fireEvent.change(input, { target: { value: '夜行巴士' } })
    // 卡内输入行与底部确认条都会出现"确认"（两者都走 submitMulti），取最后一个
    const confirmButtons = screen.getAllByRole('button', { name: '确认' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!)
    expect(onSubmit).toHaveBeenCalledWith({
      readableText: '自驾/租车、自定义：夜行巴士',
      answerValue: { optionIds: ['car'], custom: '夜行巴士' },
    })
  })
})

describe('ChoiceAsk 封面稳定性（R4）', () => {
  it('封面加载成功后父组件 rerender 不重挂载 img', async () => {
    const payload = choicePayload('single_choice')
    payload.options = [
      { id: 'a', label: '吹响吧！上低音号', image: 'https://image.anitabi.cn/bangumi/115908.jpg' },
      { id: 'b', label: '轻音少女', sublabel: '丰乡小学校' },
    ]
    const onSubmit = vi.fn<(answer: AskAnswer) => void>()
    const { rerender } = render(<AskCard payload={payload} onSubmit={onSubmit} />)

    // ResilientMapImage 的请求槽分配是异步的，用 findBy 等待封面 img 出现
    const img = await screen.findByAltText('吹响吧！上低音号')
    fireEvent.load(img)

    // 父组件 rerender（轮询/消息流更新）：option.id 作为 key，封面卡不重挂载
    rerender(<AskCard payload={{ ...payload }} onSubmit={onSubmit} />)
    expect(screen.getByAltText('吹响吧！上低音号')).toBe(img)
  })
})
