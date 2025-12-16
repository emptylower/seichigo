import { describe, expect, it, vi, beforeEach } from 'vitest'

function jsonRequest(url: string, body: any) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('link preview api', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns og:image as preview image', async () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/cover.png" />
        </head>
        <body>hello</body>
      </html>
    `

    const fetchMock = vi.fn(async () => new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }))
    vi.stubGlobal('fetch', fetchMock as any)

    const { POST } = await import('@/app/api/link-preview/route')
    const res = await POST(jsonRequest('http://localhost/api/link-preview', { url: 'https://example.com/page' }))

    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.imageUrl).toBe('https://cdn.example.com/cover.png')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('resolves relative og:image against page url', async () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="/og/cover.jpg" />
        </head>
      </html>
    `

    const fetchMock = vi.fn(async () => new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }))
    vi.stubGlobal('fetch', fetchMock as any)

    const { POST } = await import('@/app/api/link-preview/route')
    const res = await POST(jsonRequest('http://localhost/api/link-preview', { url: 'https://example.com/hello' }))
    const j = await res.json()

    expect(j.ok).toBe(true)
    expect(j.imageUrl).toBe('https://example.com/og/cover.jpg')
  })

  it('rejects non-http(s) url', async () => {
    const { POST } = await import('@/app/api/link-preview/route')
    const res = await POST(jsonRequest('http://localhost/api/link-preview', { url: 'javascript:alert(1)' }))
    expect(res.status).toBe(400)
  })
})

