import { useAssetUrl } from '../offline/useAssetUrl';
import AssetOcr from '../ocr/AssetOcr';
import { useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { Download, File } from 'lucide-react';
import { usePageResource } from './usePageResource';

type AssetInfo = { id: string; name: string; mime: string; size: number };
function AssetView({ assetId, display }: { assetId: string; display: string }) {
  const { item, state, reload } = usePageResource<AssetInfo>(`/api/assets/${assetId}/info`);
  const [imageError, setImageError] = useState(false);
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
  const image = display === 'image' && /^image\/(png|jpeg|webp|gif|avif)$/.test(item.mime);
  const size =
    item.size >= 1024 * 1024
      ? `${(item.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(item.size / 1024))} KB`;
  return (
    <figure
      className={'page-asset ' + (image ? 'page-asset-image' : 'page-asset-file')}
      contentEditable={false}
    >
      {image && !imageError && (
        <a href={path} target="_blank" rel="noopener noreferrer">
          <img src={path} alt={item.name} loading="lazy" onError={() => setImageError(true)} />
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
      <figcaption>
        <a href={path} target="_blank" rel="noopener noreferrer" download={item.name}>
          <File size={17} />
          <span title={item.name}>{item.name}</span>
          <small>{size}</small>
          <Download size={16} />
        </a>
      </figcaption>
      {/^image\/(png|jpeg|webp)$/.test(item.mime) && <AssetOcr assetId={assetId}/> }
    </figure>
  );
}

export const createAssetBlockSpec = createReactBlockSpec(
  {
    type: 'asset',
    propSchema: {
      assetId: { default: '' },
      display: { default: 'file', values: ['image', 'file'] as const },
    },
    content: 'none',
  },
  {
    render: ({ block }) => (
      <AssetView assetId={block.props.assetId} display={block.props.display} />
    ),
    toExternalHTML: ({ block }) => (
      <p>
        첨부 {block.props.display === 'image' ? '이미지' : '파일'} (앱 전용 참조, 파일 바이트 제외):{' '}
        {block.props.assetId}
      </p>
    ),
  },
);
