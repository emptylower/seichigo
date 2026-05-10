import { TRAVEL_MODE_OPTIONS } from '@/lib/route/embedNavigation'
import type { GoogleMapsTravelMode } from '@/lib/route/google'

interface NavModeToggleProps {
  value: GoogleMapsTravelMode
  onChange: (mode: GoogleMapsTravelMode) => void
  className?: string
}

export function NavModeToggle({ value, onChange, className }: NavModeToggleProps) {
  return (
    <div className={`inline-flex rounded-xl bg-slate-900/70 p-1 ring-1 ring-white/10 ${className || ''}`}>
      {TRAVEL_MODE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            value === option.value ? 'bg-brand-500 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
