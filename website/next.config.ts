import type { NextConfig } from 'next';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
if (process.env.NODE_ENV === 'production' && (process.env.NEXT_PUBLIC_LOCAL_MODE === 'true' ||
  /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.NEXT_PUBLIC_BIZ_API_URL || ''))) {
  throw new Error('Production exports must not use local development identity or a localhost API.');
}
const config: NextConfig = {
  output: 'export', trailingSlash: true, basePath,
  images: { unoptimized: true }, poweredByHeader: false,
  experimental: { agentUpgrade: 'security' },
};
export default config;
