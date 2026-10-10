import type { MetadataRoute } from "next";
import { identity } from "./identity";

/** The name under the icon on a home screen: the whole name when it fits, else its first word. */
function shortName(name: string): string {
  const letters = Array.from(name);
  if (letters.length <= 12) return name;
  return Array.from(name.split(" ")[0]).slice(0, 12).join("");
}

// What a phone uses when the app is added to its home screen. Drawn from app/identity.ts.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: identity.name,
    short_name: shortName(identity.name),
    description: identity.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: identity.accent,
    // Served by app/icon.tsx. 192px and 512px are what a phone needs before it offers to install.
    icons: [
      { src: "/icon/pwa", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/pwa-large", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
