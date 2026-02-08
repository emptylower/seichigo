"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Sidebar } from "@/components/admin/Sidebar"
import { AdminBreadcrumbs } from "@/components/admin/AdminBreadcrumbs"
import { AdminToastProvider } from '@/components/admin/feedback/AdminToastProvider'
import { AdminToastViewport } from '@/components/admin/feedback/AdminToastViewport'
import { AdminConfirmProvider } from '@/components/admin/feedback/AdminConfirmProvider'

export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <AdminToastProvider>
      <AdminConfirmProvider>
        <div className="flex h-screen bg-background">
          <aside className="hidden w-60 flex-col md:flex">
            <Sidebar className="w-full" />
          </aside>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="left" className="p-0 w-60">
              <Sidebar className="border-none" />
            </SheetContent>
          </Sheet>

          <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <header className="flex h-14 items-center gap-4 border-b bg-background px-4 md:hidden">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <button className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10 shrink-0">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle navigation menu</span>
                  </button>
                </SheetTrigger>
              </Sheet>
              <div className="font-semibold">管理后台</div>
            </header>

            <div className="flex-1 overflow-y-auto">
              <AdminBreadcrumbs />
              <div className="p-4 md:p-8 pt-0">
                {children}
              </div>
            </div>
          </main>
          <AdminToastViewport />
        </div>
      </AdminConfirmProvider>
    </AdminToastProvider>
  )
}
