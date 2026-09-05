/**
 * DayCards 用 `next/dynamic` 懒加载 DayMap（高-2：MapLibre 不进首屏 chunk）。
 * 用例关心的是"切到地图 tab 看到什么"，不是这层懒加载本身，所以测试里把
 * `next/dynamic` 换成同步实现：本工厂先把 DayMap 真正载好，`dynamic(loader)`
 * 直接返回它——既有的同步断言不必改写成 `findBy*`。
 *
 * 用法（`vi.mock` 的工厂可以是 async）：
 *   vi.mock('next/dynamic', async () => (await import('./helpers/nextDynamicSync')).syncDynamicMock())
 */
export async function syncDynamicMock() {
  const { DayMap } = await import('@/app/(authed)/plan/[id]/components/DayMap')
  // loader 源码里出现哪个名字就返回哪个组件；没注册过的目标直接抛，
  // 避免以后新增 dynamic() 时悄悄渲染成空。
  const registry: Array<[string, unknown]> = [['DayMap', DayMap]]
  return {
    default: (loader: () => Promise<unknown>) => {
      const source = String(loader)
      const hit = registry.find(([name]) => source.includes(name))
      if (!hit) throw new Error(`nextDynamicSync: dynamic() 目标未注册 → ${source}`)
      return hit[1]
    },
  }
}
