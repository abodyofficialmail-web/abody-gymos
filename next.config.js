/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/member/session-survey",
        destination: "/survey",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;

