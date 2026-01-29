import SiteShellPublic from '@/components/layout/SiteShellPublic'

export default function JapaneseLayout({ children }: { children: React.ReactNode }) {
  return <SiteShellPublic locale="ja">{children}</SiteShellPublic>
}
