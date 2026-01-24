import HeaderPublic from '@/components/layout/HeaderPublic'
import Footer from '@/components/layout/Footer'
import type { SiteLocale } from '@/components/layout/SiteShell'

type Props = {
  children: React.ReactNode
  locale?: SiteLocale
}

export default function SiteShellPublic({ children, locale = 'zh' }: Props) {
  return (
    <div className="min-h-dvh flex flex-col">
      <HeaderPublic locale={locale} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 has-[[data-layout-wide='true']]:max-w-none has-[[data-layout-wide='true']]:px-0 has-[[data-layout-wide='true']]:mx-0">
        {children}
      </main>
      <Footer locale={locale} />
    </div>
  )
}
