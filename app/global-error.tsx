'use client'

import { useEffect, useState } from 'react'

import { collectEnvDiagnostics, type EnvDiagnosticRow } from '@/lib/observability/envDiagnostics'

const MESSAGE_LIMIT = 600
const STACK_LIMIT = 1200

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * 根布局级错误边界：根布局本身崩了的时候 `app/error.tsx` 不会被渲染，只有这里会。
 *
 * 它替换掉整个文档，所以必须自带 `<html><body>`；也拿不到全局样式表，
 * 因此一律走内联 style，不依赖 Tailwind。内容与 `app/error.tsx` 保持一致：
 * 把真实的 message / digest / stack 摊出来，方便手机上截图定位。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [diagnostics, setDiagnostics] = useState<EnvDiagnosticRow[]>([])

  useEffect(() => {
    console.error('[app/global-error]', error)
  }, [error])

  // 只在客户端采集，SSR 阶段渲染为空，避免水合差异
  useEffect(() => {
    setDiagnostics(collectEnvDiagnostics())
  }, [])

  const message = (error?.message ?? '').slice(0, MESSAGE_LIMIT)
  const stack = (error?.stack ?? '').slice(0, STACK_LIMIT)

  return (
    <html lang="zh">
      <body style={{ margin: 0, background: '#f9fafb', color: '#111827', fontFamily: 'system-ui, sans-serif' }}>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 576,
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 16,
              padding: 24,
              boxSizing: 'border-box',
            }}
          >
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>页面出了点问题</h1>

            <p
              data-testid="error-message"
              style={{
                margin: '12px 0 0',
                background: '#f9fafb',
                borderRadius: 12,
                padding: 12,
                fontFamily: mono,
                fontSize: 12,
                lineHeight: 1.6,
                color: '#1f2937',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
              }}
            >
              {message}
            </p>

            {error?.digest ? (
              <p
                data-testid="error-digest"
                style={{ margin: '8px 0 0', fontFamily: mono, fontSize: 12, color: '#6b7280' }}
              >
                digest: {error.digest}
              </p>
            ) : null}

            {stack ? (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>查看堆栈</summary>
                <pre
                  data-testid="error-stack"
                  style={{
                    margin: '8px 0 0',
                    background: '#f9fafb',
                    borderRadius: 12,
                    padding: 12,
                    fontFamily: mono,
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: '#374151',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word',
                  }}
                >
                  {stack}
                </pre>
              </details>
            ) : null}

            {diagnostics.length > 0 ? (
              <dl
                data-testid="error-diagnostics"
                style={{
                  margin: '12px 0 0',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
                  columnGap: 12,
                  rowGap: 4,
                  background: '#f9fafb',
                  borderRadius: 12,
                  padding: 12,
                  fontFamily: mono,
                  fontSize: 11,
                  lineHeight: 1.6,
                }}
              >
                {diagnostics.map((row) => (
                  <div key={row.key} style={{ display: 'contents' }}>
                    <dt style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{row.label}</dt>
                    <dd data-testid={`diag-${row.key}`} style={{ margin: 0, color: '#1f2937', wordBreak: 'break-all' }}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  border: 0,
                  borderRadius: 12,
                  background: '#db2777',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '8px 16px',
                  cursor: 'pointer',
                }}
              >
                重试
              </button>
              <a href="/" style={{ fontSize: 14, color: '#6b7280' }}>
                返回首页
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
