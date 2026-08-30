import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://wizzy.meme",
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
