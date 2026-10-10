import { ImageResponse } from "next/og";
import { identity } from "./identity";

// The home-screen icon on iPhone and iPad. Square and full-bleed: iOS rounds the corners itself,
// and transparent corners would show as black there. Drawn from app/identity.ts.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          color: "#ffffff",
          fontSize: 112,
          lineHeight: 1,
        }}
      >
        {identity.initial}
      </div>
    ),
    size,
  );
}
