import * as Sentry from '@sentry/nextjs'

const dsn = String(process.env.NEXT_PUBLIC_SENTRY_DSN || '').trim()

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
})
