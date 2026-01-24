import SiteShellPublic from '@/components/layout/SiteShellPublic'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShellPublic>{children}</SiteShellPublic>
}
