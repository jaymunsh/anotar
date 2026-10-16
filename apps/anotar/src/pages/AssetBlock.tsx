import { useAssetUrl } from '../offline/useAssetUrl';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import {
  Download,
  File,
  Image,
  Crop,
  ExternalLink,
  MessageSquare,
  MoreHorizontal,
} from 'lucide-react';
import { usePageResource } from './usePageResource';
import { assetCropStyles, assetFileSize, IMAGE_MIME } from '../../shared/assetPresentation.mjs';
import AssetCropDialog from './AssetCropDialog';
import './pageAttachments.css';
export const AssetEditContext = createContext(false);
type CaptionSession = { blockId: string; assetId: string; draft: string };
type CropSession = { blockId: string; assetId: string; src: string; name: string; initial: string };
const AssetSessionsContext = createContext<{
  caption: CaptionSession | null;
  setCaption: (value: CaptionSession | null) => void;
  openCrop: (value: CropSession) => void;
}>({ caption: null, setCaption: () => {}, openCrop: () => {} });
export function AssetAttachmentProvider({
  children,
  editor,
  disabled,
  pageId,
}: {
  children: ReactNode;
  editor: BlockNoteEditor<any, any, any>;
  disabled: boolean;
  pageId: string;
}) {
  const [caption, setCaption] = useState<CaptionSession | null>(null);
  const [crop, setCrop] = useState<(CropSession & { pageId: string }) | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setCaption(null);
    setCrop(null);
    setNotice('');
  }, [pageId]);
  useEffect(() => {
    if (disabled && (caption || crop)) {
      setCaption(null);
      setCrop(null);
      setNotice('편집 상태가 바뀌어 첨부 편집을 닫았어요.');
    }
  }, [disabled, caption, crop]);
  useEffect(
    () =>
      editor.onChange(() => {
        for (const session of [caption, crop]) {
          if (!session) continue;
          const current = editor.getBlock(session.blockId);
          if (current?.type !== 'asset' || current.props.assetId !== session.assetId) {
            setCaption(null);
            setCrop(null);
            setNotice('첨부가 변경되어 편집을 닫았어요. 현재 첨부를 다시 확인해 주세요.');
            break;
          }
        }
      }),
    [editor, caption, crop],
  );
  return (
    <AssetEditContext.Provider value={disabled}>
      <AssetSessionsContext.Provider
        value={{
          caption,
          setCaption,
          openCrop: (value) => {
            setNotice('');
            setCrop({ ...value, pageId });
          },
        }}
      >
        {children}
        {notice && (
          <p className="page-attachment-caption" role="status">
            {notice}
          </p>
        )}
        {crop && !disabled && (
          <AssetCropDialog
            key={pageId + crop.blockId}
            src={crop.src}
            name={crop.name}
            initial={crop.initial}
            onClose={() => setCrop(null)}
            onApply={(value) => {
              const current = editor.getBlock(crop.blockId);
              if (
                !disabled &&
                crop.pageId === pageId &&
                editor.isEditable &&
                current?.type === 'asset' &&
                current.props.assetId === crop.assetId
              )
                editor.updateBlock(current, { props: { crop: value } });
              else
                setNotice(
                  '첨부가 변경되어 자르기를 적용하지 못했어요. 현재 첨부를 다시 확인해 주세요.',
                );
              setCrop(null);
            }}
          />
        )}
      </AssetSessionsContext.Provider>
    </AssetEditContext.Provider>
  );
}
type AssetInfo = { id: string; name: string; mime: string; size: number };
type AssetProps = { assetId: string; display: 'image' | 'file'; caption: string; crop: string };
function AssetView({
  props,
  blockId,
  update,
}: {
  props: AssetProps;
  blockId: string;
  update: (value: Partial<AssetProps>) => void;
}) {
  const { assetId, display, caption, crop } = props,
    disabled = useContext(AssetEditContext);
  const session = useContext(AssetSessionsContext);
  const captionOpen = session.caption?.blockId === blockId && session.caption.assetId === assetId;
  const captionDraft = captionOpen ? session.caption!.draft : caption;
  const setCaptionDraft = (draft: string) => session.setCaption({ blockId, assetId, draft });
  const setCaptionOpen = (open: boolean) =>
    session.setCaption(open ? { blockId, assetId, draft: caption } : null);
  const { item, state, reload } = usePageResource<AssetInfo>(`/api/assets/${assetId}/info`);
  const [imageError, setImageError] = useState(false),
    [menuOpen, setMenuOpen] = useState(false);
  const path = useAssetUrl(assetId);
  if (!item)
    return (
      <div className="page-resource-state" contentEditable={false}>
        {state === 'loading'
          ? '첨부 파일을 불러오는 중…'
          : state === 'missing'
            ? '찾을 수 없는 첨부 파일'
            : '첨부 파일을 불러오지 못했어요.'}
        {state === 'error' && <button onClick={reload}>다시 불러오기</button>}
      </div>
    );
  const image = display === 'image' && IMAGE_MIME.test(item.mime),
    styles = image ? assetCropStyles(crop) : null;
  const commit = (value: Partial<AssetProps>) => {
    if (!disabled) update(value);
  };
  return (
    <figure
      className={`page-asset page-attachment ${image ? 'page-asset-image' : 'page-asset-file'}`}
      contentEditable={false}
    >
      {image && <div className="page-attachment-preview">
        {image && !imageError && (
          <a
            className="page-attachment-original"
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${item.name} 원본 이미지 열기`}
          >
            <div
              className={styles ? 'page-attachment-cropped' : undefined}
              style={styles?.viewport}
            >
              <img
                src={path}
                alt={caption || item.name}
                loading="lazy"
                style={styles?.image}
                onError={() => setImageError(true)}
              />
            </div>
          </a>
        )}
        {imageError && (
          <div className="page-resource-state">
            이미지를 불러오지 못했어요.
            <button
              onClick={() => {
                setImageError(false);
                reload();
              }}
            >
              다시 불러오기
            </button>
          </div>
        )}
        <button
          type="button"
          className="page-attachment-menu-button"
          aria-label={`${item.name} 첨부 메뉴`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={18} />
        </button>
        <div className="page-attachment-toolbar" data-open={menuOpen || undefined}>
          {image && (
            <a href={path} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} /> 원본
            </a>
          )}
          <a href={path} download={item.name}>
            <Download size={15} /> 내려받기
          </a>
          {!disabled && image && (
            <button
              type="button"
              onClick={() => {
                session.openCrop({ blockId, assetId, src: path, name: item.name, initial: crop });
                setMenuOpen(false);
              }}
            >
              <Crop size={15} /> 자르기
            </button>
          )}
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                setCaptionDraft(caption);
                setCaptionOpen(true);
                setMenuOpen(false);
              }}
            >
              <MessageSquare size={15} /> 설명 {caption ? '편집' : '추가'}
            </button>
          )}
        </div>
      </div>}
      <figcaption>
        {image && (captionOpen && !disabled ? (
          <form
            className="page-attachment-caption-form"
            onSubmit={(e) => {
              e.preventDefault();
              commit({ caption: captionDraft.trim() });
              setCaptionOpen(false);
            }}
          >
            <label>
              첨부 설명
              <input
                aria-label="첨부 설명"
                autoFocus
                maxLength={1000}
                value={captionDraft}
                onChange={(e) => setCaptionDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setCaptionOpen(false);
                  }
                }}
              />
            </label>
            <button type="button" onClick={() => setCaptionOpen(false)}>
              취소
            </button>
            <button type="submit">저장</button>
          </form>
        ) : (
          caption && <p className="page-attachment-caption">{caption}</p>
        ))}
        {!image && <a className="page-attachment-file-link" href={path} download={item.name}>
          <File size={17} />
          <span title={item.name}>{item.name}</span>
          <small>{assetFileSize(item.size)}</small>
          <Download size={16} />
        </a>}
      </figcaption>
    </figure>
  );
}
export function getAssetSlashMenuItems(open: (kind: 'image' | 'file') => void) {
  return [
    {
      title: '이미지',
      subtext: '이미지 파일을 올려 본문에 넣기',
      aliases: ['image', '사진', '그림', '첨부'],
      group: '자료',
      icon: <Image size={18} />,
      onItemClick: () => open('image'),
    },
    {
      title: '파일',
      subtext: '파일을 올려 본문에 첨부하기',
      aliases: ['file', 'attachment', '첨부', '문서'],
      group: '자료',
      icon: <File size={18} />,
      onItemClick: () => open('file'),
    },
  ];
}
export const createAssetBlockSpec = createReactBlockSpec(
  {
    type: 'asset',
    propSchema: {
      assetId: { default: '' },
      display: { default: 'file', values: ['image', 'file'] as const },
      caption: { default: '' },
      crop: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => (
      <AssetView
        props={block.props}
        blockId={block.id}
        update={(value) => {
          const current = editor.getBlock(block.id);
          if (
            editor.isEditable &&
            current?.type === 'asset' &&
            current.props.assetId === block.props.assetId
          )
            editor.updateBlock(current, { props: value });
        }}
      />
    ),
    toExternalHTML: ({ block }) => (
      <p>
        첨부 {block.props.display === 'image' ? '이미지' : '파일'} (앱 전용 참조, 파일 바이트 제외):{' '}
        {block.props.assetId}
        {block.props.caption && ` · ${block.props.caption}`}
      </p>
    ),
  },
);
