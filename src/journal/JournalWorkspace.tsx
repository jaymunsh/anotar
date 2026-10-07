import { useEffect, useRef, useState } from 'react';
import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';
import { mountTimeboxing } from './controller.mjs';
import template from '../../docs/design/timeboxing-preview.html?raw';
import styles from '../../docs/design/timeboxing-preview.css?raw';
import { createJournalStorage } from './storage';
import { registerLocalFlush } from '../offline/update';
import LegacyJournalReview from './LegacyJournalReview';
import type { JournalMigrationCollision } from './migration';

const scopedStyles = styles
  .replace(/:root(\[[^\]]+\])/g, ':host($1)')
  .replaceAll(':root', ':host')
  .replace(/(^|\n)body(?=\s*\{)/g, '$1.journal-body');
const body =
  template
    .match(/<body>([\s\S]*)<\/body>/)?.[1]
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(
      '미이행은 직접 표시한 계획만 모아요. 오늘 예시는 2026년 10월 5일 기준이에요.',
      '미이행은 직접 표시한 계획만 모아요.',
    )
    .replace('브라우저 저장 예시', '기기 저장과 서버 동기화') || '';

export default function JournalWorkspace() {
  const host = useRef<HTMLDivElement>(null);
  const [collisions,setCollisions]=useState<JournalMigrationCollision[]>([]);
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    let unregisterFlush: (() => void) | undefined;
    let flushStorage: (() => Promise<void>) | undefined;
    const hidden = () => { if (document.visibilityState === 'hidden') void flushStorage?.().catch(() => {}); };
    const pagehide = () => { void flushStorage?.().catch(() => {}); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    const element = host.current!;
    const root = element.shadowRoot || element.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${scopedStyles}\n:host { display:block; min-width:0; } .topbar { display:none; } .sheet { padding:16px clamp(16px,3vw,40px) 40px; } @media (min-width:761px) { .sheet { padding-right:76px; } } .journal-body { font-family:inherit; }</style><div class="journal-body">${body}</div>`;
    const applyTheme = () => {
      element.dataset.theme = document.documentElement.dataset.theme || 'light';
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    root.getElementById('saveStatus')!.textContent = '기기 저장소 준비 중…';
    void createJournalStorage().then(storage => {
      if (!active) return;
      setCollisions(storage.collisions);
      flushStorage = storage.flush;
      unregisterFlush = registerLocalFlush(storage.flush);
      dispose = mountTimeboxing(root, {
        today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
        empty: true,
        embedded: true,
        storage,
      });
    }).catch(error => {
      if (!active) return;
      root.getElementById('saveStatus')!.textContent = '일지를 불러오지 못했어요';
      const alert = root.getElementById('storageError')!;
      alert.hidden = false;
      alert.textContent = error instanceof Error ? error.message : '서버에 한 번 연결한 뒤 다시 열어 주세요. 기존 기기 자료는 유지돼요.';
    });
    return () => {
      active = false;
      observer.disconnect();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      void flushStorage?.().catch(() => {});
      dispose?.();
      unregisterFlush?.();
      root.replaceChildren();
    };
  }, []);
  return (
    <>
      <WorkspaceToolbar title="일지" meta="기기 저장과 서버 동기화" />
      {collisions.length>0&&<LegacyJournalReview initial={collisions} />}
      <main aria-label="타임박싱 일지" style={{ minWidth: 0 }}>
        <div ref={host} />
      </main>
    </>
  );
}
