export default function MapPageSkeleton() {
  return (
    <div data-layout-wide="true" className="h-[calc(100dvh-84px)] w-full overflow-hidden bg-slate-50">
      <div className="relative grid h-full min-h-0 grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="hidden h-full min-h-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <div className="space-y-3 border-b border-slate-200 px-4 py-4">
            <h1 className="text-lg font-semibold text-slate-900">巡礼地图</h1>
            <p className="text-xs text-slate-500">正在加载作品与地标数据…</p>
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

        <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center mobile-safe-bottom lg:hidden">
          <div className="h-11 w-48 rounded-full bg-white/90 shadow" />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 h-[44dvh] rounded-t-2xl border border-slate-200 bg-white lg:hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300" />
            <h2 className="text-sm font-semibold text-slate-900">巡礼地图</h2>
            <p className="mt-1 text-xs text-slate-500">正在加载作品与地标数据…</p>
          </div>
          <div className="space-y-3 px-4 py-4">
            <div className="h-10 w-full rounded bg-slate-100" />
            <div className="h-20 w-full rounded-2xl bg-slate-100" />
            <div className="h-20 w-full rounded-2xl bg-slate-100" />
          </div>
        </div>
      </div>
    </div>
  )
}
