// utils/pdf-sanitize.ts

function isDataImageUrl(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^data:image\/(png|jpe?g);base64,/i.test(v) &&
    v.split(",")[1]?.length > 10
  );
}
function isLocalFilePath(v: unknown): v is string {
  return typeof v === "string" && (/^\//.test(v) || /^[.]{1,2}\//.test(v));
}

function sanitizeImagesMap(images: any): any {
  if (!images || typeof images !== "object") return undefined;
  const out: Record<string, any> = {};
  for (const k of Object.keys(images)) {
    const val = images[k];
    // pdfmake supports: dataURL string, local file path string, or Buffer/Uint8Array/Readable
    if (
      isDataImageUrl(val) ||
      isLocalFilePath(val) ||
      (typeof Buffer !== "undefined" && (Buffer as any).isBuffer?.(val)) ||
      val instanceof Uint8Array
    ) {
      out[k] = val;
    }
    // else: drop it
  }
  return Object.keys(out).length ? out : undefined;
}

/** Recursively sanitize any docDefinition-like node */
export function sanitizeImages(node: any): any {
  // Array
  if (Array.isArray(node)) return node.map(sanitizeImages);

  // Function (header/footer/background/watermark) → wrap so return is sanitized
  if (typeof node === "function") {
    const orig = node;
    return (...args: any[]) => sanitizeImages(orig(...args));
  }

  // Object
  if (node && typeof node === "object") {
    // Named images dictionary → if invalid, DELETE it
    if ("images" in node) {
      const cleaned = sanitizeImagesMap((node as any).images);
      if (cleaned) (node as any).images = cleaned;
      else delete (node as any).images;
    }

    // Inline image node.image
    if ("image" in node) {
      const val = (node as any).image;
      const ok =
        (typeof val === "string" &&
          (isDataImageUrl(val) || isLocalFilePath(val))) ||
        (typeof Buffer !== "undefined" && (Buffer as any).isBuffer?.(val)) ||
        val instanceof Uint8Array;
      if (!ok) {
        delete (node as any).image; // remove to avoid pdfmake error
        if (!("text" in node)) (node as any).text = ""; // keep layout stable
      }
    }

    // Recurse other props
    for (const k of Object.keys(node)) {
      (node as any)[k] = sanitizeImages((node as any)[k]);
    }
  }
  return node;
}

/** Extra-hard strip to eliminate any remaining invalid images */
export function hardStripImages(doc: any): any {
  // 1) Drop doc.images entirely unless 100% valid
  if (doc && typeof doc === "object" && "images" in doc) {
    const imgs = (doc as any).images;
    const keep =
      imgs &&
      typeof imgs === "object" &&
      Object.keys(imgs).length > 0 &&
      Object.values(imgs).every((v: any) =>
        typeof v === "string"
          ? /^data:image\/(png|jpe?g);base64,/i.test(v) ||
            /^[./]/.test(v) ||
            v.startsWith("/")
          : (typeof Buffer !== "undefined" && (Buffer as any).isBuffer?.(v)) ||
            v instanceof Uint8Array
      );
    if (!keep) delete (doc as any).images;
  }

  // 2) Remove any { image: ... } references that aren't dataURL/path/Buffer
  const sweep = (n: any) => {
    if (Array.isArray(n)) return n.forEach(sweep);
    if (!n || typeof n !== "object") return;

    if ("image" in n) {
      const val = (n as any).image;
      const ok =
        (typeof val === "string" &&
          (/^data:image\/(png|jpe?g);base64,/i.test(val) ||
            /^[./]/.test(val) ||
            val.startsWith("/"))) ||
        (typeof Buffer !== "undefined" && (Buffer as any).isBuffer?.(val)) ||
        val instanceof Uint8Array;
      if (!ok) {
        delete (n as any).image;
        if (!("text" in n)) (n as any).text = "";
      }
    }
    for (const k of Object.keys(n)) sweep((n as any)[k]);
  };
  sweep(doc);
  return doc;
}

/** STRIP MODE: buang SEMUA gambar tanpa kecuali (images map & node.image) */
export function stripAllImages(doc: any): any {
  const sweep = (n: any) => {
    if (Array.isArray(n)) return n.forEach(sweep);
    if (!n || typeof n !== "object") return;

    if ("images" in n) delete (n as any).images;
    if ("image" in n) {
      delete (n as any).image;
      if (!("text" in n)) (n as any).text = "";
    }
    for (const k of Object.keys(n)) sweep((n as any)[k]);
  };
  sweep(doc);
  return doc;
}
