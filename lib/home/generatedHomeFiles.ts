import clustersJson from '@/content/generated/home-map-clusters.json'
import heroDemoJson from '@/content/generated/home-hero-demo.json'
import showcaseJson from '@/content/generated/home-showcase.json'
import { HomeDataSourceError } from './dataSourceError'
import { parseHomeHeroDemo } from './heroDemo'
import { parseHomeMapClusters } from './mapClusters'
import { parseHomeShowcase } from './showcase'
import type { HomeHeroDemo, HomeMapClusters, HomeShowcase } from './types'

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
