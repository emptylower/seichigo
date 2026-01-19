import type { PostFrontmatter } from '@/lib/mdx/types'

type Props = {
  transport?: PostFrontmatter['transportation']
}

export default function TransportCard({ transport }: Props) {
  if (!transport) return null

  const icCard = typeof transport.icCard === 'string' ? transport.icCard.trim() : ''
  const lines = Array.isArray(transport.lines) ? transport.lines.map((x: string) => String(x || '').trim()).filter(Boolean) : []
  const tips = Array.isArray(transport.tips) ? transport.tips.map((x: string) => String(x || '').trim()).filter(Boolean) : []

  if (!icCard && lines.length === 0 && tips.length === 0) return null

  return (
    <div className="not-prose my-6 rounded-xl border border-blue-100 bg-blue-50/70 p-4 shadow-sm">
      <div className="text-sm font-semibold text-gray-900">🚃 交通指南</div>

      {icCard ? <div className="mt-2 text-sm text-gray-700">推荐 IC 卡：{icCard}</div> : null}

      {lines.length ? (
        <div className="mt-2">
          <div className="text-sm text-gray-700">涉及线路：</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {lines.map((line: string) => (
              <span key={line} className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-900">
                {line}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {tips.length ? (
        <div className="mt-3">
          <div className="text-sm text-gray-700">小贴士：</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {tips.map((tip: string, idx: number) => (
              <li key={`${idx}-${tip}`}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
