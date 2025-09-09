import sharp from "sharp";

export function guessExtFromContentType(ct?: string): "png" | "jpeg" | "webp" {
  const s = (ct || "").toLowerCase();
  if (s.includes("jpeg") || s.includes("jpg")) return "jpeg";
  if (s.includes("webp")) return "webp";
  return "png";
}

export async function bufferToDataUrlPNG(buf: Buffer): Promise<string> {
  const png = await sharp(buf).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function bufferToDataUrlFromKnown(buf: Buffer, ext: "png" | "jpeg") {
  return `data:image/${ext};base64,${buf.toString("base64")}`;
}