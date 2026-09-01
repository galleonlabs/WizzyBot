import type { NextConfig } from "next";
import { withEve } from "eve/next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src * data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "child-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://robinhood-rpc.publicnode.com https://mainnet.base.org https://api.relay.link",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};

export default withEve(nextConfig, {
  eveBuildCommand: "node scripts/bundle-hosted.mjs && node ./node_modules/eve/bin/eve.js build",
});
