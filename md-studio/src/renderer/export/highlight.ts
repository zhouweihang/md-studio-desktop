import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import scala from 'highlight.js/lib/languages/scala';
import dart from 'highlight.js/lib/languages/dart';
import lua from 'highlight.js/lib/languages/lua';
import perl from 'highlight.js/lib/languages/perl';
import r from 'highlight.js/lib/languages/r';
import julia from 'highlight.js/lib/languages/julia';
import haskell from 'highlight.js/lib/languages/haskell';
import erlang from 'highlight.js/lib/languages/erlang';
import clojure from 'highlight.js/lib/languages/clojure';
import yaml from 'highlight.js/lib/languages/yaml';
import ini from 'highlight.js/lib/languages/ini';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import diff from 'highlight.js/lib/languages/diff';
import nginx from 'highlight.js/lib/languages/nginx';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import less from 'highlight.js/lib/languages/less';
import scss from 'highlight.js/lib/languages/scss';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import objectivec from 'highlight.js/lib/languages/objectivec';
import verilog from 'highlight.js/lib/languages/verilog';
import vhdl from 'highlight.js/lib/languages/vhdl';
import fortran from 'highlight.js/lib/languages/fortran';
import mathematica from 'highlight.js/lib/languages/mathematica';
import lisp from 'highlight.js/lib/languages/lisp';
import cmake from 'highlight.js/lib/languages/cmake';
import coffeescript from 'highlight.js/lib/languages/coffeescript';
import crystal from 'highlight.js/lib/languages/crystal';
import tcl from 'highlight.js/lib/languages/tcl';
import wasm from 'highlight.js/lib/languages/wasm';
import plaintext from 'highlight.js/lib/languages/plaintext';

const LANGUAGES: Record<string, unknown> = {
  javascript,
  typescript,
  python,
  java,
  cpp,
  c,
  csharp,
  go,
  rust,
  php,
  ruby,
  swift,
  kotlin,
  scala,
  dart,
  lua,
  perl,
  r,
  julia,
  haskell,
  erlang,
  clojure,
  yaml,
  ini,
  sql,
  bash,
  powershell,
  dockerfile,
  diff,
  nginx,
  xml,
  css,
  less,
  scss,
  json,
  markdown,
  objectivec,
  verilog,
  vhdl,
  fortran,
  mathematica,
  lisp,
  cmake,
  coffeescript,
  crystal,
  tcl,
  wasm,
  plaintext
};

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  for (const [name, definition] of Object.entries(LANGUAGES)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hljs.registerLanguage(name, definition as any);
  }
  registered = true;
}

/** 围栏信息 → highlight.js 语言名（处理别名；未知返回 null）。 */
export function resolveHighlightLanguage(info: string): string | null {
  ensureRegistered();
  const token = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!token) return null;
  const ALIASES: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    kt: 'kotlin',
    cs: 'csharp',
    sh: 'bash',
    zsh: 'bash',
    shell: 'bash',
    ps1: 'powershell',
    docker: 'dockerfile',
    'c++': 'cpp',
    hpp: 'cpp',
    htm: 'xml',
    html: 'xml',
    svg: 'xml',
    yml: 'yaml',
    toml: 'ini',
    conf: 'ini',
    env: 'ini',
    mysql: 'sql',
    postgres: 'sql',
    postgresql: 'sql',
    sqlite: 'sql',
    objc: 'objectivec',
    'objective-c': 'objectivec',
    hs: 'haskell',
    clj: 'clojure',
    matlab: 'matlab',
    lisp: 'lisp',
    commonlisp: 'lisp',
    md: 'markdown',
    styl: 'stylus',
    stylus: 'css',
    less: 'less',
    sass: 'scss',
    coffeescript: 'coffeescript',
    coffee: 'coffeescript',
    text: 'plaintext',
    txt: 'plaintext'
  };
  const candidate = ALIASES[token] ?? token;
  return hljs.getLanguage(candidate) ? candidate : null;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 高亮代码；未知语言返回转义后的纯文本。 */
export function highlightCode(code: string, info: string): string {
  ensureRegistered();
  const language = resolveHighlightLanguage(info);
  if (!language) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

export function highlightLanguageCount(): number {
  return Object.keys(LANGUAGES).length;
}
