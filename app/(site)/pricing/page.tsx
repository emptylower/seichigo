import Link from 'next/link'
import { Check, Minus } from 'lucide-react'

export const metadata = { title: '套餐 · SeichiGo' }

type Row = { label: string; free: string | boolean; standard: string | boolean; pro: string | boolean }

const ROWS: Row[] = [
  { label: 'AI 巡礼规划、追问与重生成', free: true, standard: true, pro: true },
  { label: '点位、封面与日程排布', free: true, standard: true, pro: true },
  { label: '地点解析与照片', free: true, standard: true, pro: true },
  { label: '餐厅推荐', free: false, standard: true, pro: true },
  { label: '交通信息', free: '参考估算', standard: '真实路线', pro: '真实路线 + 日本公交' },
  { label: '酒店与航班建议', free: false, standard: false, pro: true },
  { label: '更多模型可选', free: false, standard: false, pro: true },
  { label: '单个行程天数', free: '最多 3 天', standard: '最多 7 天', pro: '不限' },
  { label: '每月 agent 用量', free: '体验额度', standard: '标准额度', pro: '大额度' },
]

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-brand-600" aria-label="包含" />
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-gray-300" aria-label="不包含" />
  return <span className="text-sm text-gray-700">{value}</span>
}

const COMING_SOON = '即将推出'

const TIERS = [
  { key: 'free', name: '免费', price: '$0', period: '', badge: null, cta: { label: '当前可用', href: '/plan', disabled: false, primary: false } },
  { key: 'standard', name: '标准', price: '$9.9', period: '/月', badge: null, cta: { label: '开通标准版', href: '/plan?upgrade=standard', disabled: false, primary: true } },
  { key: 'pro', name: '高级', price: '', period: '', badge: COMING_SOON, cta: { label: COMING_SOON, href: '#', disabled: true, primary: false } },
] as const

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900">选择你的巡礼规划套餐</h1>
      <p className="mt-2 text-sm text-gray-500">按月订阅，用量每月恢复。用量以百分比显示在 Plan 页与账户页。</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {TIERS.map((t) => (
          <section
            key={t.key}
            className={`rounded-2xl border p-5 ${t.cta.primary ? 'border-brand-300 bg-brand-50/40 shadow-sm' : 'border-pink-100 bg-white'} ${t.cta.disabled ? 'opacity-70' : ''}`}
          >
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              {t.name}
              {t.badge ? (
                <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
                  {t.badge}
                </span>
              ) : null}
            </h2>
            {t.price ? (
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {t.price}
                <span className="text-sm font-normal text-gray-400">{t.period}</span>
              </p>
            ) : null}
            {t.cta.disabled ? (
              <button
                type="button"
                disabled
                className="mt-4 w-full cursor-not-allowed rounded-full bg-gray-200 px-4 py-2 text-sm font-medium text-gray-500"
              >
                {t.cta.label}
              </button>
            ) : (
              <Link
                href={t.cta.href}
                className={`mt-4 block w-full rounded-full px-4 py-2 text-center text-sm font-medium ${t.cta.primary ? 'bg-brand-600 text-white hover:bg-brand-500' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                {t.cta.label}
              </Link>
            )}
          </section>
        ))}
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-pink-100 text-sm text-gray-500">
              <th className="py-2 pr-4 font-medium">功能</th>
              <th className="py-2 text-center font-medium">免费</th>
              <th className="py-2 text-center font-medium">标准</th>
              <th className="py-2 text-center font-medium">
                高级
                <span className="ml-1 rounded-full border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
                  {COMING_SOON}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-pink-50">
                <td className="py-3 pr-4 text-sm text-gray-800">{row.label}</td>
                <td className="py-3 text-center">
                  <Cell value={row.free} />
                </td>
                <td className="py-3 text-center">
                  <Cell value={row.standard} />
                </td>
                <td className="py-3 text-center">
                  <Cell value={row.pro} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-gray-500">高级档全部功能即将推出。</p>
      <p className="mt-2 text-xs text-gray-400">开通入口将在支付上线后开放；在此之前“开通标准版”仅跳转到规划页。</p>
    </main>
  )
}
