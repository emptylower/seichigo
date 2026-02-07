import type { LegalDocument as LegalDocumentModel, LegalSection } from '@/lib/legal/content'

type Props = {
  document: LegalDocumentModel
}

function Section({ section }: { section: LegalSection }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{section.heading}</h2>
      {section.paragraphs?.map((paragraph, index) => (
        <p key={`${section.heading}-paragraph-${index}`} className="leading-7 text-gray-700">
          {paragraph}
        </p>
      ))}
      {section.bullets?.length ? (
        <ul className="list-disc space-y-2 pl-6 text-gray-700">
          {section.bullets.map((item, index) => (
            <li key={`${section.heading}-bullet-${index}`}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export default function LegalDocument({ document }: Props) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-4 md:py-8">
      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-10">
        <header className="space-y-3 border-b border-gray-100 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">{document.title}</h1>
          <p className="leading-7 text-gray-700">{document.summary}</p>
          <div className="space-y-1 text-sm text-gray-500">
            <p>{document.effectiveDateLabel}: {document.effectiveDate}</p>
            <p>{document.updatedDateLabel}: {document.updatedDate}</p>
            <p>
              {document.contactLabel}:{' '}
              <a href={`mailto:${document.contactEmail}`} className="text-brand-600 hover:underline">
                {document.contactEmail}
              </a>
            </p>
          </div>
        </header>

        <div className="mt-8 space-y-8">
          {document.sections.map((section) => (
            <Section key={section.heading} section={section} />
          ))}
        </div>

        {document.closingNote ? (
          <p className="mt-8 rounded-xl bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-600">{document.closingNote}</p>
        ) : null}
      </article>
    </div>
  )
}
