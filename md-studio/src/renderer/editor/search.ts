import {
  findNext,
  findPrevious,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  closeSearchPanel
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';

/** 文档内查找替换（REQ-011 的文档侧）：使用 CM 官方搜索面板，固定在底部。 */
export function searchExtensions(): Extension {
  return [search({ top: false, caseSensitive: false }), keymap.of(searchKeymap)];
}

export function openFindPanel(view: EditorView): void {
  openSearchPanel(view);
}

export function closeFindPanel(view: EditorView): void {
  closeSearchPanel(view);
}

export function findNextMatch(view: EditorView): void {
  findNext(view);
}

export function findPreviousMatch(view: EditorView): void {
  findPrevious(view);
}

export function replaceCurrentMatch(view: EditorView): void {
  replaceNext(view);
}

export function replaceEveryMatch(view: EditorView): void {
  replaceAll(view);
}
