import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

// PlanSidebar 站点区用 next/link（app router 上下文在 jsdom 不存在），替换为普通 a
vi.mock('next/link', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode }) => <a {...props} />,
}))

/** 登录弹窗自身有独立用例；这里只关心「打开了」以及登录成功后的回调链路 */
vi.mock('@/components/auth/LoginModal', () => ({
  default: (props: { open: boolean; onClose: () => void; onSuccess: () => void }) =>
    props.open ? (
      <div data-testid="login-modal">
        <button type="button" onClick={props.onSuccess}>
          模拟登录成功
        </button>
      </div>
    ) : null,
}))

import PlanStartView from '@/components/plan/PlanStartView'
import { parseStartLocale } from '@/app/(plan-start)/plan/start/locale'
import { PENDING_DRAFT_KEY } from '@/app/(authed)/plan/[id]/hooks/usePendingDraft'
import type { PlanSidebarPlan } from '@/app/(authed)/plan/[id]/components/PlanSidebar'

const DRAFT = '圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》，顺便逛秋叶原'

const ZH_SUGGESTIONS = [
  '东京 5 天，把《你的名字。》的取景地走一遍',
  '京都、宇治两天，《吹响！上低音号》圣地巡礼',
  '山梨三天自驾，跟着《摇曳露营△》去富士五湖',
  '我只有一个周末，从东京出发帮我挑一条',
]

function samplePlans(): PlanSidebarPlan[] {
  return [
    { id: 'p1', title: '京都三日', updatedAt: new Date().toISOString() },
    { id: 'p2', title: '东京五日', updatedAt: new Date(Date.now() - 86_400_000).toISOString() },
  ]
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** 每次调用返回新 Response（body 只能消费一次，共享实例会让后读的请求炸掉） */
function createdResponse() {
  return new Response(JSON.stringify({ plan: { id: 'plan-new' } }), { status: 201, headers: JSON_HEADERS })
}

function plansListResponse() {
  return new Response(JSON.stringify({ plans: [] }), { status: 200, headers: JSON_HEADERS })
}

function fetchUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** 登录成功会派发 PLANS_CHANGED：侧栏 GET /api/me/plans 与建计划 POST 同路径，按方法分发 */
function mockPlanStartFetch(fetchMock: ReturnType<typeof vi.fn>, post: () => Response) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = fetchUrlOf(input)
    if (url === '/api/me/plans' && init?.method === 'POST') return Promise.resolve(post())
    if (url === '/api/me/plans') return Promise.resolve(plansListResponse())
    return Promise.resolve(new Response('{}', { status: 404, headers: JSON_HEADERS }))
  })
}

