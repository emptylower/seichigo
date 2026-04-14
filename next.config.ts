import { createRequire } from 'node:module'
import path from 'node:path'
import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const require = createRequire(import.meta.url)
const prismaWasmEntry = require.resolve('@prisma/client/wasm')
const sentryShimEntry = path.resolve('./lib/observability/sentryCloudflareShim.ts')
const isCloudflareDeploy = process.env.CLOUDFLARE_DEPLOY === '1'
  || process.env.WORKERS_CI === '1'
  || process.env.CF_PAGES === '1'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.anitabi.cn' },
      { protocol: 'https', hostname: 'anitabi.cn' },
    ],
  },
  async headers() {
    const noIndexHeaders = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
    return [
      { source: '/auth/:path*', headers: noIndexHeaders },
      { source: '/submit/:path*', headers: noIndexHeaders },
      { source: '/admin/:path*', headers: noIndexHeaders },
      { source: '/me/:path*', headers: noIndexHeaders },
      { source: '/api/:path*', headers: noIndexHeaders },
    ]
  },
  experimental: {
    // Keep server actions available for future use
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  webpack(config, { isServer }) {
    if (isCloudflareDeploy) {
      config.resolve ??= {}
      config.resolve.alias ??= {}
      config.resolve.alias['@sentry/nextjs'] = sentryShimEntry
    }

    if (isServer) {
      config.resolve ??= {}
      config.resolve.alias ??= {}
      config.resolve.alias['@prisma/client$'] = prismaWasmEntry
    }

    return config
  },
}

const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
}

export default isCloudflareDeploy
  ? nextConfig
  : withSentryConfig(nextConfig, sentryWebpackPluginOptions)
