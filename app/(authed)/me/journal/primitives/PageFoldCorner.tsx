export function PageFoldCorner() {
  return (
    <span
      data-testid="page-fold"
      aria-hidden="true"
      className="absolute right-0 bottom-0 w-6 h-6 pointer-events-none"
      style={{
        background:
          'linear-gradient(225deg, rgba(31, 26, 19, 0.08) 0%, rgba(31, 26, 19, 0.04) 40%, transparent 50%)',
        clipPath: 'polygon(100% 0, 0 100%, 100% 100%)',
      }}
    />
  )
}
