import { ImageResponse } from "next/og";
import { identity } from "./identity";

// The picture a link to this app shows when it is pasted into a chat or a post: the name, the
// description and the initial on the accent colour. Drawn from app/identity.ts. ImageResponse
// lays out with flexbox only — no grid — and uses its own built-in font.
export const alt = identity.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A long name steps down a size so the name and a full description always fit the card.
const nameLength = Array.from(identity.name).length;
const nameSize = nameLength > 36 ? 56 : nameLength > 22 ? 64 : 76;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", color: "#0a0a0a" }}>
        <div style={{ width: 24, height: "100%", display: "flex", background: identity.accent }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px 96px", gap: 28 }}>
          <div
            style={{
              width: 96,
              height: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 22,
              background: identity.accent,
              color: "#ffffff",
              fontSize: 58,
              lineHeight: 1,
            }}
          >
            {identity.initial}
          </div>
          <div style={{ display: "flex", fontSize: nameSize, lineHeight: 1.1, letterSpacing: -1 }}>{identity.name}</div>
          <div style={{ display: "flex", fontSize: 32, lineHeight: 1.35, color: "#525252" }}>{identity.description}</div>
        </div>
      </div>
    ),
    size,
  );
}
