import { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { createReactBlockSpec } from '@blocknote/react';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ExternalLink,
  MapPinned,
  Plus,
  Trash2,
  Footprints,
  Camera,
  Utensils,
  Coffee,
  Bed,
  Tag,
  AlertTriangle,
  MoreHorizontal,
} from 'lucide-react';
import {
  cleanItinerary,
  itineraryPlaceUrl,
  itineraryRelatedUrl,
  itineraryCategories,
  itineraryDuration,
  itineraryOverlaps,
  itineraryVisitNumbers,
  itineraryNextSlot,
} from '../../shared/itinerary';
import ItineraryPreview from './ItineraryPreview';
import PlanImagePicker from './PlanImagePicker';
import ItineraryInlineField from './ItineraryInlineField';
import './itineraryInline.css';
import PlanConnections from './PlanConnections';
import MapImageControls from './MapImageControls';
import { staticMapInput, staticMapImageMetadata } from '../../shared/staticMap';
import type { Itinerary, ItineraryEntry } from '../../shared/itinerary';
import './itinerary.css';
import '../../public/itinerary-timetable.css';
import { itineraryDaySummaries, itineraryNoteLines } from '../../shared/itineraryReading';
const ItineraryMap = lazy(() => import('./ItineraryMap'));
type AnyEditor = BlockNoteEditor<any, any, any>;
type ItineraryDraft = Itinerary & { imageAssetId: string };
const activityIcons = {
  sightseeing: Camera,
  travel: Footprints,
  meal: Utensils,
  rest: Coffee,
  stay: Bed,
  other: Tag,
};
const draftKey = (id: string) => 'leneu:itinerary-draft:v1:' + id;
function readDraft(id: string, base: string, assetId: string): ItineraryDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      value.base !== base ||
      (value.baseAssetId || '') !== assetId ||
      value.data?.version !== 1 ||
      value.data.timezone !== 'Asia/Seoul' ||
      typeof value.data.title !== 'string' ||
      !Array.isArray(value.data.entries) ||
      value.data.entries.length > 50 ||
      !value.data.entries.every(
        (entry: any) =>
          entry &&
          typeof entry.id === 'string' &&
          typeof entry.date === 'string' &&
          typeof entry.start === 'string' &&
          typeof entry.title === 'string',
      )
    )
      return null;
    return {
      ...value.data,
      imageAssetId: typeof value.data.imageAssetId === 'string' ? value.data.imageAssetId : assetId,
    };
  } catch {
    return null;
  }
}
const empty: Itinerary = { version: 1, title: '새 일정', timezone: 'Asia/Seoul', entries: [] };
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function ItineraryView({
  block,
  editor,
}: {
  block: {
    id: string;
    props: { data: string; assetId?: string; imageSource?: string; imageInput?: string };
  };
  editor: AnyEditor;
}) {
  const data = useMemo(() => {
    try {
      return cleanItinerary(block.props.data);
    } catch {
      return null;
    }
  }, [block.props.data]);
  const [mapOpen, setMapOpen] = useState(
    () => new URLSearchParams(window.location.search).get('map') === 'google',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected) return;
    const outside = (event: PointerEvent) => {
      if (!surface.current?.contains(event.target as Node)) setSelected(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [selected]);
  const [draft, setDraftState] = useState<ItineraryDraft | null>(() =>
    readDraft(block.id, block.props.data, block.props.assetId || ''),
  );
  const draftRef = useRef(draft);
  const [recovered, setRecovered] = useState(Boolean(draft));
  const [focusEntry, setFocusEntry] = useState<string | null>(null);
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [editingFields, setEditingFields] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  function setDraft(
    next: ItineraryDraft | null | ((previous: ItineraryDraft | null) => ItineraryDraft | null),
  ) {
    const value = typeof next === 'function' ? next(draftRef.current) : next;
    draftRef.current = value;
    try {
      if (value) {
        const live = editor.getBlock(block.id) as typeof block | undefined;
        localStorage.setItem(
          draftKey(block.id),
          JSON.stringify({
            base: live?.props.data || block.props.data,
            baseAssetId: live?.props.assetId || '',
            data: value,
          }),
        );
      } else localStorage.removeItem(draftKey(block.id));
    } catch {
      setError(
        '이 브라우저에 일정 초안을 보관하지 못했어요. 수정 내용을 저장하기 전에는 페이지를 닫지 마세요.',
      );
    }
    setDraftState(value);
  }
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('leneu:itinerary-editing', {
        detail: { blockId: block.id, editing: Boolean(draft) || editingFields.size > 0 },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent('leneu:itinerary-editing', {
          detail: { blockId: block.id, editing: false },
        }),
      );
    };
  }, [block.id, Boolean(draft), editingFields.size > 0]);
  function currentDraft(): ItineraryDraft {
    const live = editor.getBlock(block.id) as typeof block | undefined;
    return {
      ...cleanItinerary(live?.props.data || block.props.data),
      imageAssetId: live?.props.assetId || '',
    };
  }
  function stageEntry(id: string, patch: Partial<ItineraryEntry>) {
    setDraft((previous) => {
      const next = previous || currentDraft();
      return {
        ...next,
        entries: next.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      };
    });
  }
  function save(next = draftRef.current): string | undefined {
    if (!next) return;
    if (!editor.isEditable) return '지금은 페이지를 수정할 수 없어요. 초안은 보관되어 있어요.';
    try {
      const { imageAssetId, ...input } = next;
      const value = cleanItinerary(input);
      editor.updateBlock(block.id, {
        props: {
          data: JSON.stringify(value),
          assetId: imageAssetId,
          ...staticMapImageMetadata(editor.document, imageAssetId),
        },
      });
      setDraft(null);
      setRecovered(false);
      setFocusEntry(null);
      setError('');
    } catch (e) {
      const message = e instanceof Error ? e.message : '일정을 확인해 주세요.';
      setError(message);
      return message;
    }
  }
  function cancelField(id: string, field: keyof ItineraryEntry) {
    const live = currentDraft();
    stageEntry(id, { [field]: live.entries.find((entry) => entry.id === id)?.[field] });
    if (JSON.stringify(draftRef.current) === JSON.stringify(live)) setDraft(null);
    setError('');
  }
  function cancelCoordinates(id: string) {
    const live = currentDraft();
    const entry = live.entries.find((item) => item.id === id);
    stageEntry(id, { latitude: entry?.latitude, longitude: entry?.longitude });
    if (JSON.stringify(draftRef.current) === JSON.stringify(live)) setDraft(null);
    setError('');
  }
  function fieldEditing(key: string, editing: boolean) {
    setEditingFields((previous) => {
      if (previous.has(key) === editing) return previous;
      const next = new Set(previous);
      if (editing) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  function entryField(
    entry: ItineraryEntry,
    field: 'title' | 'place' | 'note' | 'date' | 'start' | 'end' | 'url' | 'category',
    label: string,
    children?: React.ReactNode,
  ) {
    return (
      <ItineraryInlineField
        value={String(entry[field] || '')}
        label={label}
        field={field}
        editable={editor.isEditable}
        multiline={field === 'note'}
        type={
          field === 'date'
            ? 'date'
            : field === 'start' || field === 'end'
              ? 'time'
              : field === 'url'
                ? 'url'
                : 'text'
        }
        maxLength={field === 'note' ? 1000 : field === 'url' ? 2048 : 160}
        options={field === 'category' ? itineraryCategories : undefined}
        autoEdit={focusEntry === entry.id && field === 'title'}
        onDraft={(value) =>
          stageEntry(entry.id, {
            [field]: value || (['title', 'date', 'start'].includes(field) ? '' : undefined),
          })
        }
        onCommit={() => (recovered ? undefined : save())}
        onCancel={() => cancelField(entry.id, field)}
        onEditing={(editing) => fieldEditing(`${entry.id}:${field}`, editing)}
      >
        {children}
      </ItineraryInlineField>
    );
  }
  function changeEntries(change: (entries: ItineraryEntry[]) => ItineraryEntry[]) {
    const next = draftRef.current || currentDraft();
    const changed = { ...next, entries: change(next.entries) };
    setDraft(changed);
    if (!recovered) save(changed);
  }
  function reorder(index: number, offset: number) {
    changeEntries((rows) => {
      const entries = [...rows];
      [entries[index], entries[index + offset]] = [entries[index + offset], entries[index]];
      return entries;
    });
  }
  function addEntry() {
    const id = crypto.randomUUID();
    changeEntries((entries) => [
      ...entries,
      { id, ...itineraryNextSlot(entries, today()), title: '새 일정' },
    ]);
    setFocusEntry(id);
  }
  if (!data)
    return <p role="alert">일정 자료를 읽을 수 없어요. 수정 이력에서 이전 내용을 확인해 주세요.</p>;
  const view = recovered && draft ? draft : data;
  const places = view.entries.filter(
    (e) => e.category !== 'travel' && e.latitude !== undefined,
  ).length;
  const numbers = itineraryVisitNumbers(view.entries);
  const overlaps = itineraryOverlaps(view.entries);
  const days = itineraryDaySummaries(view.entries);
  return (
    <section
      ref={surface}
      className="itinerary-block"
      contentEditable={false}
      aria-label={data.title || '일정'}
    >
      <header className="itinerary-heading">
        <CalendarDays size={18} />
        <strong>
          <ItineraryInlineField
            value={view.title}
            label="일정 이름"
            field="plan-title"
            editable={editor.isEditable}
            onDraft={(title) => setDraft({ ...(draftRef.current || currentDraft()), title })}
            onCommit={() => (recovered ? undefined : save())}
            onCancel={() => {
              setDraft((previous) =>
                previous ? { ...previous, title: currentDraft().title } : null,
              );
              if (JSON.stringify(draftRef.current) === JSON.stringify(currentDraft()))
                setDraft(null);
            }}
            onEditing={(editing) => fieldEditing('plan-title', editing)}
          >
            {view.title || '일정'}
          </ItineraryInlineField>
        </strong>
        <small>UTC+9</small>
        <div className="itinerary-controls">
          {places > 0 && <button
            type="button"
            onClick={() => setMapOpen((v) => !v)}
            aria-expanded={mapOpen}
            disabled={!places}
          >
            <MapPinned size={14} />
            {mapOpen ? '지도 접기' : `장소 ${places}개 지도 보기`}
          </button>}
          {editor.isEditable && (
            <details
              className="itinerary-plan-menu"
              onToggle={(event) => setPlanMenuOpen(event.currentTarget.open)}
            >
              <summary aria-label="일정 설정">
                <MoreHorizontal size={16} />
              </summary>
              <div className="itinerary-property-menu">
                <strong>지도 이미지</strong>
                {planMenuOpen && (
                  <PlanImagePicker
                    editor={editor}
                    value={draft?.imageAssetId ?? block.props.assetId ?? ''}
                    onChange={(imageAssetId) => {
                      const next = { ...(draftRef.current || currentDraft()), imageAssetId };
                      setDraft(next);
                      if (!recovered) save(next);
                    }}
                  />
                )}
                <p className="itinerary-inline-hint">
                  클릭해서 수정 · Tab으로 다음 항목 · Enter로 저장 · 설명은 ⌘/Ctrl+Enter로 저장
                </p>
              </div>
            </details>
          )}
        </div>
      </header>
      {(places > 0 || Boolean(block.props.assetId)) && <MapImageControls
        blockId={block.id}
        hasImage={Boolean(block.props.assetId)}
        stale={
          block.props.imageSource === 'geoapify' &&
          block.props.imageInput !== staticMapInput(data.entries)
        }
        missing={[...numbers.values()].length - places}
        places={places}
      />}
      {recovered && draft && (
        <div className="itinerary-recovered-draft" role="status">
          <span>이전에 입력한 일정 초안이 있어요. 내용을 확인한 뒤 적용해 주세요.</span>
          <button type="button" onClick={() => save()}>
            복구한 초안 적용
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setRecovered(false);
              setError('');
            }}
          >
            초안 버리기
          </button>
        </div>
      )}
      <div className="itinerary-reading">
        {view.entries.length > 0 && (
          <div className="itinerary-visual">
            {mapOpen && places > 0 ? (
              <Suspense fallback={<p role="status">지도를 여는 중…</p>}>
                <ItineraryMap entries={view.entries} selectedId={selected} onSelect={setSelected} />
              </Suspense>
            ) : (
              <ItineraryPreview
                entries={view.entries}
                assetId={block.props.assetId}
                imageSource={block.props.imageSource}
              />
            )}
          </div>
        )}
        <ol className="itinerary-timeline">
          {view.entries.map((entry, index) => {
            const map = itineraryPlaceUrl(entry);
            const related = itineraryRelatedUrl(entry);
            const Icon = entry.category ? activityIcons[entry.category] : null;
            const duration = itineraryDuration(entry);
            const notes = itineraryNoteLines(entry.note);
            const day = days.find((day) => day.date === entry.date)!;
            const dateChanged = index === 0 || view.entries[index - 1].date !== entry.date;
            return (
              <li
                key={entry.id}
                data-entry-id={entry.id}
                className={[
                  selected === entry.id ? 'is-selected' : '',
                  !numbers.has(entry.id) ? 'itinerary-travel' : '',
                  `itinerary-activity-${entry.category || 'other'}`,
                ].join(' ')}
              >
                {dateChanged && (
                  <div className="itinerary-day itinerary-day-summary">
                    <strong>{day.label}</strong>
                    <span>
                      {day.start}
                      {day.end !== day.start ? `–${day.end}` : ''} · 방문 {day.visits}곳
                    </span>
                    <span className="itinerary-day-labels" aria-hidden>
                      시간 / 일정
                    </span>
                  </div>
                )}
                <div className="itinerary-stop" onClick={() => setSelected(entry.id)}>
                  <span className="itinerary-time">
                    <time>{entryField(entry, 'start', '시작 시간', entry.start)}</time>
                    <small>
                      –{' '}
                      {entryField(
                        entry,
                        'end',
                        '끝 시간',
                        entry.end || (editor.isEditable ? '끝 시간' : ''),
                      )}
                    </small>
                    {duration && <span className="itinerary-duration">{duration}</span>}
                  </span>
                  <button
                    type="button"
                    className="itinerary-number"
                    aria-label={`${entry.title} 지도에서 선택`}
                    aria-pressed={selected === entry.id}
                  >
                    {numbers.get(entry.id) || (Icon && <Icon size={14} aria-hidden />)}
                  </button>
                  <span className="itinerary-stop-text">
                    <span className="itinerary-entry-title">
                      <strong>{entryField(entry, 'title', '일정 내용', entry.title)}</strong>
                      <span className="itinerary-category">
                        {entryField(
                          entry,
                          'category',
                          '활동 유형',
                          entry.category
                            ? itineraryCategories[entry.category]
                            : editor.isEditable
                              ? '유형'
                              : '',
                        )}
                      </span>
                    </span>
                    {overlaps.has(entry.id) && (
                      <span className="itinerary-entry-meta">
                        <span className="itinerary-overlap">
                          <AlertTriangle size={12} aria-hidden />
                          시간 겹침
                        </span>
                      </span>
                    )}
                    {entry.place && entry.place !== entry.title && (
                      <span className="itinerary-entry-place">
                        {entryField(
                          entry,
                          'place',
                          '장소',
                          entry.place || (
                            <span className="itinerary-inline-placeholder">장소 추가</span>
                          ),
                        )}
                      </span>
                    )}
                  </span>
                  {editor.isEditable && (
                    <details className="itinerary-row-menu">
                      <summary aria-label={`${entry.title} 일정 메뉴`}>
                        <MoreHorizontal size={15} />
                      </summary>
                      <div className="itinerary-property-menu">
                        <div className="itinerary-property-row">
                          <span>날짜</span> {entryField(entry, 'date', '일정 날짜', entry.date)}
                        </div>
                        <div className="itinerary-property-row">
                          <span>링크</span>{' '}
                          {entryField(entry, 'url', '관련 링크', entry.url || '링크 추가')}
                        </div>
                        {!entry.place && (
                          <div className="itinerary-property-row">
                            <span>장소</span>
                            {entryField(entry, 'place', '장소', '장소 추가')}
                          </div>
                        )}
                        <details className="itinerary-coordinate-options">
                          <summary>지도 좌표</summary>
                          <div className="itinerary-coordinate-fields">
                            <label>
                              위도
                              <input
                                type="number"
                                aria-label="위도"
                                min={-90}
                                max={90}
                                step="any"
                                value={
                                  draft
                                    ? (draft.entries.find((e) => e.id === entry.id)?.latitude ?? '')
                                    : (entry.latitude ?? '')
                                }
                                onChange={(e) =>
                                  stageEntry(entry.id, {
                                    latitude:
                                      e.target.value === '' ? undefined : Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              경도
                              <input
                                type="number"
                                aria-label="경도"
                                min={-180}
                                max={180}
                                step="any"
                                value={
                                  draft
                                    ? (draft.entries.find((e) => e.id === entry.id)?.longitude ??
                                      '')
                                    : (entry.longitude ?? '')
                                }
                                onChange={(e) =>
                                  stageEntry(entry.id, {
                                    longitude:
                                      e.target.value === '' ? undefined : Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          {error && (
                            <p className="itinerary-inline-error" role="alert">
                              {error}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (!recovered) save();
                            }}
                          >
                            좌표 적용
                          </button>
                          <button type="button" onClick={() => cancelCoordinates(entry.id)}>
                            좌표 취소
                          </button>
                        </details>
                        <PlanConnections
                          blockId={block.id}
                          entryId={entry.id}
                          editable={editor.isEditable}
                          mode="manage"
                        />
                        <div className="itinerary-row-actions">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => reorder(index, -1)}
                          >
                            <ArrowUp size={14} /> 위로 이동
                          </button>
                          <button
                            type="button"
                            disabled={index === view.entries.length - 1}
                            onClick={() => reorder(index, 1)}
                          >
                            <ArrowDown size={14} /> 아래로 이동
                          </button>
                          <button
                            type="button"
                            className="itinerary-row-delete"
                            onClick={() =>
                              changeEntries((rows) => rows.filter((e) => e.id !== entry.id))
                            }
                          >
                            <Trash2 size={14} /> 일정 삭제
                          </button>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
                {(map || entry.url) && (
                  <div className="itinerary-links">
                    {map && (
                      <a
                        href={map}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${entry.title} Google Maps에서 열기`}
                      >
                        <MapPinned size={12} aria-hidden /> 장소{' '}
                        <ExternalLink size={11} aria-hidden />
                      </a>
                    )}
                    {related && (
                      <a href={related} target="_blank" rel="noreferrer">
                        관련 링크 <ExternalLink size={11} aria-hidden />
                      </a>
                    )}
                  </div>
                )}
                {(notes.length > 0 || editor.isEditable) && (
                  <div
                    className={`itinerary-entry-note${!notes.length ? ' itinerary-empty-note' : ''}`}
                  >
                    {entryField(
                      entry,
                      'note',
                      '일정 설명',
                      <>
                        {notes.length ? (
                          notes.map((line, index) => (
                            <p
                              key={index}
                              className={`itinerary-note-line${line.time ? ' is-timed' : ''}${line.label ? ' is-property' : ''}`}
                            >
                              {line.time && (
                                <span className="itinerary-note-time">{line.time}</span>
                              )}
                              {line.label && (
                                <span className="itinerary-note-label">{line.label}</span>
                              )}
                              <span>{line.text}</span>
                            </p>
                          ))
                        ) : (
                          <span className="itinerary-inline-placeholder">설명 추가</span>
                        )}
                      </>,
                    )}
                  </div>
                )}
                <PlanConnections
                  blockId={block.id}
                  entryId={entry.id}
                  editable={editor.isEditable}
                  showStatus={index === 0}
                />
              </li>
            );
          })}
          {!view.entries.length && (
            <li className="itinerary-empty">아래에서 첫 일정을 추가해 보세요.</li>
          )}
        </ol>
      </div>
      {editor.isEditable && (
        <button
          type="button"
          className="itinerary-inline-add"
          disabled={view.entries.length >= 50}
          onClick={addEntry}
        >
          <Plus size={15} /> 일정 추가
        </button>
      )}
      {error && (
        <p className="itinerary-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export const createItineraryBlockSpec = createReactBlockSpec(
  {
    type: 'itinerary',
    propSchema: {
      data: { default: JSON.stringify(empty) },
      assetId: { default: '' },
      imageSource: { default: '' },
      imageInput: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => (
      <ItineraryView block={block as any} editor={editor as AnyEditor} />
    ),
  },
);
export function getItinerarySlashMenuItems(editor: AnyEditor) {
  return [
    {
      title: '일정과 지도',
      subtext: '시간표와 여러 장소를 한 블록에 연결합니다',
      aliases: ['일정', '시간표', '여행', 'itinerary', 'plan'],
      group: '고급',
      icon: <CalendarDays size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'itinerary' } as any),
    },
  ];
}
