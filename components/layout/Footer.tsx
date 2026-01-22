import type { SiteLocale } from './SiteShell'
import Link from 'next/link'

type Props = {
  locale?: SiteLocale
}

export default function Footer({ locale = 'zh' }: Props) {
  const line =
    locale === 'en'
      ? 'Please respect local laws and etiquette during anime pilgrimages.'
      : '圣地巡礼请遵守当地法律与礼仪。'

  const etiquetteHref = locale === 'en' ? '/en/resources/pilgrimage-etiquette' : '/resources/pilgrimage-etiquette'
  const aboutHref = locale === 'en' ? '/en/about' : '/about'
  const etiquetteLabel = locale === 'en' ? 'Etiquette' : '礼仪指南'
  const aboutLabel = locale === 'en' ? 'About' : '关于我们'

  return (
    <footer className="mt-16 border-t border-pink-100 py-10 text-sm text-gray-500">
      <div className="mx-auto max-w-5xl px-4">
        <p>© {new Date().getFullYear()} SeichiGo. {line}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          <Link href={etiquetteHref} className="underline hover:text-brand-600">
            {etiquetteLabel}
          </Link>
          <Link href={aboutHref} className="underline hover:text-brand-600">
            {aboutLabel}
          </Link>
        </div>
        <p className="mt-2">
          {locale === 'en' ? 'Contact: ' : '联系：'}
          <a href="mailto:ljj231428@gmail.com" className="underline hover:text-brand-600">
            ljj231428@gmail.com
          </a>
        </p>
      </div>
    </footer>
  )
}
