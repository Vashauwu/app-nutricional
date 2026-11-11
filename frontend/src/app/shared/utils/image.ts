/**
 * Procesamiento de imágenes en el cliente (§18.3): valida formato y tamaño,
 * reduce a 1920×1080 conservando proporción y convierte a WebP. El backend
 * repite la validación; esto solo mejora la experiencia y el ancho de banda.
 */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export interface ImageResult {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export async function processImage(file: File, maxBytes: number): Promise<ImageResult> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (isHeic) throw new Error('Los archivos HEIC se convierten en el servidor. Por ahora, súbelo como JPG, PNG o WebP.');
  if (!ACCEPTED.includes(file.type)) throw new Error('Formato no admitido. Usa JPG, PNG o WebP.');
  if (file.size > maxBytes) throw new Error(`La imagen supera el límite de ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('El archivo está dañado o no es una imagen válida.');
  });
  const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen en este navegador.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/webp', 0.82);
  return { dataUrl, width, height, bytes: Math.round(dataUrl.length * 0.75) };
}
