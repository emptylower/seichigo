import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  experimental: {
    // Keep server actions available for future use
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

export default nextConfig
