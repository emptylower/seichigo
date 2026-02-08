export default function ResourcesLoading() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-8 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-100" />
        <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-slate-100" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 aspect-[16/9] animate-pulse rounded-lg bg-slate-100" />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="h-9 animate-pulse rounded bg-slate-100" />
              <div className="h-9 animate-pulse rounded bg-slate-100" />
              <div className="h-9 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
