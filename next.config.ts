import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};

export default withEve(nextConfig, {
  eveBuildCommand: "node scripts/bundle-hosted.mjs && node ./node_modules/eve/bin/eve.js build",
});
