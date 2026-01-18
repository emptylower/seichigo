import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'

export default function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 has-[[data-layout-wide='true']]:max-w-none has-[[data-layout-wide='true']]:px-0 has-[[data-layout-wide='true']]:mx-0">
        {children}
      </main>
      <Footer />
    </div>
  )
}
