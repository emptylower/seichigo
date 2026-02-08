import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Sidebar } from '@/components/admin/Sidebar'
import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'

const mocks = vi.hoisted(() => {
  return {
    usePathname: vi.fn(),
  }
})

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}))

describe('Sidebar', () => {
  it('renders all navigation groups', () => {
    mocks.usePathname.mockReturnValue('/admin/dashboard')
    render(<Sidebar />)
    expect(screen.getByText('概览')).toBeInTheDocument()
    expect(screen.getByText('内容管理')).toBeInTheDocument()
    expect(screen.getByText('用户管理')).toBeInTheDocument()
    expect(screen.getByText('系统')).toBeInTheDocument()
  })

  it('renders main navigation links', () => {
    mocks.usePathname.mockReturnValue('/admin/dashboard')
    render(<Sidebar />)
    expect(screen.getByText('仪表盘')).toBeInTheDocument()
    expect(screen.getByText('文章审核')).toBeInTheDocument()
    expect(screen.getByText('用户列表')).toBeInTheDocument()
    expect(screen.getByText('系统设置')).toBeInTheDocument()
    expect(screen.getByText('运维检查')).toBeInTheDocument()
  })

  it('highlights active link', () => {
    mocks.usePathname.mockReturnValue('/admin/review')
    render(<Sidebar />)
    
    const activeLink = screen.getByText('文章审核').closest('a')
    expect(activeLink).toHaveClass('bg-brand-50')
    expect(activeLink).toHaveClass('text-brand-600')

    const inactiveLink = screen.getByText('仪表盘').closest('a')
    expect(inactiveLink).not.toHaveClass('bg-brand-50')
  })
})

describe('AdminBreadcrumbs', () => {
  it('renders breadcrumbs based on path', () => {
    mocks.usePathname.mockReturnValue('/admin/panel/anime')
    render(<AdminBreadcrumbs />)
    
    expect(screen.getByText('管理后台')).toBeInTheDocument()
    expect(screen.getByText('内容管理')).toBeInTheDocument()
    expect(screen.getByText('作品管理')).toBeInTheDocument()
  })

  it('handles unknown segments gracefully', () => {
    mocks.usePathname.mockReturnValue('/admin/unknown-segment')
    render(<AdminBreadcrumbs />)
    
    expect(screen.getByText('管理后台')).toBeInTheDocument()
    expect(screen.getByText('unknown-segment')).toBeInTheDocument()
  })

  it('maps ops segment to 运维检查', () => {
    mocks.usePathname.mockReturnValue('/admin/ops')
    render(<AdminBreadcrumbs />)

    expect(screen.getByText('运维检查')).toBeInTheDocument()
  })
})
