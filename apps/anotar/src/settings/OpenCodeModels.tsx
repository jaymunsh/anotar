import { useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { mergeModelCatalog, type AiModel } from '../../shared/aiModels';
import { onlineActionFetch } from '../sync/onlineActions';
export default function OpenCodeModels({
  models,
  defaultModel,
  disabled,
  onChange,
  onBusyChange,
}: {
  models: AiModel[];
  defaultModel: string;
  disabled: boolean;
  onChange: (models: AiModel[], defaultModel: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [refreshing, setRefreshing] = useState(false),
    [message, setMessage] = useState('');
  const [newId, setNewId] = useState(''),
    [newName, setNewName] = useState('');
  function change(index: number, patch: Partial<AiModel>) {
    const wasDefault = models[index].id === defaultModel;
    onChange(
      models.map((m, i) => (i === index ? { ...m, ...patch } : m)),
      wasDefault && patch.enabled === false ? '' : wasDefault && patch.id ? patch.id : defaultModel,
    );
  }
  async function refresh() {
    setRefreshing(true);
    onBusyChange(true);
    setMessage('');
    try {
      const response = await onlineActionFetch('/api/ai/models/opencode');
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '목록을 가져오지 못했어요.');
      onChange(mergeModelCatalog(models, data.models), defaultModel);
      setMessage(
        '공식 목록을 가져왔어요. 기존 수정은 유지했으며 새 모델은 꺼져 있어요. 저장하면 적용됩니다.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '기존 목록을 유지했어요.');
    } finally {
      setRefreshing(false);
      onBusyChange(false);
    }
  }
  const locked = disabled || refreshing;
  const visible = models
    .map((model, index) => ({ model, index }))
    .filter(
      ({ model }) =>
        (filter === 'all' ||
          (filter === 'enabled' && model.enabled) ||
          (filter === 'free' && model.pricing === 'free')) &&
        `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <div className="settings-models">
      <label className="settings-ai-field">
        <span>기본 OpenCode 모델</span>
        <select
          aria-label="기본 OpenCode 모델"
          value={defaultModel}
          disabled={locked}
          onChange={(e) => onChange(models, e.target.value)}
        >
          <option value="">모델 선택</option>
          {models
            .filter((m) => m.enabled)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.id}
              </option>
            ))}
        </select>
      </label>
      <details className="settings-model-library">
        <summary>
          모델 목록 관리{' '}
          <span>
            {models.length}개 등록 · {models.filter((m) => m.enabled).length}개 사용
          </span>
        </summary>
        <div className="settings-model-tools">
          <input
            aria-label="OpenCode 모델 검색"
            placeholder="모델 검색"
            value={query}
            disabled={locked}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="OpenCode 모델 필터"
            value={filter}
            disabled={locked}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">전체</option>
            <option value="free">무료 등록</option>
            <option value="enabled">사용 중</option>
          </select>
          <button type="button" disabled={locked} onClick={() => void refresh()}>
            <RefreshCw size={14} />
            {refreshing ? '불러오는 중' : '공식 목록 갱신'}
          </button>
        </div>
        <p>
          가격 표시는 등록 당시 안내예요. 실제 가격·제공 기간·데이터 이용 조건은 제공사에서 확인해
          주세요.
        </p>
        <div className="settings-model-list" aria-label="OpenCode 모델 목록" aria-busy={refreshing}>
          {visible.map(({ model, index }) => (
            <div className="settings-model-row" key={index}>
              <label className="settings-model-toggle">
                <input
                  type="checkbox"
                  aria-label={`${model.id} 사용`}
                  checked={model.enabled}
                  disabled={locked}
                  onChange={(e) => change(index, { enabled: e.target.checked })}
                />
                <span>사용</span>
              </label>
              <div className="settings-model-identifiers">
                <input
                  aria-label={`${model.id} 표시 이름`}
                  value={model.name}
                  disabled={locked}
                  maxLength={120}
                  onChange={(e) => change(index, { name: e.target.value })}
                />
                <input
                  aria-label={`${model.id} 모델 ID`}
                  value={model.id}
                  disabled={locked}
                  spellCheck={false}
                  maxLength={120}
                  onChange={(e) => change(index, { id: e.target.value })}
                />
                {model.available === false && <small>현재 공식 목록에 없음</small>}
              </div>
              <select
                aria-label={`${model.id} 가격 표시`}
                value={model.pricing}
                disabled={locked}
                onChange={(e) => change(index, { pricing: e.target.value as AiModel['pricing'] })}
              >
                <option value="free">무료 등록</option>
                <option value="paid">유료</option>
                <option value="unknown">확인 필요</option>
              </select>
              <button
                type="button"
                aria-label={`${model.id} 삭제`}
                disabled={locked}
                onClick={() =>
                  onChange(
                    models.filter((_, i) => i !== index),
                    model.id === defaultModel ? '' : defaultModel,
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!visible.length && <p>조건에 맞는 모델이 없어요.</p>}
        </div>
        <div className="settings-model-add">
          <input
            aria-label="새 OpenCode 모델 ID"
            placeholder="provider/model-id"
            spellCheck={false}
            value={newId}
            disabled={locked}
            maxLength={120}
            onChange={(e) => setNewId(e.target.value)}
          />
          <input
            aria-label="새 OpenCode 모델 이름"
            placeholder="표시 이름"
            value={newName}
            disabled={locked}
            maxLength={120}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            disabled={locked || !newId.trim()}
            onClick={() => {
              const id = newId.trim();
              if (models.some((m) => m.id === id)) {
                setMessage('이미 등록된 모델 ID예요.');
                return;
              }
              onChange(
                [
                  ...models,
                  {
                    id,
                    name: newName.trim() || id,
                    pricing: 'unknown',
                    enabled: true,
                    available: null,
                  },
                ],
                defaultModel,
              );
              setNewId('');
              setNewName('');
              setMessage('모델을 추가했어요. 저장하면 적용됩니다.');
            }}
          >
            <Plus size={15} />
            모델 추가
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </details>
    </div>
  );
}
