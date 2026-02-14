export default function MapPageSkeleton() {
  return (
    <div data-layout-wide="true" className="h-[calc(100dvh-84px)] w-full overflow-hidden bg-slate-50">
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="hidden h-full min-h-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <div className="space-y-3 border-b border-slate-200 px-4 py-4">
            <div className="h-6 w-28 rounded bg-slate-100" />
            <div className="h-10 w-full rounded bg-slate-100" />
            <div className="h-8 w-56 rounded bg-slate-100" />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-3">
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
          </div>
        </aside>
        <section className="relative h-full min-h-0">
          <div className="h-full w-full bg-slate-200/60" />
        </section>
      </div>
    </div>
  )
}
