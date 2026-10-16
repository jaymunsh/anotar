const views = ['day','week','month','quarter','year','review'];

export function journalView(path:string,query:URLSearchParams) {
  const value=query.get('view');
  if(path==='/app/plans')return value==='year'?'year':'quarter';
  if(path==='/app/review')return 'review';
  return value&&views.includes(value)?value:'day';
}

export function journalSection(view:string) {
  return view==='review'?'review':['quarter','year'].includes(view)?'plans':'schedule';
}

export function journalPath(view:string) {
  const section=journalSection(view);
  return section==='plans'?'/app/plans':section==='review'?'/app/review':'/app';
}
