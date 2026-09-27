import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'שב"צ-נא',
    short_name: 'שב"צ-נא',
    description: "מערכת ניהול משמרות רבעוניות",
    start_url: "/",
    scope: "/",
    display: "standalone",
    dir: "rtl",
    lang: "he",
    background_color: "#161826",
    theme_color: "#161826",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/play-store-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/play-store-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
