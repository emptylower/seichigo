'use client'

export function NearbyFloatingButton() {
  return (
    <div className="fixed bottom-6 right-6 z-40">
      <button
        type="button"
        aria-label="看看身边有什么"
        title="看看身边有什么"
        className="relative bg-journal-paper-card rounded-full w-14 h-14 grid place-items-center shadow-lg hover:scale-105 transition"
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.location.hash = '#nearby'
          }
        }}
      >
        <span className="font-journal-serif text-xl">◎</span>
        <span
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-journal-seal animate-pulse"
          aria-hidden="true"
        />
      </button>
    </div>
  )
}
