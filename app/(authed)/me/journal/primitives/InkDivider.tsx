export function InkDivider({ className = '' }: { className?: string }) {
  return (
    <div
      data-testid="ink-divider"
      className={['h-px opacity-40', className].join(' ')}
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, #4a4236 10%, #4a4236 90%, transparent 100%)',
      }}
    />
  )
}
