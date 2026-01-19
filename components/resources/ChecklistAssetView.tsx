import type { AggregatedSpot, LinkAsset } from '@/lib/linkAsset/types'

type Props = {
  asset: LinkAsset
  spots: AggregatedSpot[]
}

export default function ChecklistAssetView({ spots }: Props) {
  return (
    <section className="space-y-6">
      <div className="card">
        <div className="text-sm font-semibold text-gray-900">可复制清单</div>
        <div className="mt-1 text-sm text-gray-700">后续可以增加“一键复制/打印友好”的样式；目前先提供清单结构。</div>
      </div>

      {spots.length ? (
        <div className="card">
          <ol className="space-y-2 text-sm text-gray-800">
            {spots.map((s, idx) => (
              <li key={`${s.fromArticleSlug || 'post'}-${s.fromRouteId || 'route'}-${idx}`}>
                {idx + 1}. {s.name_zh || s.name || `Spot ${idx + 1}`}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-12 text-center">
          <p className="text-gray-500">暂无点位可生成清单。</p>
        </div>
      )}
    </section>
  )
}
