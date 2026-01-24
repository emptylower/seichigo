import SiteShellPublic from '@/components/layout/SiteShellPublic'

export default function EnglishLayout({ children }: { children: React.ReactNode }) {
  return <SiteShellPublic locale="en">{children}</SiteShellPublic>
}
