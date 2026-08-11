import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SystemInfo } from '@/app/(authed)/admin/settings/ui'

const getSessionMock = vi.fn()
const redirectMock = vi.fn()

const testInfo: SystemInfo = {
  siteUrl: 'https://seichigo.com',
  authUrl: 'https://seichigo.com',
  databaseConfigured: true,
  emailConfigured: true,
  emailProvider: 'Cloudflare Email Sending',
  version: '0.1.0',
}

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

describe('admin settings page', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    redirectMock.mockReset()
  })

  it('redirects to signin if no session', async () => {
    getSessionMock.mockResolvedValue(null)
    
    const AdminSettingsPage = (await import('@/app/(authed)/admin/settings/page')).default
    try {
      await AdminSettingsPage()
    } catch (e) {
      // Intentional catch: redirect throws an error in Next.js
    }
    expect(redirectMock).toHaveBeenCalledWith('/auth/signin')
  })

  it('shows forbidden for non-admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })
    
    redirectMock.mockReset()

    const AdminSettingsPage = (await import('@/app/(authed)/admin/settings/page')).default
    const { container } = render(await AdminSettingsPage())
    
    expect(container).toHaveTextContent('无权限访问。')
  })

  it('renders settings page for admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const AdminSettingsPage = (await import('@/app/(authed)/admin/settings/page')).default
    render(await AdminSettingsPage())

    expect(screen.getByText('系统设置')).toBeInTheDocument()
    expect(screen.getByText('查看系统配置信息（只读）')).toBeInTheDocument()
  })
})

describe('admin settings UI', () => {
  it('displays site information', async () => {
    const { default: AdminSettingsClient } = await import('@/app/(authed)/admin/settings/ui')
    render(<AdminSettingsClient info={testInfo} />)

    expect(screen.getByText('站点信息')).toBeInTheDocument()
    expect(screen.getByText('站点 URL')).toBeInTheDocument()
    expect(screen.getByText('认证 URL')).toBeInTheDocument()
  })

  it('displays database status without connection string', async () => {
    const { default: AdminSettingsClient } = await import('@/app/(authed)/admin/settings/ui')
    const { container } = render(<AdminSettingsClient info={testInfo} />)

    expect(screen.getByText('数据库')).toBeInTheDocument()
    expect(screen.getByText('连接状态')).toBeInTheDocument()
    
    // Should show status badge (configured or not)
    const statusBadges = container.querySelectorAll('.inline-flex')
    expect(statusBadges.length).toBeGreaterThan(0)
    
    // Should NOT contain actual DATABASE_URL
    expect(container.textContent).not.toContain('postgresql://')
    expect(container.textContent).not.toContain('DATABASE_URL')
  })

  it('displays email configuration status without API keys', async () => {
    const { default: AdminSettingsClient } = await import('@/app/(authed)/admin/settings/ui')
    const { container } = render(<AdminSettingsClient info={testInfo} />)

    expect(screen.getByText('邮件服务')).toBeInTheDocument()
    expect(screen.getByText('配置状态')).toBeInTheDocument()
    
    // Should NOT contain sensitive keys
    expect(screen.getByText('Cloudflare Email Sending')).toBeInTheDocument()
    expect(container.textContent).not.toContain('API_KEY')
  })

  it('displays system version from package.json', async () => {
    const { default: AdminSettingsClient } = await import('@/app/(authed)/admin/settings/ui')
    render(<AdminSettingsClient info={testInfo} />)

    expect(screen.getByText('系统版本')).toBeInTheDocument()
    expect(screen.getByText('当前版本')).toBeInTheDocument()
    expect(screen.getByText('v0.1.0')).toBeInTheDocument()
  })

  it('shows read-only warning', async () => {
    const { default: AdminSettingsClient } = await import('@/app/(authed)/admin/settings/ui')
    render(<AdminSettingsClient info={testInfo} />)

    expect(screen.getByText('只读模式')).toBeInTheDocument()
    expect(screen.getByText(/此页面仅用于查看系统配置状态/)).toBeInTheDocument()
  })

  it('does not expose sensitive environment variables', async () => {
    const { default: AdminSettingsClient } = await import('@/app/(authed)/admin/settings/ui')
    const { container } = render(<AdminSettingsClient info={testInfo} />)

    const sensitivePatterns = [
      'DATABASE_URL',
      'NEXTAUTH_SECRET',
      'EMAIL_SERVER',
      'RATE_LIMIT_SALT',
      'postgresql://',
      'smtp://',
      'secret',
      'password',
      'api_key'
    ]

    const text = container.textContent?.toLowerCase() || ''
    
    sensitivePatterns.forEach(pattern => {
      expect(text).not.toContain(pattern.toLowerCase())
    })
  })
})
