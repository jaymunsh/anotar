import { useState } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { createReactBlockSpec } from '@blocknote/react';
import { ExternalLink, MapPinned, Pencil } from 'lucide-react';
import './mapBlock.css';
import ItineraryPreview from './ItineraryPreview';
import PlanImagePicker from './PlanImagePicker';
import { itineraryPlaceUrl } from '../../shared/itinerary';

type MapProps = {
  latitude: number;
  longitude: number;
  zoom: number;
  label: string;
  assetId?: string;
};
type AnyEditor = BlockNoteEditor<any, any, any>;

export function mapUrls({ latitude, longitude }: MapProps) {
  return { open: itineraryPlaceUrl({ latitude, longitude } as any)! };
}

function MapView({ block, editor }: { block: { id: string; props: MapProps }; editor: AnyEditor }) {
  const { latitude, longitude, label, assetId } = block.props;
  const [editing, setEditing] = useState(false);
  const urls = mapUrls(block.props);
  const update = (props: Partial<MapProps>) => editor.updateBlock(block.id, { props });
  return (
    <div className="page-map-block" contentEditable={false}>
      <div className="page-map-head">
        <MapPinned size={18} aria-hidden />
        <div>
          <strong>{label || '장소 지도'}</strong>
          <small>
            {latitude.toFixed(4)}, {longitude.toFixed(4)}
          </small>
        </div>
        <a href={urls.open} target="_blank" rel="noreferrer">
          Google Maps에서 열기 <ExternalLink size={14} />
        </a>
      </div>
      {editor.isEditable && editing && (
        <div className="page-map-fields">
          <label>
            장소 이름
            <input
              aria-label="지도 장소 이름"
              defaultValue={label}
              maxLength={160}
              onBlur={(event) => update({ label: event.target.value.trim() || '장소 지도' })}
            />
          </label>
          <label>
            위도
            <input
              aria-label="지도 위도"
              type="number"
              min="-90"
              max="90"
              step="any"
              defaultValue={latitude}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= -90 && value <= 90)
                  update({ latitude: value });
              }}
            />
          </label>
          <label>
            경도
            <input
              aria-label="지도 경도"
              type="number"
              min="-180"
              max="180"
              step="any"
              defaultValue={longitude}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= -180 && value <= 180)
                  update({ longitude: value });
              }}
            />
          </label>
          <PlanImagePicker
            editor={editor}
            value={assetId || ''}
            onChange={(value) => update({ assetId: value })}
          />
        </div>
      )}
      <div className="page-map-actions">
        {editor.isEditable && (
          <button
            type="button"
            className="page-map-edit"
            aria-expanded={editing}
            onClick={() => setEditing((value) => !value)}
          >
            <Pencil size={13} />
            {editing ? '수정 닫기' : '위치 수정'}
          </button>
        )}
      </div>
      <ItineraryPreview
        assetId={assetId}
        entries={[
          { id: block.id, date: '', start: '', title: label, place: label, latitude, longitude },
        ]}
      />
    </div>
  );
}

export const createMapBlockSpec = createReactBlockSpec(
  {
    type: 'map',
    propSchema: {
      latitude: { default: 37.5665 },
      longitude: { default: 126.978 },
      zoom: { default: 13 },
      label: { default: '장소 지도' },
      assetId: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => (
      <MapView block={block as { id: string; props: MapProps }} editor={editor as AnyEditor} />
    ),
  },
);

export function getMapSlashMenuItems(editor: AnyEditor) {
  if (!('map' in editor.schema.blockSchema)) return [];
  return [
    {
      title: '지도',
      subtext: '장소 이미지와 Google Maps 링크를 넣습니다',
      aliases: ['지도', 'map', '장소'],
      group: '고급',
      icon: <MapPinned size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'map' } as any),
    },
  ];
}
