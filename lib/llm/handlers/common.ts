import { NextResponse } from 'next/server'

/** 管理会话判断（复制自 translation 域同款，不跨域引用）。 */
export function isAdminSession(session: unknown): boolean {
  const user = (session as { user?: { isAdmin?: unknown } } | null)?.user
  return Boolean(user?.isAdmin)
}

/** 路由层错误映射：迁移未跑（P2021/P2022）→ 503 提示先执行迁移。 */
export function routeError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'P2021' || code === 'P2022') {
    return NextResponse.json(
      { error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' },
      { status: 503 },
    )
  }
  const message = String((error as { message?: unknown } | null)?.message || '')
  if (message.includes('Environment variable not found') && message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
