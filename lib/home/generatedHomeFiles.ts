import clustersJson from '@/content/generated/home-map-clusters.json'
import heroDemoJson from '@/content/generated/home-hero-demo.json'
import mapWorldJson from '@/content/generated/home-map-world.json'
import showcaseJson from '@/content/generated/home-showcase.json'
import { HomeDataSourceError } from './dataSourceError'
import { parseHomeHeroDemo } from './heroDemo'
import { parseHomeMapClusters } from './mapClusters'
import { parseHomeMapWorld } from './mapWorld'
import { parseHomeShowcase } from './showcase'
import type { HomeHeroDemo, HomeMapClusters, HomeMapWorld, HomeShowcase } from './types'

/**
 * 首页生成产物在构建期内置（静态 import，同 lib/mdx/publicSnapshot.ts 的做法）：
 * Cloudflare Worker 运行时没有 fs，ISR 续期再读盘会 ENOENT。形状校验保留——
 * 非法即抛错（任一源失败整页拒绝），测试可通过 raw 参数注入非法载荷。
 */
export function readHomeShowcaseFile(raw: unknown = showcaseJson): HomeShowcase {
  const parsed = parseHomeShowcase(raw)
  if (!parsed) {
    throw new HomeDataSourceError(
      'home.showcase',
      'failure',
      new Error('invalid showcase payload (static import of content/generated/home-showcase.json)')
    )
  }
  return parsed
}

export function readHomeMapClustersFile(raw: unknown = clustersJson): HomeMapClusters {
  const parsed = parseHomeMapClusters(raw)
  if (!parsed) {
    throw new HomeDataSourceError(
      'home.mapClusters',
      'failure',
      new Error('invalid map clusters payload (static import of content/generated/home-map-clusters.json)')
    )
  }
  return parsed
}

export function readHomeHeroDemoFile(raw: unknown = heroDemoJson): HomeHeroDemo {
  const parsed = parseHomeHeroDemo(raw)
  if (!parsed) {
    throw new HomeDataSourceError(
      'home.heroDemo',
      'failure',
      new Error('invalid hero demo payload (static import of content/generated/home-hero-demo.json)')
    )
  }
  return parsed
}

/**
 * 静态世界地图是可选产物（A 部分脚本落盘）：与其它必选源不同，形状不合法时
 * 返回 null 而不是抛错，缺失只让第二屏退回不渲染，不影响其它数据源。
 */
export function readHomeMapWorldFile(raw: unknown = mapWorldJson): HomeMapWorld | null {
  return parseHomeMapWorld(raw)
}
