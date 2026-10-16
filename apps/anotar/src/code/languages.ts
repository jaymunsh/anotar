export const codeLanguages: Record<string, {name:string; aliases?:string[]}> = {
 text:{name:'일반 텍스트',aliases:['plaintext','txt','none']},
 javascript:{name:'JavaScript',aliases:['js']},typescript:{name:'TypeScript',aliases:['ts']},
 jsx:{name:'JSX'},tsx:{name:'TSX'},python:{name:'Python',aliases:['py']},
 sql:{name:'SQL'},bash:{name:'Bash / Shell',aliases:['sh','shell']},
 json:{name:'JSON'},html:{name:'HTML'},css:{name:'CSS'},yaml:{name:'YAML',aliases:['yml']},
 markdown:{name:'Markdown',aliases:['md']},java:{name:'Java'},c:{name:'C'},cpp:{name:'C++',aliases:['c++']},
 csharp:{name:'C#',aliases:['cs']},go:{name:'Go'},rust:{name:'Rust',aliases:['rs']},
 dockerfile:{name:'Dockerfile',aliases:['docker']},diff:{name:'Diff'},mermaid:{name:'Mermaid'},
};
export function codeLanguage(id:string) {
 return Object.keys(codeLanguages).find(key=>key===id || codeLanguages[key].aliases?.includes(id)) || 'text';
}
