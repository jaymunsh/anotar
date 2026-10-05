let registration: Promise<string> | undefined;

export function registerCaptureReceiver() {
  registration ??= (async () => {
    if (!window.isSecureContext)
      return '홈 화면 설치와 공유 수신에는 HTTPS 개인 주소가 필요해요. 개인 서버의 HTTPS 주소로 다시 열어 주세요.';
    if (!('serviceWorker' in navigator))
      return '이 브라우저에서는 공유 수신을 준비할 수 없어요. 링크를 붙여넣거나 파일을 직접 첨부해 주세요.';
    try {
      await navigator.serviceWorker.register('/capture-worker.js', { type: 'module', scope: '/' });
      return '';
    } catch {
      return '공유 수신을 준비하지 못했어요. 링크를 붙여넣거나 파일을 직접 첨부해 주세요.';
    }
  })();
  return registration;
}
