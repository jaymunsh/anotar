import { createOpenCodeRunner } from './opencode.mjs';
import { defaultOpenCodeModels, validateModelCatalog, catalogCheckedAt } from './modelCatalog.mjs';
import { createHiveRunner } from './hive.mjs';
import { createHttpRunner } from './runner.mjs';
import { AiValidationError } from './contracts.mjs';
export function createAiExecutionService({ store, env = process.env }) {
  const legacyHttp =
    env.AI_RUNNER_KIND === 'http' || (!env.AI_RUNNER_KIND && Boolean(env.AI_RUNNER_URL));
  const ids = ['hive', 'opencode', ...(legacyHttp ? ['http'] : [])];
  const defaults = {
    defaultProfile: ids.includes(env.AI_RUNNER_KIND)
      ? env.AI_RUNNER_KIND
      : legacyHttp
        ? 'http'
        : 'hive',
    models: {
      // Hive runs one fixed model unless the server sets another.
      hive: env.HIVE_MODEL || 'zai-org/glm-5.3-flash',
      http: '',
      opencode: env.AI_OPENCODE_MODEL || '',
    },
    opencodeModels: defaultOpenCodeModels(),
  };
  const state = () => {
    const saved = store.getAiSettings();
    return {
      ...defaults,
      ...saved,
      // Devin was removed; an old saved default of it falls back to the server default.
      ...(saved?.defaultProfile && !ids.includes(saved.defaultProfile) ? { defaultProfile: defaults.defaultProfile } : {}),
      version: saved?.version ?? 0,
      models: { ...defaults.models, ...saved?.models, hive: saved?.models?.hive || defaults.models.hive },
      opencodeModels: saved?.opencodeModels ?? defaultOpenCodeModels(),
    };
  };
  const make = (id, model) => {
    let r =
      id === 'hive'
        ? createHiveRunner({ ...env, HIVE_MODEL: model })
        : id === 'opencode'
          ? createOpenCodeRunner({ ...env, AI_OPENCODE_MODEL: model })
          : createHttpRunner(env);
    r.info = {
      ...(r.info || {}),
      label:
        id === 'http'
          ? r.info?.label || 'HTTP 게이트웨이'
          : `${id === 'hive' ? 'Hive' : 'OpenCode CLI'} · ${model || '모델 설정 필요'}`,
      mode: r.info?.mode || 'live',
      profileId: id,
      model,
    };
    if (env.AI_RUNNER_KIND === 'disabled' || (id === 'opencode' && !model))
      r = { enabled: false, info: r.info };
    return r;
  };
  function settings() {
    const s = state();
    return {
      version: s.version,
      defaultProfile: s.defaultProfile,
      profiles: ids.map((id) => {
        const model = s.models[id] || '',
          r = make(id, model);
        let status = r.enabled ? 'configured' : 'missing';
        if (
          env.AI_RUNNER_KIND === 'disabled' ||
          (id === 'opencode' && env.AI_OPENCODE_ENABLED !== 'true')
        )
          status = 'disabled';
        return {
          id,
          label:
            id === 'hive'
              ? 'Hive'
              : id === 'opencode'
                ? 'OpenCode CLI'
                : 'HTTP 게이트웨이',
          model,
          ...(id === 'opencode' ? { catalog: s.opencodeModels, catalogCheckedAt } : {}),
          enabled: r.enabled && status !== 'login_required',
          status,
          researchModes: r.enabled
            ? typeof r.discover === 'function'
              ? ['url', 'keyword']
              : ['url']
            : [],
          configured: r.enabled,
          credentialsConfigured:
            id === 'hive'
              ? Boolean(env.HIVE_API_KEY)
              : id === 'opencode'
                ? r.enabled
                : Boolean(env.AI_RUNNER_URL),
        };
      }),
    };
  }
  function resolveExecution(selection) {
    const s = state(),
      id = selection?.profileId || s.defaultProfile;
    if (!ids.includes(id)) throw new AiValidationError('등록된 AI 실행기를 선택해 주세요.');
    const model = id === 'opencode' ? (selection?.model ?? s.models[id] ?? '') : s.models[id] || '';
    if (id === 'opencode') {
      if (model.startsWith('opencode/jev-'))
        throw new AiValidationError(
          'Jev는 별도 구조화 API를 사용하는 모델이에요. 텍스트 요청 모델을 선택해 주세요.',
        );
      if (!s.opencodeModels.some((m) => m.id === model && m.enabled))
        throw new AiValidationError('사용할 OpenCode 모델을 설정에서 등록하고 켜 주세요.');
    } else if (selection?.model !== undefined && selection.model !== model)
      throw new AiValidationError('AI 모델 설정이 변경됐어요. 실행기를 다시 선택해 주세요.');
    return { profileId: id, model };
  }
  function forJob(job) {
    const e = job.request.execution || resolveExecution();
    if (!ids.includes(e.profileId)) return { enabled: false, info: null };
    return make(e.profileId, e.model);
  }
  function update(body) {
    if (!ids.includes(body.defaultProfile) || !body.models || typeof body.models !== 'object')
      throw new AiValidationError('AI 실행기 설정이 올바르지 않아요.');
    const models = { ...state().models };
    for (const id of ['hive', 'opencode']) {
      const m = body.models[id] ?? (id === 'opencode' ? models[id] : undefined);
      if (
        typeof m !== 'string' ||
        (m && !/^[a-z0-9][a-z0-9/._:-]{0,119}$/i.test(m)) ||
        (id === 'opencode' && m && !/^[a-z0-9][a-z0-9._:-]*\/[a-z0-9][a-z0-9/._:-]*$/i.test(m))
      )
        throw new AiValidationError('모델 이름은 120자 이내의 모델 ID로 입력해 주세요.');
      models[id] = m;
    }
    const opencodeModels =
      body.opencodeModels === undefined
        ? state().opencodeModels
        : validateModelCatalog(body.opencodeModels);
    if (models.opencode && !opencodeModels.some((m) => m.id === models.opencode && m.enabled))
      throw new AiValidationError('기본 OpenCode 모델은 사용 중인 목록에서 선택해 주세요.');
    if (body.defaultProfile === 'opencode' && !models.opencode)
      throw new AiValidationError('기본 OpenCode 모델을 선택해 주세요.');
    store.saveAiSettings(
      { defaultProfile: body.defaultProfile, models, opencodeModels },
      body.expectedVersion,
    );
    return settings();
  }
  store.setAiExecutionResolver(resolveExecution);
  return {
    settings,
    update,
    resolveExecution,
    forJob,
    metadataFor: (request) => forJob({ request }).info,
    get enabled() {
      return settings().profiles.some((p) => p.enabled);
    },
    get info() {
      const s = state();
      return make(s.defaultProfile, s.models[s.defaultProfile] || '').info;
    },
    get discover() {
      const s = state(),
        r = make(s.defaultProfile, s.models[s.defaultProfile] || '');
      return r.enabled && typeof r.discover === 'function' ? true : undefined;
    },
  };
}
