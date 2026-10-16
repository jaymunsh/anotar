import {createHighlighterCore} from 'shiki/core';
import {createJavaScriptRegexEngine} from 'shiki/engine/javascript';
import theme from 'shiki/themes/github-dark.mjs';
import lightTheme from 'shiki/themes/github-light.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import python from 'shiki/langs/python.mjs';
import sql from 'shiki/langs/sql.mjs';
import bash from 'shiki/langs/bash.mjs';
import json from 'shiki/langs/json.mjs';
import html from 'shiki/langs/html.mjs';
import css from 'shiki/langs/css.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import java from 'shiki/langs/java.mjs';
import c from 'shiki/langs/c.mjs';
import cpp from 'shiki/langs/cpp.mjs';
import csharp from 'shiki/langs/csharp.mjs';
import go from 'shiki/langs/go.mjs';
import rust from 'shiki/langs/rust.mjs';
import dockerfile from 'shiki/langs/dockerfile.mjs';
import diff from 'shiki/langs/diff.mjs';
import mermaid from 'shiki/langs/mermaid.mjs';
let instance:ReturnType<typeof createHighlighterCore> | undefined;
export function documentHighlighter(){
 return instance ??= createHighlighterCore({themes:[theme,lightTheme],langs:[javascript,typescript,jsx,tsx,python,sql,bash,json,html,css,yaml,markdown,java,c,cpp,csharp,go,rust,dockerfile,diff,mermaid],engine:createJavaScriptRegexEngine()});
}
