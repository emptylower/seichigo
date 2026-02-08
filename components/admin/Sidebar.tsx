"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  FileText,
  Map,
  Users,
  Settings,
  ListTodo,
  Image as ImageIcon,
  Languages,
  TrendingUp,
  Activity,
} from "lucide-react"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Sidebar({ className, ...props }: SidebarProps) {
  const pathname = usePathname()

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/")

  const navItems = [
    {
      title: "概览",
      items: [
        {
          title: "仪表盘",
          href: "/admin/dashboard",
          icon: LayoutDashboard,
        },
      ],
    },
    {
      title: "内容管理",
      items: [
        {
          title: "文章审核",
          href: "/admin/review",
          icon: FileText,
        },
        {
          title: "翻译管理",
          href: "/admin/translations",
          icon: Languages,
        },
        {
          title: "作品管理",
          href: "/admin/panel/anime",
          icon: ImageIcon,
        },
        {
          title: "城市管理",
          href: "/admin/panel/city",
          icon: Map,
        },
      ],
    },
    {
      title: "用户管理",
      items: [
        {
          title: "用户列表",
          href: "/admin/users",
          icon: Users,
        },
      ],
    },
    {
      title: "系统",
      items: [
        {
          title: "系统设置",
          href: "/admin/settings",
          icon: Settings,
        },
        {
          title: "Waitlist",
          href: "/admin/waitlist",
          icon: ListTodo,
        },
        {
          title: "SEO 管理",
          href: "/admin/seo",
          icon: TrendingUp,
        },
        {
          title: "运维检查",
          href: "/admin/ops",
          icon: Activity,
        },
      ],
    },
  ]

  return (
    <div className={cn("pb-12 h-full border-r bg-background", className)} {...props}>
      <div className="space-y-4 py-4">
        <div className="px-3 py-2">
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">
            管理后台
          </h2>
          <div className="space-y-1">
            {navItems.map((group, i) => (
              <div key={i} className="mb-4">
                <h3 className="mb-2 px-4 text-xs font-semibold uppercase text-muted-foreground/50">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center rounded-md px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors",
                        isActive(item.href)
                          ? "bg-brand-50 text-brand-600"
                          : "transparent"
                      )}
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {item.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
