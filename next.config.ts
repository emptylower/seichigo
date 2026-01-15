import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
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
}

export default nextConfig
