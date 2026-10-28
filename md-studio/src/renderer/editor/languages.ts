import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { rust } from '@codemirror/lang-rust';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { go } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { r } from '@codemirror/legacy-modes/mode/r';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powerShell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { tcl } from '@codemirror/legacy-modes/mode/tcl';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';
import { mathematica } from '@codemirror/legacy-modes/mode/mathematica';
import { smalltalk } from '@codemirror/legacy-modes/mode/smalltalk';
import { d } from '@codemirror/legacy-modes/mode/d';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { coffeeScript } from '@codemirror/legacy-modes/mode/coffeescript';
import { pug } from '@codemirror/legacy-modes/mode/pug';
import { crystal } from '@codemirror/legacy-modes/mode/crystal';
import { cypher } from '@codemirror/legacy-modes/mode/cypher';
import { cobol } from '@codemirror/legacy-modes/mode/cobol';
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp';
import { sass } from '@codemirror/legacy-modes/mode/sass';
import { stylus } from '@codemirror/legacy-modes/mode/stylus';
import { standardSQL, mySQL, pgSQL, sqlite } from '@codemirror/legacy-modes/mode/sql';
import { csharp, kotlin, scala, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike';

interface LegacyLang {
  name: string;
  alias: string[];
  mode: StreamParser<unknown>;
}

/** legacy 流式模式：覆盖官方 parser 之外的常用语言。 */
const LEGACY: LegacyLang[] = [
  { name: 'Go', alias: ['go', 'golang'], mode: go },
  { name: 'Ruby', alias: ['ruby', 'rb'], mode: ruby },
  { name: 'Swift', alias: ['swift'], mode: swift },
  { name: 'Lua', alias: ['lua'], mode: lua },
  { name: 'Perl', alias: ['perl', 'pl'], mode: perl },
  { name: 'R', alias: ['r'], mode: r },
  { name: 'Julia', alias: ['julia'], mode: julia },
  { name: 'Haskell', alias: ['haskell', 'hs'], mode: haskell },
  { name: 'Erlang', alias: ['erlang'], mode: erlang },
  { name: 'Clojure', alias: ['clojure', 'clj'], mode: clojure },
  { name: 'Shell', alias: ['shell', 'sh', 'bash', 'zsh'], mode: shell },
  { name: 'PowerShell', alias: ['powershell', 'ps1'], mode: powerShell },
  { name: 'Dockerfile', alias: ['dockerfile', 'docker'], mode: dockerFile },
  { name: 'TOML', alias: ['toml'], mode: toml },
  { name: 'Diff', alias: ['diff', 'patch'], mode: diff },
  { name: 'Properties', alias: ['properties', 'ini', 'env'], mode: properties },
  { name: 'Nginx', alias: ['nginx'], mode: nginx },
  { name: 'Tcl', alias: ['tcl'], mode: tcl },
  { name: 'Verilog', alias: ['verilog'], mode: verilog },
  { name: 'VHDL', alias: ['vhdl'], mode: vhdl },
  { name: 'Fortran', alias: ['fortran', 'f90'], mode: fortran },
  { name: 'Mathematica', alias: ['mathematica', 'wolfram'], mode: mathematica },
  { name: 'Smalltalk', alias: ['smalltalk'], mode: smalltalk },
  { name: 'D', alias: ['d', 'dlang'], mode: d },
  { name: 'CMake', alias: ['cmake'], mode: cmake },
  { name: 'CoffeeScript', alias: ['coffeescript', 'coffee'], mode: coffeeScript },
  { name: 'Pug', alias: ['pug', 'jade'], mode: pug },
  { name: 'Crystal', alias: ['crystal'], mode: crystal },
  { name: 'Cypher', alias: ['cypher'], mode: cypher },
  { name: 'COBOL', alias: ['cobol'], mode: cobol },
  { name: 'Common Lisp', alias: ['commonlisp', 'lisp'], mode: commonLisp },
  { name: 'Sass', alias: ['sass'], mode: sass },
  { name: 'Stylus', alias: ['stylus', 'styl'], mode: stylus },
  { name: 'C#', alias: ['csharp', 'cs'], mode: csharp },
  { name: 'Kotlin', alias: ['kotlin', 'kt'], mode: kotlin },
  { name: 'Scala', alias: ['scala'], mode: scala },
  { name: 'Dart', alias: ['dart'], mode: dart },
  { name: 'Objective-C', alias: ['objectivec', 'objc', 'objective-c'], mode: objectiveC },
  { name: 'SQL (MySQL)', alias: ['mysql'], mode: mySQL },
  { name: 'SQL (PostgreSQL)', alias: ['postgres', 'postgresql', 'pgsql'], mode: pgSQL },
  { name: 'SQL (SQLite)', alias: ['sqlite', 'sqlite3'], mode: sqlite },
  { name: 'SQL', alias: ['sql'], mode: standardSQL }
];

function legacyDescription(entry: LegacyLang): LanguageDescription {
  return LanguageDescription.of({
    name: entry.name,
    alias: entry.alias,
    load: async () => new LanguageSupport(StreamLanguage.define(entry.mode))
  });
}

/** 官方 parser：常用语言获得更好的缩进与括号行为。 */
const OFFICIAL: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['javascript', 'js', 'jsx', 'mjs', 'cjs', 'node'],
    load: async () => javascript()
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['typescript', 'ts', 'tsx'],
    load: async () => javascript({ typescript: true, jsx: true })
  }),
  LanguageDescription.of({ name: 'Python', alias: ['python', 'py'], load: async () => python() }),
  LanguageDescription.of({ name: 'CSS', alias: ['css'], load: async () => css() }),
  LanguageDescription.of({ name: 'HTML', alias: ['html', 'htm'], load: async () => html() }),
  LanguageDescription.of({ name: 'JSON', alias: ['json', 'jsonc'], load: async () => json() }),
  LanguageDescription.of({ name: 'Java', alias: ['java'], load: async () => java() }),
  LanguageDescription.of({ name: 'C++', alias: ['cpp', 'c++', 'cc', 'hpp', 'cxx'], load: async () => cpp() }),
  LanguageDescription.of({ name: 'C', alias: ['c', 'h'], load: async () => cpp() }),
  LanguageDescription.of({ name: 'PHP', alias: ['php'], load: async () => php() }),
  LanguageDescription.of({ name: 'Rust', alias: ['rust', 'rs'], load: async () => rust() }),
  LanguageDescription.of({ name: 'YAML', alias: ['yaml', 'yml'], load: async () => yaml() }),
  LanguageDescription.of({ name: 'XML', alias: ['xml', 'svg'], load: async () => xml() }),
  LanguageDescription.of({ name: 'SQL (标准)', alias: [], load: async () => sql() })
];

export const CODE_LANGUAGES: readonly LanguageDescription[] = [...OFFICIAL, ...LEGACY.map(legacyDescription)];

/** 支持的语言总数（验收用：≥30）。 */
export function supportedLanguageCount(): number {
  return CODE_LANGUAGES.length;
}

/** 语言选择器候选项（合并 SQL 变体）。 */
export function languageChoices(): Array<{ name: string; alias: string }> {
  const seen = new Set<string>();
  const choices: Array<{ name: string; alias: string }> = [];
  for (const description of CODE_LANGUAGES) {
    if (description.name.startsWith('SQL (')) continue;
    if (seen.has(description.name)) continue;
    seen.add(description.name);
    choices.push({ name: description.name, alias: description.alias[0] ?? description.name.toLowerCase() });
  }
  return choices.sort((left, right) => left.name.localeCompare(right.name, 'en'));
}
