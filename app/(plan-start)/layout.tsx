import SiteShellPublic from '@/components/layout/SiteShellPublic'

/**
 * `/plan/start` 公开起始页的中文父布局：只套一层公共壳（页头页脚会被起始页
 * 的 immersive 样式隐藏），不建 html/body，根 layout 保持唯一。
 */
export default function PlanStartLayout({ children }: { children: React.ReactNode }) {
  return <SiteShellPublic locale="zh">{children}</SiteShellPublic>
}
