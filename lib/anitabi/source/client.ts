import { setTimeout as sleep } from 'timers/promises'

const RETRY_DELAYS = [1000, 3000, 8000]

type FetchOptions = {
  parseAs?: 'json' | 'text'
  allow404?: boolean
  headers?: Record<string, string>
}

export class HttpStatusError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function fetchOnce(url: string, options?: FetchOptions): Promise<unknown> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'seichigo-anitabi-sync/1.0',
      ...options?.headers,
    },
    cache: 'no-store',
  })

  if (res.status === 404 && options?.allow404) return null
  if (!res.ok) throw new HttpStatusError(res.status, `Request failed ${res.status} ${url}`)

  if (options?.parseAs === 'text') {
    return await res.text()
  }
  return await res.json()
}

export async function fetchWithRetry(url: string, options?: FetchOptions): Promise<unknown> {
  let lastError: unknown = null

  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try {
      return await fetchOnce(url, options)
    } catch (error) {
      if (error instanceof HttpStatusError) {
        if (error.status === 404 && options?.allow404) return null
        if (error.status >= 400 && error.status < 500 && error.status !== 429) throw error
      }
      lastError = error
      if (i >= RETRY_DELAYS.length) break
      await sleep(RETRY_DELAYS[i]!)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed ${url}`)
}

export async function fetchJsonWithRetry<T>(url: string, options?: Omit<FetchOptions, 'parseAs'>): Promise<T | null> {
  return (await fetchWithRetry(url, { ...options, parseAs: 'json' })) as T | null
}

export async function fetchTextWithRetry(url: string, options?: Omit<FetchOptions, 'parseAs'>): Promise<string | null> {
  return (await fetchWithRetry(url, { ...options, parseAs: 'text' })) as string | null
}
