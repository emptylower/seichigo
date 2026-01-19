import type { PostFrontmatter } from '@/lib/mdx/types'

type Props = {
  tips?: PostFrontmatter['photoTips']
}

export default function PhotoTipsList({ tips }: Props) {
  const list = Array.isArray(tips) ? tips.map((x) => String(x || '').trim()).filter(Boolean) : []
  if (!list.length) return null

  return (
    <div className="not-prose my-6 rounded-xl border border-amber-100 bg-amber-50/70 p-4 shadow-sm">
      <div className="text-sm font-semibold text-gray-900">📷 拍摄建议</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
        {list.map((tip, idx) => (
          <li key={`${idx}-${tip}`}>{tip}</li>
        ))}
      </ul>
    </div>
  )
}
