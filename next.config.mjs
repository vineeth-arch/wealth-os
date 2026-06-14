/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  // IA v2: the old standalone routes are consolidated. Preserve deep links.
  redirects: async () => [
    { source: "/import", destination: "/transactions?tab=import", permanent: false },
    { source: "/review", destination: "/transactions?tab=review", permanent: false },
    { source: "/rules", destination: "/transactions?tab=rules", permanent: false },
    { source: "/upstox", destination: "/holdings", permanent: false },
    { source: "/integrations", destination: "/settings", permanent: false },
  ],
  // The verified ingest layer uses ESM-style ".js" import specifiers that resolve to ".ts"
  // sources. Teach webpack to follow them so we never edit the tested parsers.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};
export default nextConfig;
