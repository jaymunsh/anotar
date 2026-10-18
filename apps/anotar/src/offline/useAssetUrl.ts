// 온라인 전용: 자산은 서버 URL을 그대로 쓴다.
export function useAssetUrl(id: string) {
  return id ? `/api/assets/${id}` : '';
}
