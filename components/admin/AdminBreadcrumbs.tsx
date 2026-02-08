"use client"

import { usePathname } from "next/navigation"
import Breadcrumbs from "@/components/layout/Breadcrumbs"

const LABEL_MAP: Record<string, string> = {
  admin: "管理后台",
  dashboard: "仪表盘",
  review: "文章审核",
  panel: "内容管理",
  anime: "作品管理",
  city: "城市管理",
  users: "用户列表",
  settings: "系统设置",
  waitlist: "Waitlist",
  seo: "SEO 管理",
  ops: "运维检查",
  rankings: "排名监控",
  "spoke-factory": "长尾页面工厂",
}

export function AdminBreadcrumbs() {
  const pathname = usePathname()
  
  const segments = pathname.split("/").filter(Boolean)
  
  const items = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/")
    const label = LABEL_MAP[segment] || segment
    
    return {
      name: label,
      href,
    }
  })

  return (
    <div className="mb-4 px-4 pt-4 md:px-8">
      <Breadcrumbs items={items} />
    </div>
  )
}
