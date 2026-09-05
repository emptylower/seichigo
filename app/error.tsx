'use client'

import { useEffect, useState } from 'react'

import { collectEnvDiagnostics, type EnvDiagnosticRow } from '@/lib/observability/envDiagnostics'

const MESSAGE_LIMIT = 600
const STACK_LIMIT = 1200

/**
 * 路由级客户端错误边界。
 *
 * Next 默认只给一句「Application error: a client-side exception has occurred」，
 * 真机上（尤其只在某些手机浏览器复现的问题）等于什么信息都没有。这里把 message /
 * digest / stack 直接摊在页面上，好让用户截图就能定位——所以这是一张诊断页，
 * 不走 i18n，固定中文。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [diagnostics, setDiagnostics] = useState<EnvDiagnosticRow[]>([])

  useEffect(() => {
    // 远程调试（Safari/Chrome inspect）能直接抓到这一条
    console.error('[app/error]', error)
  }, [error])

  // 只在客户端采集，SSR 阶段渲染为空，避免水合差异
  useEffect(() => {
    setDiagnostics(collectEnvDiagnostics())
  }, [])

  const message = (error?.message ?? '').slice(0, MESSAGE_LIMIT)
  const stack = (error?.stack ?? '').slice(0, STACK_LIMIT)

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">页面出了点问题</h1>

        <p
          data-testid="error-message"
          className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800"
        >
          {message}
        </p>

        {error?.digest ? (
          <p data-testid="error-digest" className="mt-2 font-mono text-xs text-gray-500">
            digest: {error.digest}
          </p>
        ) : null}

        {stack ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-gray-500">查看堆栈</summary>
            <pre
              data-testid="error-stack"
              className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-700"
            >
              {stack}
            </pre>
          </details>
        ) : null}

        {diagnostics.length > 0 ? (
          <dl
            data-testid="error-diagnostics"
            className="mt-3 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-700"
          >
            {diagnostics.map((row) => (
              <div key={row.key} className="contents">
                <dt className="whitespace-nowrap text-gray-500">{row.label}</dt>
                <dd data-testid={`diag-${row.key}`} className="m-0 break-all text-gray-800">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            重试
          </button>
          <a href="/" className="text-sm text-gray-500 underline-offset-4 hover:text-brand-600 hover:underline">
            返回首页
          </a>
        </div>
      </div>
    </main>
  )
}
