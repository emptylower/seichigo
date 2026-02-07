import Link from 'next/link'
import Image from 'next/image'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'
import { t } from '@/lib/i18n'

type Props = {
  locale?: SiteLocale
}

type FooterLink = {
  label: string
  href: string
  isExternal?: boolean
}

type FooterColumn = {
  title: string
  links: FooterLink[]
}

export default function Footer({ locale = 'zh' }: Props) {
  const getHref = (path: string) => {
    if (path.startsWith('http') || path.startsWith('mailto') || path === '#') return path
    return prefixPath(path, locale)
  }

  const columns: FooterColumn[] = [
    {
      title: t('footer.product', locale),
      links: [
        { label: t('footer.posts', locale), href: '/' },
        { label: t('footer.anime', locale), href: '/anime' },
        { label: t('footer.city', locale), href: '/city' },
        { label: t('footer.resources', locale), href: '/resources' },
      ],
    },
    {
      title: t('footer.support', locale),
      links: [
        { label: t('footer.etiquette', locale), href: '/resources/pilgrimage-etiquette' },
        { label: t('footer.help', locale), href: '#', isExternal: true },
        { label: t('footer.status', locale), href: '#', isExternal: true },
      ],
    },
    {
      title: t('footer.company', locale),
      links: [
        { label: t('footer.about', locale), href: '/about' },
        { label: t('footer.privacy', locale), href: '/privacy' },
        { label: t('footer.terms', locale), href: '/terms' },
      ],
    },
    {
      title: t('footer.connect', locale),
      links: [
        { label: 'Email', href: 'mailto:ljj231428@gmail.com', isExternal: true },
        { label: 'X (Twitter)', href: 'https://x.com/xixingshu', isExternal: true },
        { label: 'GitHub', href: 'https://github.com/seichigo', isExternal: true },
      ],
    },
  ]

  const copyright = `© ${new Date().getFullYear()} SeichiGo. ${t('footer.copyright', locale)}`
  const slogan = t('footer.slogan', locale)

  return (
    <footer className="mt-16 border-t border-pink-100 bg-white pt-16 pb-12 text-sm" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">Footer</h2>
      <div className="mx-auto max-w-5xl px-4">
        <div className="xl:grid xl:grid-cols-3 xl:gap-8">
          <div className="space-y-4 xl:col-span-1">
            <Link href={prefixPath('/', locale)} className="flex items-center gap-2">
              <Image
                src="/brand/app-logo.png"
                alt="SeichiGo"
                width={32}
                height={32}
                className="h-8 w-8 rounded-md bg-white object-cover"
              />
              <span className="font-display text-lg text-gray-900">SeichiGo</span>
            </Link>
            <p className="max-w-xs text-sm leading-6 text-gray-500">
              {slogan}
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-8 md:grid-cols-4 xl:col-span-2 xl:mt-0">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="mb-4 font-semibold text-gray-900">{col.title}</h3>
                <ul className="space-y-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {link.isExternal || link.href === '#' ? (
                        <a
                          href={link.href}
                          className={`text-gray-500 hover:text-brand-600 ${link.href === '#' ? 'cursor-default' : ''}`}
                          target={link.href.startsWith('http') ? '_blank' : undefined}
                          rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link href={getHref(link.href)} className="text-gray-500 hover:text-brand-600">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 border-t border-gray-100 pt-8">
          <p className="text-xs text-gray-400">{copyright}</p>
        </div>
      </div>
    </footer>
  )
}
