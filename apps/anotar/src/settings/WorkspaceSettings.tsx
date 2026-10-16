import {savedAppFont, applyAppFont, type AppFont} from './appearance';
import AiSettingsPanel from './AiSettingsPanel';
import DocumentTypographySettings from './DocumentTypographySettings';
import DeviceStorage from '../offline/DeviceStorage';
import SecuritySettings from '../auth/SecuritySettings';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  DatabaseBackup,
  ExternalLink,
  HardDrive,
  Globe,
  Info,
  Moon,
  Network,
  Palette,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import './settings.css';
import { architecturePageId } from '../../shared/architecturePage';
import { usePageResource } from '../pages/usePageResource';

function ArchitectureResource() {
  const { item } = usePageResource<{ id: string }>(`/api/pages/${architecturePageId}`);
  return <>
    <nav aria-label="서비스 문서">
      <a href={item ? `/pages/${item.id}` : '/architecture.html'}
        {...(!item ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <Network size={18} aria-hidden="true" />
        <span><strong>기술 아키텍처</strong><small>기술 스택, 파일 진입점, 저장·동기화와 운영 구조</small></span>
        {item ? <ChevronRight size={16} aria-hidden="true" /> : <ExternalLink size={16} aria-hidden="true" />}
      </a>
    </nav>
    <p className="settings-save-note">{item ? '일반 페이지에서 내용을 수정하고 공유할 수 있어요.' : '문서는 새 탭에서 열립니다.'}</p>
  </>;
}

const sections = [
  { id: 'appearance', label: '화면', Icon: Palette },
  { id: 'ai', label: 'AI', Icon: WandSparkles },
  { id: 'storage', label: '기기 저장소', Icon: HardDrive },
  { id: 'security', label: '보안', Icon: ShieldCheck },
  { id: 'workspace', label: '작업 공간', Icon: Settings },
  { id: 'about', label: '서비스 정보', Icon: Info },
] as const;
type Section = (typeof sections)[number]['id'];

export default function WorkspaceSettings({
  theme,
  onThemeChange,
  onClose,
  onOpen,
  initialSection = 'appearance',
}: {
  initialSection?: Section;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  onClose: () => void;
  onOpen: (path: '/prompts' | '/backups' | '/trash' | '/hosting') => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [appFont,setAppFont]=useState(savedAppFont);
  const [section, setSection] = useState<Section>(initialSection);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="workspace-settings"
      aria-labelledby="workspace-settings-title"
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        // Keep keyboard focus in the modal, including fields and links as well as buttons.
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          event.currentTarget.close();
      }}
    >
      <header className="settings-heading">
        <h2 id="workspace-settings-title">설정</h2>
        <button
          type="button"
          className="settings-close"
          aria-label="설정 닫기"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-profile">
            <img src="/profile.png" alt="" width="28" height="28" />
            <div>
              <strong>나의 공간</strong>
              <span>개인 작업 공간</span>
            </div>
          </div>
          <nav aria-label="설정 항목">
            {sections.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={section === id}
                aria-controls="settings-detail"
                onClick={() => setSection(id)}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <div id="settings-detail" className="settings-content">
          {section === 'appearance' && (
            <section aria-labelledby="settings-appearance-title">
              <h3 id="settings-appearance-title">화면</h3>
              <p className="settings-description">편안하게 읽고 작업할 수 있는 화면</p>
              <div className="settings-row">
                <div>
                  <strong>화면 모드</strong>
                  <p>선택한 모드를 이 브라우저에 기억해요.</p>
                </div>
                <button
                  type="button"
                  className="settings-theme"
                  aria-label="화면 모드 전환"
                  aria-pressed={theme === 'dark'}
                  title={theme === 'dark' ? '밝은 화면으로 전환' : '어두운 화면으로 전환'}
                  onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? (
                    <Moon size={16} aria-hidden="true" />
                  ) : (
                    <Sun size={16} aria-hidden="true" />
                  )}
                  {theme === 'dark' ? '어두움' : '밝음'}
                </button>
              </div>
              <div className="settings-row">
                <div><strong>앱 글꼴</strong><p>메뉴, 메모, 일지와 문서에 함께 적용해요.</p></div>
                <select aria-label="앱 글꼴" value={appFont} onChange={event=>{const font=event.target.value as AppFont;setAppFont(font);applyAppFont(font);}}>
                  <option value="default">기본</option><option value="pretendard">Pretendard</option><option value="ridibatang">리디바탕</option>
                </select>
              </div>
              <DocumentTypographySettings />
              <p className="settings-save-note">변경한 설정은 자동으로 저장됩니다.</p>
            </section>
          )}
          {section === 'ai' && <AiSettingsPanel />}
          {section === 'storage' && <DeviceStorage />}
          {section === 'security' && <SecuritySettings />}
          {section === 'workspace' && (
            <section className="settings-resources" aria-labelledby="settings-resources-title">
              <h3 id="settings-resources-title">작업 공간</h3>
              <p className="settings-description">템플릿을 관리하고, 자료를 보관·복원하세요.</p>
              <nav aria-label="작업 공간 설정">
                {[
                  {
                    path: '/prompts' as const,
                    title: '프롬프트',
                    description: 'AI 요청에 사용할 템플릿',
                    Icon: WandSparkles,
                  },
                  {
                    path: '/hosting' as const,
                    title: '웹 호스팅',
                    description: 'HTML 사이트 등록과 공개 상태',
                    Icon: Globe,
                  },
                  {
                    path: '/backups' as const,
                    title: '백업',
                    description: '자동 백업과 저장 상태',
                    Icon: DatabaseBackup,
                  },
                  {
                    path: '/trash' as const,
                    title: '휴지통',
                    description: '삭제한 메모와 페이지 복원',
                    Icon: Trash2,
                  },
                ].map(({ path, title, description, Icon }) => (
                  <button key={path} type="button" onClick={() => onOpen(path)} aria-label={title}>
                    <Icon size={18} aria-hidden="true" />
                    <span>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </nav>
            </section>
          )}
          {section === 'about' && (
            <section className="settings-resources" aria-labelledby="settings-about-title">
              <h3 id="settings-about-title">서비스 정보</h3>
              <p className="settings-description">
                anotar는 개인 서버에 두고 쓰는 메모·문서 작업 공간이에요.
              </p>
              <ArchitectureResource />
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
