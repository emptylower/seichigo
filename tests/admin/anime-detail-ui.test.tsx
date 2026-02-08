import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const getSessionMock = vi.fn()
const pushMock = vi.fn()
const askForConfirmMock = vi.fn(async () => true)
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

vi.mock('@/hooks/useAdminConfirm', () => ({
  useAdminConfirm: () => askForConfirmMock,
}))

vi.mock('@/hooks/useAdminToast', () => ({
  useAdminToast: () => ({
    toasts: [],
    show: vi.fn(),
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, refresh: vi.fn() }),
  redirect: (_url: string) => {},
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/shared/CoverField', () => ({
  default: () => <div data-testid="cover-field" />,
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('admin anime detail ui', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    pushMock.mockReset()
    askForConfirmMock.mockReset()
    askForConfirmMock.mockResolvedValue(true)
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('allows admin to rename anime', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url === '/api/admin/anime/btr' && method === 'GET') {
        return jsonResponse({
          ok: true,
          anime: { id: 'btr', name: 'Old Name', summary: '', cover: null, hidden: false },
        })
      }

      if (url === '/api/admin/anime/btr' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body || '{}'))
        return jsonResponse({
          ok: true,
          anime: { id: 'btr', name: body.name, summary: '', cover: null, hidden: false },
        })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const Page = (await import('../../app/(authed)/admin/panel/anime/[id]/page')).default
    render(await Page({ params: Promise.resolve({ id: 'btr' }) }))

    expect(await screen.findByText('Old Name')).toBeInTheDocument()

    const input = await screen.findByLabelText('作品名 (中文)')
    fireEvent.change(input, { target: { value: 'New Name' } })
    
    fireEvent.click(screen.getByRole('button', { name: '保存当前语言' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/anime/btr', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name', summary: '' }),
    })
    expect(await screen.findByText('New Name')).toBeInTheDocument()
  })

  it('allows admin to switch languages and re-translate', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()

      if (url === '/api/admin/anime/btr' && method === 'GET') {
        return jsonResponse({
          ok: true,
          anime: { 
            id: 'btr', 
            name: 'Original Name', 
            summary: 'Original Summary',
            name_en: 'En Name',
            summary_en: '', // Empty, needs translation
            hidden: false 
          },
        })
      }

      // Retranslate Preview
      if (url === '/api/admin/retranslate' && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}'))
        if (body.targetLang === 'en') {
          return jsonResponse({
            ok: true,
            preview: { name: 'Translated Name En', summary: 'Translated Summary En' },
            sourceContent: { name: 'Original Name', summary: 'Original Summary' }
          })
        }
      }

      // Retranslate Apply
      if (url === '/api/admin/retranslate/apply' && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}'))
        return jsonResponse({
          ok: true,
          updated: { ...body.preview }
        })
      }

      // Normal Update
      if (url === '/api/admin/anime/btr' && method === 'PATCH') {
        return jsonResponse({
          ok: true,
          anime: { id: 'btr', name: 'Original Name', summary: 'Original Summary', ...JSON.parse(init.body) },
        })
      }

      return jsonResponse({ error: 'not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const Page = (await import('../../app/(authed)/admin/panel/anime/[id]/page')).default
    render(await Page({ params: Promise.resolve({ id: 'btr' }) }))

    // 1. Check default (zh) tab
    expect(await screen.findByDisplayValue('Original Name')).toBeVisible()
    
    // 2. Switch to English tab
    const enTab = screen.getByText('English')
    fireEvent.click(enTab)
    
    // Should show existing English name
    expect(await screen.findByDisplayValue('En Name')).toBeVisible()
    
    // 3. Click Re-translate
    const retranslateBtn = screen.getByText('AI 重新翻译')
    fireEvent.click(retranslateBtn)
    
    // 4. Expect Modal with Preview
    expect(await screen.findByText('Translated Summary En')).toBeVisible()
    
    // 5. Apply
    const applyBtn = screen.getByText('应用翻译')
    fireEvent.click(applyBtn)
    
    // 6. Verify API call and UI update
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/retranslate/apply', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"targetLang":"en"')
    }))
    
    // Should update the inputs
    expect(await screen.findByDisplayValue('Translated Summary En')).toBeVisible()
  })
})
