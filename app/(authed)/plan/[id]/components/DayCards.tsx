'use client'

import type { TripPlanView } from '@/lib/tripPlan/view'

const TYPE_LABELS: Record<string, string> = {
  point: '点位',
  transit: '交通',
  meal: '用餐',
  lodging: '住宿',
  attraction: '景点',
  free: '自由',
}

export function DayCards(props: {
  plan: TripPlanView
  selectedDay: number
  onSelectDay: (dayIndex: number) => void
}) {
  const { plan, selectedDay, onSelectDay } = props

  if (!plan.days.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        还没有行程——在左侧告诉规划师你想去哪、巡礼哪部作品吧。
      </div>
    )
  }

  const active = plan.days.find((d) => d.dayIndex === selectedDay) ?? plan.days[0]!

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {plan.days.map((day) => (
          <button
            key={day.id}
            type="button"
            onClick={() => onSelectDay(day.dayIndex)}
            className={
              day.dayIndex === active.dayIndex
                ? 'rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-600 hover:border-brand-300'
            }
          >
            {`Day ${day.dayIndex}`}
          </button>
        ))}
      </div>

      {active.summary ? <p className="text-sm font-medium text-gray-700">{active.summary}</p> : null}

      <ol className="space-y-3">
        {active.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              {item.timeHint ? <span className="text-xs text-gray-400">{item.timeHint}</span> : null}
              <span className="font-semibold text-gray-900">{item.title}</span>
            </div>
            {item.note ? <p className="mt-1 text-xs text-gray-500">{item.note}</p> : null}
            {item.reason ? <p className="mt-1 text-xs text-brand-600">{item.reason}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
