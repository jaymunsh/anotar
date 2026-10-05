import { useEffect, useState } from 'react';
import { registerCaptureReceiver } from './registration';
import './capture.css';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function CaptureInstallHelp() {
  const [reason, setReason] = useState('');
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    let alive = true;
    void registerCaptureReceiver().then((value) => { if (alive) setReason(value); });
    const offer = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const installed = () => setInstall(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => { alive = false; window.removeEventListener('beforeinstallprompt', offer); window.removeEventListener('appinstalled', installed); };
  }, []);
  async function promptInstall() {
    if (!install || installing) return;
    setInstalling(true);
    try { await install.prompt(); await install.userChoice; setInstall(null); }
    catch { setReason('브라우저 메뉴에서 홈 화면 추가 또는 앱 설치를 선택해 주세요.'); }
    finally { setInstalling(false); }
  }
  return <details className="capture-install-help">
    <summary>휴대폰에서 빠르게 모으기</summary>
    <p>링크를 메모 칸에 붙여넣으면 주소를 인식해요. 이미지와 파일은 첨부 버튼으로 선택하거나 붙여넣을 수 있어요.</p>
    <p>Android Chrome 등 지원 브라우저에서는 개인 앱을 설치한 뒤 다른 앱의 공유 메뉴에서 anotar를 선택할 수 있어요. 처음 설치한 뒤 앱을 한 번 열어 주세요.</p>
    <p>iPhone·iPad Safari는 OS 공유 대상으로 받기를 지원하지 않아요. Safari 공유 메뉴의 ‘홈 화면에 추가’로 바로가기를 만들고, 원본 앱에서 복사한 링크를 여기에 붙여넣거나 이미지를 직접 첨부해 주세요.</p>
    <p>공유 대기 내용은 이 브라우저에만 임시보관돼요. 서버에 보관하려면 연결된 상태에서 저장 버튼을 눌러 주세요.</p>
    {reason && <p role="status">{reason}</p>}
    {install && <button type="button" disabled={installing} onClick={() => void promptInstall()}>홈 화면에 설치</button>}
  </details>;
}
