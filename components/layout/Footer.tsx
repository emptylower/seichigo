import Link from 'next/link'
import type { SiteLocale } from './SiteShell'

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
  const isEn = locale === 'en'

  const getHref = (path: string) => {
    if (path.startsWith('http') || path.startsWith('mailto') || path === '#') return path
    if (isEn && path.startsWith('/')) return `/en${path}`
    return path
  }

  const columns: FooterColumn[] = [
    {
      title: isEn ? 'Product' : '产品',
      links: [
        { label: isEn ? 'Posts' : '文章', href: '/' },
        { label: isEn ? 'Anime' : '作品', href: '/anime' },
        { label: isEn ? 'Cities' : '城市', href: '/city' },
        { label: isEn ? 'Resources' : '资源', href: '/resources' },
      ],
    },
    {
      title: isEn ? 'Support' : '支持',
      links: [
        { label: isEn ? 'Etiquette Guide' : '圣地巡礼礼仪', href: '/resources/pilgrimage-etiquette' },
        { label: isEn ? 'Help Center' : '帮助中心', href: '#', isExternal: true },
        { label: isEn ? 'System Status' : '系统状态', href: '#', isExternal: true },
      ],
    },
    {
      title: isEn ? 'Company' : '关于',
      links: [
        { label: isEn ? 'About Us' : '关于我们', href: '/about' },
        { label: isEn ? 'Privacy Policy' : '隐私政策', href: '#', isExternal: true },
        { label: isEn ? 'Terms of Service' : '用户协议', href: '#', isExternal: true },
      ],
    },
    {
      title: isEn ? 'Connect' : '联系',
      links: [
        { label: 'Email', href: 'mailto:ljj231428@gmail.com', isExternal: true },
        { label: 'Twitter', href: '#', isExternal: true },
        { label: 'GitHub', href: '#', isExternal: true },
      ],
    },
  ]

  const copyright = isEn
    ? `© ${new Date().getFullYear()} SeichiGo. All rights reserved.`
    : `© ${new Date().getFullYear()} SeichiGo. 保留所有权利。`

  const slogan = isEn
    ? 'Please respect local laws and etiquette during anime pilgrimages.'
    : '圣地巡礼请遵守当地法律与礼仪。'

  return (
    <footer className="mt-16 border-t border-pink-100 bg-white pt-12 pb-8 text-sm">
      <div className="mx-auto max-w-5xl px-4">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
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

        <div className="mt-12 border-t border-gray-100 pt-8 text-center text-gray-400">
          <p>{copyright}</p>
          <p className="mt-2 text-xs">{slogan}</p>
        </div>
      </div>
    </footer>
  )
}
