import type { PointContextDeps } from '@/lib/share/handlers/pointContext'

let cached: PointContextDeps | null = null

/**
 * point-context 自带一套 deps，不挂到 lib/share/api.ts 的 ShareApiDeps 上：
 * 那个类型被 v1 的四条路由与它们的单测共用，往里加必填字段会连带改动 v1 测试。
 */
export async function getPointContextDeps(): Promise<PointContextDeps> {
  if (cached) return cached

  const [{ PrismaPointContextRepo }, { fetchMapTilerAddresses }] = await Promise.all([
    import('@/lib/share/pointContextRepoPrisma'),
    import('@/lib/share/geocode'),
  ])

  cached = {
    repo: new PrismaPointContextRepo(),
    geocode: (input) => fetchMapTilerAddresses(input),
    now: () => new Date(),
  }

  return cached
}
