import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/app"] },
    sitemap: "https://wizzy.meme/sitemap.xml",
    host: "https://wizzy.meme",
  };
}
