import { ImageResponse } from "next/og";
import { identity } from "./identity";

// The app's icons: its initial on its accent colour, drawn from app/identity.ts. One file, four
// sizes, each served at /icon/<id>: the browser tab's 32px, and the 192px and 512px a phone needs
// before it offers to install the app. "maskable" is the same art with more room around the letter,
// for launchers that crop icons into their own shape.
const ICONS = {
  small: { size: 32, rounded: true },
  pwa: { size: 192, rounded: true },
  "pwa-large": { size: 512, rounded: true },
  maskable: { size: 512, rounded: false },
} as const;

type IconId = keyof typeof ICONS;

export function generateImageMetadata() {
  return (Object.keys(ICONS) as IconId[]).map((id) => ({
    id,
    contentType: "image/png",
    size: { width: ICONS[id].size, height: ICONS[id].size },
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const key = String(await id);
  const icon = ICONS[key in ICONS ? (key as IconId) : "small"];
  const maskable = !icon.rounded;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: identity.accent,
          borderRadius: icon.rounded ? Math.round(icon.size * 0.22) : 0,
          color: "#ffffff",
          // A maskable icon keeps its letter inside the middle 60%, the zone no launcher crops.
          fontSize: Math.round(icon.size * (maskable ? 0.42 : 0.68)),
          lineHeight: 1,
        }}
      >
        {identity.initial}
      </div>
    ),
    { width: icon.size, height: icon.size },
  );
}
