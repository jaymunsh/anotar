export type AssetCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
};
export const IMAGE_MIME: RegExp;
export function parseAssetCrop(value?: string): AssetCrop | null;
export function assetCropStyles(
  value?: string,
): { viewport: import('react').CSSProperties; image: import('react').CSSProperties } | null;
export function assetFileSize(size: number): string;
