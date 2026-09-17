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
  async rewrites() {
    return [
      // LINE が /goal-hearing + s= を /goal-hearings= と連結したときの復元
      {
        source: "/goal-hearings=:rest*",
        destination: "/goal-hearing",
      },
    ];
  },
};

module.exports = nextConfig;

