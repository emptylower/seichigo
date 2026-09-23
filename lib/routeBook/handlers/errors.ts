import { NextResponse } from 'next/server'
import { DAY_ITEM_LIMIT, PLACE_LIMIT, RouteBookRuleError } from '@/lib/routeBook/repo'

type UnknownRecord = Record<string, unknown>

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === 'object' && v !== null
}

/** RouteBookRuleError → 明确 status + 中文文案；基础设施错误 → 503/500。所有新路由的 catch 都用它 */
export function routeBookErrorResponse(err: unknown): NextResponse {
  if (err instanceof RouteBookRuleError) {
    switch (err.reason) {
      case 'day_limit':
        return NextResponse.json({ error: `这一天最多 ${DAY_ITEM_LIMIT} 条`, reason: 'day_limit' }, { status: 400 })
      case 'place_limit':
        return NextResponse.json({ error: `自定义点最多 ${PLACE_LIMIT} 个`, reason: 'place_limit' }, { status: 400 })
      case 'anchor_order':
        return NextResponse.json({ error: err.message, reason: 'anchor_order' }, { status: 409 })
      case 'day_not_empty':
        return NextResponse.json({ error: '先清空这一天再删除', reason: 'day_not_empty' }, { status: 400 })
      case 'lodging_overlap':
        return NextResponse.json({ error: '住宿日期与已有住宿重叠', reason: 'lodging_overlap' }, { status: 400 })
      case 'stale':
        return NextResponse.json({ error: '行程已在别处修改，请刷新', reason: 'stale' }, { status: 409 })
      case 'not_found':
        return NextResponse.json({ error: '行程不存在', reason: 'not_found' }, { status: 404 })
      case 'invalid':
        return NextResponse.json({ error: err.message || '参数错误', reason: 'invalid' }, { status: 400 })
    }
  }

  if (isRecord(err)) {
    const code = typeof err.code === 'string' ? err.code : ''
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
    }
    const message = typeof err.message === 'string' ? err.message : ''
    if (message.includes('Environment variable not found') && message.includes('DATABASE_URL')) {
      return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
    }
  }

  return NextResponse.json({ error: '服务器错误' }, { status: 500 })
}
