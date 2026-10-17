const views = ['day','week','month','quarter','year','routines','review'];

export function journalView(path:string,query:URLSearchParams) {
  const value=query.get('view');
  // 분기 view is retired; old ?view=quarter links land on 목표 (view=year).
  if(path==='/app/plans')return value==='routines'?value:'year';
  if(path==='/app/review')return 'review';
  return value&&views.includes(value)?value:'day';
}

export function journalSection(view:string) {
  return view==='review'?'review':['quarter','year','routines'].includes(view)?'plans':'schedule';
}

export function journalPath(view:string) {
  const section=journalSection(view);
  return section==='plans'?'/app/plans':section==='review'?'/app/review':'/app';
}
