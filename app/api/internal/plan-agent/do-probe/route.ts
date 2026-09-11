import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'

export const runtime = 'nodejs'

/**
 * DO 派发耗时诊断探针（2026-09-11）：生产实测 doIngressMs 1034–1090ms、
 * 且 moduleId 每次都变，需要区分这 1.0s 到底是
 * (a) 全新 isolate / 模块求值、(b) 新 SQLite DO id 的首次落地创建、还是
 * (c) 纯 RPC 往返。按 id 策略分别打 stub.fetch('https://do/ping')：
 * - freshA / freshA2：全新随机 id 的第一次与紧接着的第二次（差值 = 首次创建成本）
 * - fixed1 / fixed2：固定名 'probe:fixed'（跨请求已存在的实例）
 * - freshB：再来一个全新 id（验证首次成本可复现）
 * 只读不写：/ping 分支不落 storage、不设 alarm，与真实派发路径零交叉。
 */

/** 与 app/api/internal/plan-agent/run/route.ts 完全一致的常量时间比较 */
function secretsMatch(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false
  return timingSafeEqual(aBytes, bBytes)
}

type ProbeStub = { fetch(input: string, init?: RequestInit): Promise<Response> }

type ProbeResult = { label: string; ms: number; body: unknown }

async function ping(label: string, stub: ProbeStub): Promise<ProbeResult> {
  const startedAt = Date.now()
  const res = await stub.fetch('https://do/ping')
  const ms = Date.now() - startedAt
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { label, ms, body }
}

export async function GET(req: Request) {
  const secret = process.env.PLAN_AGENT_INTERNAL_SECRET
  if (!secret) {
    console.error('[api/internal/plan-agent/do-probe] PLAN_AGENT_INTERNAL_SECRET 未配置')
    return NextResponse.json({ error: 'internal secret not configured' }, { status: 503 })
  }
  const provided = req.headers.get('x-plan-agent-secret')
  if (provided === null || !secretsMatch(provided, secret)) {
    console.error('[api/internal/plan-agent/do-probe] 密钥不匹配，拒绝探测')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 与 lib/planAgent/dispatch.ts 同源：DO namespace 来自 OpenNext 注入的
  // Cloudflare 上下文（getCfBindings()?.env.PLAN_RUN_DISPATCHER）
  const namespace = getCfBindings()?.env?.PLAN_RUN_DISPATCHER
  if (!namespace) {
    return NextResponse.json({ error: 'PLAN_RUN_DISPATCHER binding missing' }, { status: 503 })
  }

  const freshAStub = namespace.get(namespace.idFromName(crypto.randomUUID()))
  const fixedStub = namespace.get(namespace.idFromName('probe:fixed'))
  const freshBStub = namespace.get(namespace.idFromName(crypto.randomUUID()))

  const results: ProbeResult[] = []
  results.push(await ping('freshA', freshAStub))
  results.push(await ping('freshA2', freshAStub))
  results.push(await ping('fixed1', fixedStub))
  results.push(await ping('fixed2', fixedStub))
  results.push(await ping('freshB', freshBStub))

  const colo = (req as Request & { cf?: { colo?: string } }).cf?.colo ?? null
  return NextResponse.json({ colo, results })
}