describe('规划师新对话首页（与对话页同一外壳，游客可进，发送时才登录）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    pushMock.mockReset()
    fetchMock.mockReset()
    mockPlanStartFetch(fetchMock, createdResponse)
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
    window.sessionStorage.clear()
  })

  it('外壳：侧栏在（站点导航 + 指向 /plan/start 的选中态「新对话」），全页唯一 h1 是入口名', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn={false} />)

    expect(screen.getByText('SeichiGo')).toBeInTheDocument()
    const newChat = screen.getByRole('link', { name: /新建对话/ })
    expect(newChat).toHaveAttribute('href', '/plan/start')
    expect(newChat).toHaveAttribute('aria-current', 'page')

    const h1s = document.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('AI 规划')
  })

  it('游客侧栏：提示 + 登录按钮（点击打开登录弹窗），不渲染计划列表', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn={false} />)

    expect(screen.getByText('登录后这里会显示你的最近对话')).toBeInTheDocument()
    expect(screen.queryByLabelText('巡礼计划会话列表')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByTestId('login-modal')).toBeInTheDocument()
  })

  it('登录态侧栏：渲染最近计划列表，没有游客提示', () => {
    render(<PlanStartView plans={samplePlans()} initialDraft="" signedIn />)

    expect(screen.getByText('京都三日')).toBeInTheDocument()
    expect(screen.getByText('东京五日')).toBeInTheDocument()
    expect(screen.queryByText('登录后这里会显示你的最近对话')).toBeNull()
  })

  it('主区：大标题 + 说明 + 输入框 + 四条建议行（点击填入并聚焦，不发送）', async () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn={false} />)

    expect(screen.getByRole('heading', { name: '这次想去哪里巡礼？' })).toBeInTheDocument()
    expect(
      screen.getByText('输入作品、目的地和天数，规划每天的巡礼路线与交通建议。登录后可生成并继续调整行程。'),
    ).toBeInTheDocument()

    const rows = ZH_SUGGESTIONS.map((text) => screen.getByRole('button', { name: text }))
    expect(rows).toHaveLength(4)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.click(rows[0]!)
    expect(textarea).toHaveValue(ZH_SUGGESTIONS[0])
    // applySuggestion 在 rAF 里聚焦并把光标移到文本末尾
    await waitFor(() => expect(textarea.selectionStart).toBe(ZH_SUGGESTIONS[0]!.length))
    expect(fetchMock).not.toHaveBeenCalled()

    // 再点另一行则替换
    fireEvent.click(rows[1]!)
    expect(textarea).toHaveValue(ZH_SUGGESTIONS[1])
    await waitFor(() => expect(textarea.selectionStart).toBe(ZH_SUGGESTIONS[1]!.length))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('?draft= 预填时建议行照常显示', () => {
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn={false} />)

    expect(screen.getByRole('textbox')).toHaveValue(DRAFT)
    for (const text of ZH_SUGGESTIONS) {
      expect(screen.getByRole('button', { name: text })).toBeInTheDocument()
    }
  })

  it('ja：整页取日文文案，「新对话」指向 /ja/plan/start，h1 是日文入口名', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn locale="ja" />)

    const h1s = document.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('AIプランナー')
    expect(screen.getByRole('heading', { name: '今回はどこへ巡礼しますか？' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /新しいチャット/ })).toHaveAttribute('href', '/ja/plan/start')
    expect(screen.getByRole('button', { name: '送信' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '京都・宇治の 2 日間、『響け！ユーフォニアム』聖地巡礼' })).toBeInTheDocument()
  })

  it('ja：站点导航与 logo 链接本地化（地图 /ja/map、logo /ja，/me 不加前缀）', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn locale="ja" />)

    expect(screen.getByRole('link', { name: /SeichiGo/ })).toHaveAttribute('href', '/ja')
    expect(screen.getByRole('link', { name: 'マップ' })).toHaveAttribute('href', '/ja/map')
    expect(screen.getByRole('link', { name: '記事' })).toHaveAttribute('href', '/ja')
    expect(screen.getByRole('link', { name: '都市' })).toHaveAttribute('href', '/ja/city')
    expect(screen.getByRole('link', { name: 'マイページ' })).toHaveAttribute('href', '/me')
  })

  it('en：「新对话」指向 /en/plan/start，h1 是英文入口名', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn locale="en" />)

    const h1s = document.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('AI Planner')
    expect(screen.getByRole('heading', { name: 'Where are we going this time?' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /New chat/ })).toHaveAttribute('href', '/en/plan/start')
  })

  it('游客发送 → 弹登录；不建计划', () => {
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn={false} />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(screen.getByTestId('login-modal')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('登录成功后不刷新页面，直接建计划、写 pending draft 并进入计划页', async () => {
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn={false} />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(screen.getByRole('button', { name: '模拟登录成功' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))
    // 登录成功同时让侧栏刷新最近对话（GET）；建计划是其中的 POST
    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(postCall?.[0]).toBe('/api/me/plans')
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({ title: DRAFT.slice(0, 30) })

    const pending = JSON.parse(window.sessionStorage.getItem(PENDING_DRAFT_KEY) ?? 'null')
    expect(pending.text).toBe(DRAFT)
    expect(typeof pending.createdAt).toBe('number')
  })

  it('中-1：登录成功后 signedIn 变本地 state——重试时不再弹登录', async () => {
    // 第一次创建失败（busy 会放开），登录态本身已经拿到了
    let postCount = 0
    mockPlanStartFetch(fetchMock, () => {
      postCount += 1
      if (postCount === 1) {
        return new Response(JSON.stringify({ error: '创建失败，请稍后再试' }), { status: 500, headers: JSON_HEADERS })
      }
      return createdResponse()
    })
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn={false} />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(screen.getByRole('button', { name: '模拟登录成功' }))
    expect(await screen.findByText('创建失败，请稍后再试')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(screen.queryByTestId('login-modal')).toBeNull()
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))
    expect(postCount).toBe(2)
  })

  it('中-8：成功建计划后不放开 busy——跳转期间发送钮已换成停止钮，只建一个计划', async () => {
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))

    // busy 保持 true：PlanComposer 把发送钮换成停止钮，无法再次触发创建
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('中-2：输入法组词中的回车不发送', () => {
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn />)
    const textarea = screen.getByRole('textbox')

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('已登录直接建计划，不弹窗', async () => {
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/plan/plan-new'))
    expect(screen.queryByTestId('login-modal')).toBeNull()
  })

  it('429（每日上限）显示提示且不跳转', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: '今日创建计划次数已达上限，明天再来吧' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<PlanStartView plans={[]} initialDraft={DRAFT} signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('今日创建计划次数已达上限，明天再来吧')).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('空输入不发送（发送钮禁用）', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn />)

    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})

describe('syncLocaleCookie：三个入口都把路径语言落到 NEXT_LOCALE cookie', () => {
  beforeEach(() => {
    // jsdom 的 document.cookie 不能整体清空，逐个过期即可
    for (const pair of document.cookie.split(';')) {
      const name = pair.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; path=/; max-age=0`
    }
  })

  it('syncLocaleCookie 为 true 时写 cookie', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn locale="ja" syncLocaleCookie />)
    expect(document.cookie).toContain('NEXT_LOCALE=ja')
  })

  it('不传时不写 cookie（prop 关闭时不固化语言）', () => {
    render(<PlanStartView plans={[]} initialDraft="" signedIn locale="ja" />)
    expect(document.cookie).not.toContain('NEXT_LOCALE')
  })
})

describe('parseStartLocale（旧 ?locale= 协议：只认三种语言）', () => {
  it('认识 en/ja/zh，其余返回 null 由中文页面留在中文', () => {
    expect(parseStartLocale('en')).toBe('en')
    expect(parseStartLocale('ja')).toBe('ja')
    expect(parseStartLocale(['ja', 'en'])).toBe('ja')
    expect(parseStartLocale(undefined)).toBeNull()
    expect(parseStartLocale('de')).toBeNull()
    expect(parseStartLocale('')).toBeNull()
  })
})
