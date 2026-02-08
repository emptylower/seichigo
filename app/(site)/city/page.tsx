import { getCityCountsByLocale } from '@/lib/city/getCityCountsByLocale'
import { buildZhAlternates } from '@/lib/seo/alternates'
import CityCard from '@/components/city/CityCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '城市索引｜按目的地浏览圣地巡礼路线',
  description:
    '按城市聚合已发布的圣地巡礼路线与文章：快速查看东京、京都等目的地的取景点位清单、路线建议与地图导航入口，适合做行程规划与落地执行。',
  alternates: buildZhAlternates({ path: '/city' }),
  openGraph: {
    type: 'website',
    url: '/city',
    title: '城市索引',
    description:
      '按城市聚合已发布的圣地巡礼路线与文章：快速查看东京、京都等目的地的取景点位清单、路线建议与地图导航入口，适合做行程规划与落地执行。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '城市索引',
    description:
      '按城市聚合已发布的圣地巡礼路线与文章：快速查看东京、京都等目的地的取景点位清单、路线建议与地图导航入口，适合做行程规划与落地执行。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 3600
export const dynamic = 'force-static'

export default async function CityIndexPage() {
  const { cities, counts } = await getCityCountsByLocale('zh')

  const sorted = [...cities].sort((a, b) => {
    const ca = counts[a.id] || 0
    const cb = counts[b.id] || 0
    if (ca !== cb) return cb - ca
    return a.name_zh.localeCompare(b.name_zh)
  })

  return (
    <div>
      <h1 className="text-2xl font-bold">城市</h1>
      <div className="mt-2 text-sm text-gray-600">按目的地聚合路线与点位清单，优先围绕长尾词（地区/线路/地图）。</div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c) => (
            <CityCard key={c.id} city={c} postCount={counts[c.id] || 0} />
          ))}
        </div>

      {!sorted.length ? <div className="mt-8 text-gray-500">暂无城市元数据。</div> : null}
    </div>
  )
}
