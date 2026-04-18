type Props = {
  title: string
  bodyText: string
  ctaLabel?: string | null
  ctaHref?: string | null
  badgeLabel?: string
}

export default function EmergencyNotice({ title, bodyText, ctaLabel, ctaHref, badgeLabel = '紧急公告' }: Props) {
  return (
    <section className="not-prose rounded-3xl border border-amber-200 bg-amber-50 p-6 text-slate-900 shadow-sm">
      <div className="mb-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold tracking-[0.12em] text-amber-900">
        {badgeLabel}
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-4 whitespace-pre-wrap text-base leading-8 text-slate-700">{bodyText}</p>
      {ctaLabel && ctaHref ? (
        <a
          href={ctaHref}
          className="mt-6 inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          {ctaLabel}
        </a>
      ) : null}
    </section>
  )
}
