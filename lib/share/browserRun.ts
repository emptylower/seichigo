export type BrowserRunConfig = { accountId: string; token: string }

/** 实测端到端 1.17-1.84 秒；20 秒是硬上限，超了直接走兜底 */
export const BROWSER_RUN_TIMEOUT_MS = 20_000

/**
 * 密钥读法与 lib/billing/creem/client.ts:45 一致：生产由 `wrangler secret put`
 * 注入（BROWSER_RUN_TOKEN / CF_ACCOUNT_ID），本地写 .env.local。
 * 任一缺失返回 null，调用方按「渲染不可用」走兜底，不报 500。
 */
export function readBrowserRunConfig(
  env: Record<string, string | undefined> = process.env,
): BrowserRunConfig | null {
  const token = String(env.BROWSER_RUN_TOKEN || '').trim()
  const accountId = String(env.CF_ACCOUNT_ID || '').trim()
  if (!token || !accountId) return null
  return { accountId, token }
}

/**
 * Cloudflare Browser Run 的 REST 截图接口：直接吃一段 HTML，返回图片二进制。
 * 失败时上游会以 200 + JSON `{success:false,errors:[...]}` 回应，所以只认
 * 非 JSON 的响应体；任何失败都返回 null，由调用方决定兜底。
 */
export async function renderHtmlToWebp(input: {
  html: string
  width: number
  height: number
  config: BrowserRunConfig
  fetchImpl?: typeof fetch
}): Promise<Uint8Array | null> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${input.config.accountId}/browser-run/screenshot`
  try {
    const doFetch = input.fetchImpl ?? fetch
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: input.html,
        screenshotOptions: { type: 'webp', quality: 85 },
        viewport: { width: input.width, height: input.height },
      }),
      signal: AbortSignal.timeout(BROWSER_RUN_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[share.browser_run.failed]', {
        event: 'share_browser_run_failed',
        status: res.status,
      })
      return null
    }
    if (String(res.headers.get('content-type') || '').includes('application/json')) {
      const text = await res.text()
      console.error('[share.browser_run.error_body]', {
        event: 'share_browser_run_error_body',
        body: text.slice(0, 200),
      })
      return null
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytes.byteLength > 0 ? bytes : null
  } catch (error) {
    console.error('[share.browser_run.threw]', {
      event: 'share_browser_run_threw',
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
    })
    return null
  }
}
