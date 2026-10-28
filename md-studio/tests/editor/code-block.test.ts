import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, languageChoices, supportedLanguageCount } from '../../src/renderer/editor/languages';
import { codeRanges, findFences } from '../../src/shared/markdown-scan';
import { highlightLanguageCount, resolveHighlightLanguage } from '../../src/renderer/export/highlight';

describe('语言注册表（REQ-002：≥30 种语言高亮）', () => {
  it('编辑端语言数 ≥ 30', () => {
    expect(supportedLanguageCount()).toBeGreaterThanOrEqual(30);
  });

  it('导出端高亮语言数 ≥ 30', () => {
    expect(highlightLanguageCount()).toBeGreaterThanOrEqual(30);
  });

  it('常见别名可解析到语言（js/ts/py/sh/go/rust/sql/yml）', () => {
    const aliasSet = new Set(CODE_LANGUAGES.flatMap((language) => language.alias));
    for (const alias of ['js', 'ts', 'py', 'sh', 'go', 'rust', 'sql', 'yml', 'cpp', 'csharp', 'powershell']) {
      expect(aliasSet.has(alias), `缺少别名：${alias}`).toBe(true);
    }
  });

  it('导出端别名归一（js→javascript，yml→yaml）', () => {
    expect(resolveHighlightLanguage('js')).toBe('javascript');
    expect(resolveHighlightLanguage('yml')).toBe('yaml');
    expect(resolveHighlightLanguage('py')).toBe('python');
    expect(resolveHighlightLanguage('sh')).toBe('bash');
    expect(resolveHighlightLanguage('unknown-language')).toBeNull();
  });

  it('语言选择器合并 SQL 变体且不重复', () => {
    const choices = languageChoices();
    const names = choices.map((choice) => choice.name);
    expect(names).not.toContain('SQL (MySQL)');
    expect(new Set(names).size).toBe(names.length);
    expect(choices.length).toBeGreaterThanOrEqual(30);
  });
});

describe('围栏扫描', () => {
  const doc = ['# 标题', '', '```js', 'const a = 1;', '```', '', '~~~', 'plain', '~~~', ''].join('\n');

  it('定位围栏区间与语言', () => {
    const fences = findFences(doc);
    expect(fences).toHaveLength(2);
    expect(fences[0]?.info).toBe('js');
    expect(fences[0]?.code).toBe('const a = 1;');
    expect(fences[0]?.startLine).toBe(3);
    expect(fences[1]?.info).toBe('');
    expect(fences[1]?.code).toBe('plain');
  });

  it('info 过滤（mermaid）', () => {
    const mermaidDoc = '```mermaid\ngraph TD\n```\n\n```js\nlet x;\n```';
    const mermaid = findFences(mermaidDoc, 'mermaid');
    expect(mermaid).toHaveLength(1);
    expect(mermaid[0]?.code.trim()).toBe('graph TD');
  });

  it('codeRanges 覆盖整个围栏（公式跳过用）', () => {
    const ranges = codeRanges(doc);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]?.from).toBe(doc.indexOf('```js'));
  });

  it('未闭合围栏收敛到文末', () => {
    const fences = findFences('```\nabc');
    expect(fences).toHaveLength(1);
    expect(fences[0]?.code.trim()).toBe('abc');
  });
});
