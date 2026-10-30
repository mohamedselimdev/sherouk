import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./schemas";

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejected";
  }
}

type ImageType = keyof typeof ALLOWED_IMAGE_TYPES;

/** Decides the type from the file's own bytes; the client-supplied name and Content-Type are ignored. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

/** Validates an uploaded file and returns a random R2 key (never derived from the filename). */
export async function prepareImageUpload(
  file: unknown,
): Promise<{ key: string; contentType: ImageType; body: ArrayBuffer }> {
  if (!(file instanceof File) || file.size === 0) throw new UploadRejected("no file");
  if (file.size > MAX_IMAGE_BYTES) throw new UploadRejected("too large");
  const body = await file.arrayBuffer();
  const contentType = sniffImage(new Uint8Array(body));
  if (!contentType) throw new UploadRejected("not an allowed image type");
  return { key: `products/${crypto.randomUUID()}.${ALLOWED_IMAGE_TYPES[contentType]}`, contentType, body };
}
