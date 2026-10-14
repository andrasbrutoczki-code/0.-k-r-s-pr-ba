/**
 * Kliensoldali képtömörítés a feltöltés előtt (böngészőben fut).
 *
 * - A hosszabbik oldal legfeljebb 1600 px, JPEG 0,82 minőséggel: egy füzetoldal
 *   fotója így jól olvasható marad, és jellemzően 200–500 kB.
 * - A vásznon újrarajzolt kép semmilyen metaadatot nem visz tovább: az EXIF
 *   (benne a GPS-koordináták és a készülék adatai) eltűnik – kiskorú tanulók
 *   fotóinál ez adatvédelmi követelmény.
 * - A tájolást (EXIF Orientation) a createImageBitmap „from-image” beállítása
 *   alkalmazza, így az álló fotó nem fordul el.
 * - HEIC: az iPhone kamerája a böngészőnek alapból JPEG-et ad; a galériából
 *   választott HEIC-et a Safari maga is meg tudja nyitni. Ha a böngésző nem
 *   tudja dekódolni, érthető hibaüzenetet adunk.
 */

export const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.82;

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

export class ImageDecodeError extends Error {}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Néhány böngésző a beállítást nem ismeri, vagy a formátumot így nem dekódolja: próbáljuk <img>-gel.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new ImageDecodeError(
      "Ezt a képet a böngésződ nem tudja megnyitni. Fényképezz közvetlenül az alkalmazásból, vagy válassz JPG/PNG képet.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Méretarányos kicsinyítés: a hosszabbik oldal legfeljebb `max`. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const source = await decode(file);
  const srcWidth = "naturalWidth" in source ? source.naturalWidth : source.width;
  const srcHeight = "naturalHeight" in source ? source.naturalHeight : source.height;
  const { width, height } = fitWithin(srcWidth, srcHeight, MAX_IMAGE_SIDE);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageDecodeError("A kép feldolgozása nem sikerült ezen az eszközön.");
  // Fehér alap: az átlátszó PNG ne legyen fekete JPEG-ként.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new ImageDecodeError("A kép feldolgozása nem sikerült ezen az eszközön.");
  return { blob, width, height };
}
