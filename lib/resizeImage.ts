/**
 * Downscale an image in the browser before upload.
 *
 * Vercel serverless functions cap request bodies at ~4.5MB, and the generation
 * model gains nothing from a 12MP phone photo. Resizing keeps us well under the
 * limit and speeds up the round trip.
 *
 * Resizing is an optimization, never a gate: any failure returns the original
 * file so the upload still goes through.
 */
/** Formats the API accepts as-is. Anything else is re-encoded to JPEG. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function resizeImage(
  file: File,
  maxEdge = 1600,
  quality = 0.9
): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);

    // Small files still get re-encoded when their format isn't one the API
    // accepts (GIF, BMP, HEIC…), so the upload isn't rejected downstream.
    if (longEdge <= maxEdge && ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      bitmap.close();
      return file;
    }

    // Clamped to 1: a small file being re-encoded for format reasons must not
    // be upscaled.
    const scale = Math.min(1, maxEdge / longEdge);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
