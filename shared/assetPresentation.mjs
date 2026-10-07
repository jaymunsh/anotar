export const IMAGE_MIME = /^image\/(png|jpeg|webp|gif|avif)$/;
export function parseAssetCrop(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 400)
    throw new Error('이미지 자르기 정보가 올바르지 않습니다.');
  let crop;
  try {
    crop = JSON.parse(value);
  } catch {
    throw new Error('이미지 자르기 정보가 올바르지 않습니다.');
  }
  const keys = ['x', 'y', 'width', 'height', 'imageWidth', 'imageHeight'];
  if (
    !crop ||
    typeof crop !== 'object' ||
    Array.isArray(crop) ||
    Object.keys(crop).length !== keys.length ||
    keys.some((key) => !Number.isFinite(crop[key])) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 0.05 ||
    crop.height < 0.05 ||
    crop.x + crop.width > 1.000001 ||
    crop.y + crop.height > 1.000001 ||
    crop.imageWidth < 1 ||
    crop.imageHeight < 1 ||
    crop.imageWidth > 100000 ||
    crop.imageHeight > 100000
  )
    throw new Error('이미지 자르기 영역이 원본 범위를 벗어났습니다.');
  return crop;
}
export function assetCropStyles(value) {
  let crop;
  try {
    crop = parseAssetCrop(value);
  } catch {
    return null;
  }
  if (!crop) return null;
  return {
    viewport: {
      position: 'relative',
      overflow: 'hidden',
      aspectRatio: String((crop.width * crop.imageWidth) / (crop.height * crop.imageHeight)),
      width: '100%',
    },
    image: {
      position: 'absolute',
      maxWidth: 'none',
      maxHeight: 'none',
      width: `${100 / crop.width}%`,
      height: `${100 / crop.height}%`,
      left: `${(-100 * crop.x) / crop.width}%`,
      top: `${(-100 * crop.y) / crop.height}%`,
      objectFit: 'fill',
    },
  };
}
export function assetFileSize(size) {
  if (!Number.isFinite(size) || size < 0) return '';
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}
