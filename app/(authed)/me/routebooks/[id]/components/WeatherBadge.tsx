'use client'

import type { SupportedLocale } from '@/lib/i18n/types'
import type { WeatherDay } from '../hooks/useWeather'
import { tr } from '../../i18n'

/** WMO weather code → emoji（Open-Meteo daily weather_code） */
export function weatherEmoji(code: number): string {
  if (code === 0) return '☀️'
  if (code >= 1 && code <= 3) return '⛅'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌦️'
  if (code === 85 || code === 86) return '❄️'
  if (code >= 95 && code <= 99) return '⛈️'
  return '☁️'
}

type Props = {
  weather: WeatherDay
  locale?: SupportedLocale
  /** 只显示 emoji（天胶囊等窄位） */
  compact?: boolean
  className?: string
}

/** 「⛅ 22°/15°」天气徽标 */
export function WeatherBadge({ weather, locale = 'zh', compact = false, className = '' }: Props) {
  const max = Math.round(weather.tMax)
  const min = Math.round(weather.tMin)
  const label = tr('routebook.weather.ariaLabel', locale, { max, min })
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-medium text-slate-500 ${className}`}
    >
      <span aria-hidden="true">{weatherEmoji(weather.code)}</span>
      {compact ? null : (
        <span aria-hidden="true">
          {max}°/{min}°
        </span>
      )}
    </span>
  )
}
