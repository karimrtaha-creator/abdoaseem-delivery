// Security audit finding MEDIUM-2 residual (Batch 8, 2026-08-14): shared by
// upload-receipt and upload-payment-proof - real magic-byte signature
// checks, never the client-declared/guessed Content-Type, matching the
// same approach upload-image (Batch 6) already established for
// menu-images/branch-images.
export type DetectedType = { ext: string; contentType: string };

export function detectImageType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSig.every((b, i) => bytes[i] === b)) {
    return { ext: "png", contentType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // matches each bucket's own file_size_limit
