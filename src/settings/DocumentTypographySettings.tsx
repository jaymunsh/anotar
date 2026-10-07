import {useEffect, useState} from 'react';
import {
  defaultDocumentTypography, documentTypographyPresets, type DocumentTypography,
} from '../../shared/documentTypography';
import {
  applyDocumentTypography, currentDocumentTypography, typographyChangeEvent,
} from './documentTypography';

const ratioControls = [
  {key:'titleRatio', label:'페이지 제목', min:150, max:250},
  {key:'h1Ratio', label:'제목 1', min:120, max:190},
  {key:'h2Ratio', label:'제목 2', min:110, max:160},
  {key:'h3Ratio', label:'제목 3', min:108, max:135},
  {key:'h4Ratio', label:'제목 4', min:104, max:125},
] as const;
const presets = [
  {key:'compact', label:'작게'},
  {key:'standard', label:'보통'},
  {key:'roomy', label:'크게'},
] as const;
const pixels = (value: number) => `${Math.round(value * 10) / 10}px`;

export default function DocumentTypographySettings() {
  const [type, setType] = useState(currentDocumentTypography);
  useEffect(() => {
    const update = () => setType(currentDocumentTypography());
    window.addEventListener(typographyChangeEvent, update);
    return () => window.removeEventListener(typographyChangeEvent, update);
  }, []);
  const change = (key: keyof DocumentTypography, value: number) =>
    setType(applyDocumentTypography({...type, [key]:value}));
  return <section className="settings-document-type" aria-labelledby="document-type-title">
    <h4 id="document-type-title">페이지 글자 크기와 비율</h4>
    <p className="settings-description">본문을 기준으로 제목 크기를 맞춰요. 이 브라우저의 모든 페이지에 적용됩니다.</p>
    <div className="document-type-preset-row">
      <div className="document-type-presets" role="group" aria-label="페이지 글자 프리셋">
        {presets.map(preset => <button type="button" key={preset.key}
          aria-pressed={Object.keys(type).every(key=>type[key as keyof DocumentTypography] === documentTypographyPresets[preset.key][key as keyof DocumentTypography])}
          onClick={()=>setType(applyDocumentTypography(documentTypographyPresets[preset.key]))}>{preset.label}</button>)}
      </div>
      <button type="button" className="document-type-reset"
        title="작게와 초기 제목 비율·줄간격·문단 간격으로 되돌려요"
        onClick={()=>setType(applyDocumentTypography(defaultDocumentTypography))}>기본값으로 설정</button>
    </div>
    <label className="document-type-control">
      <span>본문 크기</span>
      <input type="range" aria-label="페이지 본문 크기" min="13" max="18" step=".5" value={type.bodySize}
        aria-valuetext={pixels(type.bodySize)} onChange={event=>change('bodySize',Number(event.target.value))}/>
      <output>{pixels(type.bodySize)}</output>
    </label>
    <label className="document-type-control">
      <span>줄간격</span>
      <input type="range" aria-label="페이지 줄간격" min="1.4" max="1.9" step=".05" value={type.lineHeight}
        aria-valuetext={`${type.lineHeight.toFixed(2)}배`} onChange={event=>change('lineHeight',Number(event.target.value))}/>
      <output>{type.lineHeight.toFixed(2)}</output>
    </label>
    <label className="document-type-control">
      <span>문단 간격</span>
      <input type="range" aria-label="페이지 문단 간격" min="75" max="125" step="5" value={Math.round(type.spacing*100)}
        aria-valuetext={`${Math.round(type.spacing*100)}%`} onChange={event=>change('spacing',Number(event.target.value)/100)}/>
      <output>{Math.round(type.spacing*100)}%</output>
    </label>
    <details className="document-type-ratios">
      <summary>제목별 비율 조절</summary>
      <p>본문이 100%예요. 페이지 제목부터 제목 4까지 점차 작아지도록 조절해요. 제목 4도 본문보다 크게 표시돼요.</p>
      {ratioControls.map((control,index)=>{
        const previous = index > 0 ? type[ratioControls[index-1].key] : 2.5;
        const next = index < ratioControls.length-1 ? type[ratioControls[index+1].key] : 1;
        return <label className="document-type-control" key={control.key}>
          <span>{control.label}</span>
          <input type="range" aria-label={`${control.label} 비율`} min={Math.max(control.min,Math.ceil(next*100))}
            max={Math.min(control.max,Math.floor(previous*100))} step="1" value={Math.round(type[control.key]*100)}
            aria-valuetext={`${Math.round(type[control.key]*100)}%, ${pixels(type.bodySize*type[control.key])}`}
            onChange={event=>change(control.key,Number(event.target.value)/100)}/>
          <output>{Math.round(type[control.key]*100)}%<small>{pixels(type.bodySize*type[control.key])}</small></output>
        </label>;
      })}
    </details>
    <div className="document-type-sample" aria-label="페이지 글자 미리보기">
      <div className="document-type-sample-title">Anotar 소개</div>
      <div className="document-type-sample-h1">1. 기록을 시작하기</div>
      <p>떠오른 생각은 메모로 남기고, 모인 자료는 읽기 좋은 페이지로 정리해요.</p>
      <div className="document-type-sample-h2">메모에서 페이지로</div>
      <p>필요한 문장과 파일을 모아 나만의 문서를 만들어요.</p>
      <div className="document-type-sample-h3">작은 기록의 습관</div>
      <p>짧게 적어도 좋아요. 제목과 본문의 크기를 비교해보세요.</p>
      <div className="document-type-sample-h4">작성 전 확인하기</div>
      <p>제목 4는 본문보다 조금 크고 굵게 표시돼요.</p>
    </div>
  </section>;
}
