import 'katex/dist/katex.min.css';
import katexCss from 'katex/dist/katex.min.css?raw';
import darkThemeCss from './themes/built-in/dark.css?raw';
import lightThemeCss from './themes/built-in/light.css?raw';
import type { KeymapResult, Settings, ThemeMeta, WorkspaceChangedEvent } from '../shared/channels';
import { isMarkdownPath } from '../shared/paths';
import { markdownToPlainText } from '../shared/plain-text';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../shared/settings';
import { countText } from '../shared/text-stats';
import { stepZoomLevel } from '../shared/view-controls';
import { DocManager } from './doc-manager';
import * as editorCommands from './editor/commands';
import { fenceInfoAt, setFenceLanguage } from './editor/live-preview';
import { languageChoices } from './editor/languages';
import { findNextMatch, findPreviousMatch, openFindPanel } from './editor/search';
import { createEditor, type EditorHandle } from './editor/setup';
import { createTableToolbar, isInsideTable } from './editor/table-toolbar';
import { invalidateMermaidCache, renderMermaidToSvg, redrawMermaidWidgets } from './editor/widgets';
import { htmlToMarkdown, htmlToPlain } from './export/html-to-md';
import { renderDocumentBody } from './export/render-html';
import { applyStaticTexts, locale, setLocale, tr } from './i18n';
import { showEditorContextMenu } from './shell/context-menu';
import { showSettingsDialog } from './shell/settings-view';
import { confirmDialog, promptDialog, toast } from './shell/dialogs';
import { FileTree } from './shell/file-tree';
import { OutlineView } from './shell/outline-view';
import { SearchView } from './shell/search-view';
import { TabBar } from './shell/tab-bar';

const WELCOME_ZH = [
  '# 欢迎使用 MD-Studio',
  '',
  '这是一个**实时预览**的 Markdown 编辑器：写作时标记直接变成排版，光标所在块会露出源码。',
  '',
  '- [x] 打开或新建文档',
  '- [ ] 试试 `Ctrl+/` 切到源码模式',
  '',
  '## 代码、表格、公式与图表',
  '',
  '```js',
  'const sum = (a, b) => a + b;',
  'console.log(sum(1, 2));',
  '```',
  '',
  '| 功能 | 快捷键 | 说明 |',
  '| --- | --- | --- |',
  '| 加粗 | Ctrl+B | 包裹选区 |',
  '| 保存 | Ctrl+S | 原子写入磁盘 |',
  '',
  '公式：$E = mc^2$，块级公式：',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '```mermaid',
  'graph LR',
  '  A[开始] --> B{完成?}',
  '  B -- 是 --> C[结束]',
  '```',
  '',
  '> 把光标移到任意块，源码会就地显现；拖入图片或按 Ctrl+Shift+I 插入图片。'
].join('\n');

const WELCOME_EN = [
  '# Welcome to MD-Studio',
  '',
  'This is a **live preview** Markdown editor: markers turn into layout as you type, and the block under the cursor reveals its source.',
  '',
  '- [x] Open or create a document',
  '- [ ] Press `Ctrl+/` to switch to source mode',
  '',
  '## Code, tables, math and diagrams',
  '',
  '```js',
  'const sum = (a, b) => a + b;',
  'console.log(sum(1, 2));',
  '```',
  '',
  '| Feature | Shortcut | Note |',
  '| --- | --- | --- |',
  '| Bold | Ctrl+B | Wraps the selection |',
  '| Save | Ctrl+S | Atomic write |',
  '',
  'Math: $E = mc^2$, or a block:',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '```mermaid',
  'graph LR',
  '  A[Start] --> B{Done?}',
  '  B -- Yes --> C[End]',
  '```',
  '',
  '> Move the cursor into any block to reveal its source; drop in an image or press Ctrl+Shift+I.'
].join('\n');

function welcomeText(): string {
  return locale() === 'en' ? WELCOME_EN : WELCOME_ZH;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少元素 #${id}`);
  return node as T;
}

// ---- 主题样式注入点 ----

const builtinStyle = document.createElement('style');
builtinStyle.id = 'theme-builtin';
const userStyle = document.createElement('style');
userStyle.id = 'theme-user';
document.head.append(builtinStyle, userStyle);

// ---- 状态 ----

interface AppState {
  settings: Settings;
  keymap: KeymapResult;
  themes: ThemeMeta[];
  userThemeCss: string | null;
}

const state: AppState = {
  settings: sanitizeSettings(DEFAULT_SETTINGS),
  keymap: { bindings: {}, conflicts: [], overrides: {} },
  themes: [],
  userThemeCss: null
};

let fullscreen = false;

// ---- DOM 引用 ----

const titleEl = el<HTMLSpanElement>('doc-title');
const dirtyEl = el<HTMLSpanElement>('doc-dirty');
const pathEl = el<HTMLSpanElement>('doc-path');
const modeBadge = el<HTMLSpanElement>('mode-badge');
const wordsEl = el<HTMLSpanElement>('stat-words');
const linesEl = el<HTMLSpanElement>('stat-lines');
const readEl = el<HTMLSpanElement>('stat-read');
const cursorEl = el<HTMLSpanElement>('stat-cursor');
const modeEl = el<HTMLSpanElement>('stat-mode');
const themeEl = el<HTMLSpanElement>('stat-theme');
const statusMessageEl = el<HTMLSpanElement>('status-message');
const sidebarEl = el<HTMLElement>('sidebar');
const sidebarToggle = el<HTMLButtonElement>('sidebar-toggle');
const sidebarResizer = el<HTMLDivElement>('sidebar-resizer');
const tabbarEl = el<HTMLDivElement>('tabbar');
const fileTreeHost = el<HTMLDivElement>('file-tree');
const outlineHost = el<HTMLDivElement>('outline-list');
const filesToolbar = el<HTMLDivElement>('files-toolbar');
const searchInput = el<HTMLInputElement>('search-input');
const searchMode = el<HTMLSelectElement>('search-mode');
const searchCase = el<HTMLInputElement>('search-case');
const searchCancel = el<HTMLButtonElement>('search-cancel');
const searchResults = el<HTMLDivElement>('search-results');

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notify(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  statusMessageEl.textContent = message;
  statusMessageEl.className = kind === 'info' ? '' : kind;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    statusMessageEl.textContent = '';
  }, 4200);
}

// ---- 编辑器与文档 ----

// 编辑器构造期间预览插件就会调用 getDocDir，这里用持有者避免初始化顺序问题
const docManagerRef: { current: DocManager | null } = { current: null };

const editor: EditorHandle = createEditor(el('editor'), '', {
  onDocChanged: () => {
    docManagerRef.current?.markDirty();
    scheduleStats();
    scheduleOutline();
    tableToolbar.refresh();
  },
  onSelectionChanged: () => {
    updateCursor();
    scheduleOutlineActive();
    syncLanguageSelector();
    tableToolbar.refresh();
  },
  getDocDir: () => docManagerRef.current?.docDir ?? null,
  openExternal: (url) => {
    void window.mdstudio.openExternal(url).catch(() => toast(tr('toast.linkOpenFailed', { url }), 'warn'));
  },
  openPath: (path) => {
    void docManager.openPath(path);
  },
  runCommand: (id) => runCommand(id),
  notify
});

const docManager = new DocManager({
  editor: () => editor,
  settings: () => state.settings,
  exportSupport: () => ({
    themeCss: () => currentThemeCss(),
    katexCss,
    mermaidToSvg: renderMermaidToSvg
  }),
  onStateChanged: () => {
    renderTitle();
    tabBar.render();
    fileTree.setSelected(docManager.currentPath);
    updateStats();
    updateCursor();
    scheduleOutline();
    tableToolbar.refresh();
  },
  notify,
  applyEditorSettings: () => editor.applySettings(state.settings, state.keymap.bindings),
  untitledName: () => tr('tabs.untitled')
});
docManagerRef.current = docManager;

// 标签栏（REQ-032）
const tabBar = new TabBar(tabbarEl, {
  metas: () => docManager.tabs,
  activeId: () => docManager.activeId,
  onActivate: (id) => docManager.activateTab(id),
  onClose: (id) => void docManager.closeTab(id),
  onNew: () => docManager.newTab(),
  onReorder: (id, targetIndex) => docManager.moveTab(id, targetIndex),
  onContextAction: (action, id) => {
    const tab = docManager.tabs.find((item) => item.id === id);
    if (action === 'close') void docManager.closeTab(id);
    else if (action === 'close-others') void docManager.closeOtherTabs(id);
    else if (action === 'close-right') void docManager.closeTabsToRight(id);
    else if (action === 'copy-path' && tab?.path) {
      void window.mdstudio.writeClipboard({ text: tab.path }).then(() => notify(tr('toast.pathCopied', { path: tab.path ?? '' })));
    } else if (action === 'reveal' && tab?.path) {
      void window.mdstudio.reveal(tab.path);
    }
  }
});

// 表格悬浮工具条（REQ-024）：命令与段落菜单同源
const tableToolbar = createTableToolbar(editor.view, { runCommand: (id) => runCommand(id) });

const fileTree = new FileTree(fileTreeHost, {
  onOpenFile: (path) => {
    void docManager.openPath(path);
  },
  currentFile: () => docManager.currentPath
});

const outlineView = new OutlineView(outlineHost, {
  onJump: (item) => {
    const view = editor.view;
    const line = Math.min(item.line, view.state.doc.lines);
    const position = view.state.doc.line(line).from;
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    editor.focus();
  }
});

const searchView = new SearchView(
  { input: searchInput, mode: searchMode, case: searchCase, cancel: searchCancel, results: searchResults },
  {
    root: () => state.settings.files.workspaceRoot,
    onOpen: (path, line) => {
      void docManager.openPath(path, line);
    }
  }
);

// ---- 统计 / 大纲 / 光标 ----

let statsTimer: ReturnType<typeof setTimeout> | null = null;
let outlineTimer: ReturnType<typeof setTimeout> | null = null;
let outlineActiveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleStats(): void {
  if (statsTimer) clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    statsTimer = null;
    updateStats();
  }, 120);
}

function scheduleOutline(): void {
  if (outlineTimer) clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    outlineTimer = null;
    outlineView.update(editor.view.state.doc.toString());
    updateOutlineActive();
  }, 260);
}

function scheduleOutlineActive(): void {
  if (outlineActiveTimer) clearTimeout(outlineActiveTimer);
  outlineActiveTimer = setTimeout(() => {
    outlineActiveTimer = null;
    updateOutlineActive();
  }, 120);
}

function updateStats(): void {
  const stats = countText(editor.view.state.doc.toString());
  wordsEl.textContent = tr('status.words', { count: stats.words });
  linesEl.textContent = tr('status.lines', { count: stats.lines });
  readEl.textContent = tr('status.minutes', { count: stats.minutes });
  updateSelectionStats();
}

/** 选中统计（REQ-026）：有选区时显示「选中 N 字 / 共 M 字」。 */
function updateSelectionStats(): void {
  const viewState = editor.view.state;
  const range = viewState.selection.main;
  if (range.empty) {
    wordsEl.textContent = tr('status.words', { count: countText(viewState.doc.toString()).words });
    return;
  }
  const selected = countText(viewState.sliceDoc(range.from, range.to)).words;
  const total = countText(viewState.doc.toString()).words;
  wordsEl.textContent = tr('status.selected', { selected, total });
}

function updateCursor(): void {
  const viewState = editor.view.state;
  const head = viewState.selection.main.head;
  const line = viewState.doc.lineAt(head);
  cursorEl.textContent = `${line.number}:${head - line.from + 1}`;
  updateSelectionStats();
}

function updateOutlineActive(): void {
  const head = editor.view.state.selection.main.head;
  outlineView.setActiveLine(editor.view.state.doc.lineAt(head).number);
}

// ---- 标题栏 / 主题 / 模式 ----

function renderTitle(): void {
  titleEl.textContent = docManager.documentName;
  dirtyEl.hidden = !docManager.isDirty;
  pathEl.textContent = docManager.currentPath ?? '';
  pathEl.title = docManager.currentPath ?? '';
}

function currentThemeLabel(): string {
  const { mode, userTheme } = state.settings.theme;
  if (userTheme) {
    const meta = state.themes.find((theme) => theme.fileName === userTheme);
    return meta ? meta.name : userTheme;
  }
  return mode === 'dark' ? tr('status.theme.dark') : tr('status.theme.light');
}

function currentThemeCss(): string {
  const builtin = state.settings.theme.mode === 'dark' ? darkThemeCss : lightThemeCss;
  return `${builtin}\n${state.userThemeCss ?? ''}`;
}

function applyTheme(): void {
  const { mode } = state.settings.theme;
  builtinStyle.textContent = mode === 'dark' ? darkThemeCss : lightThemeCss;
  document.documentElement.dataset.theme = mode;
  userStyle.textContent = state.userThemeCss ?? '';
  themeEl.textContent = currentThemeLabel();
}

async function loadUserTheme(): Promise<void> {
  const fileName = state.settings.theme.userTheme;
  if (!fileName) {
    state.userThemeCss = null;
    applyTheme();
    return;
  }
  try {
    const { css, meta } = await window.mdstudio.readTheme(fileName);
    state.userThemeCss = css;
    applyTheme();
    if (meta.issues.length > 0) notify(tr('toast.themeIssues', { name: meta.name, issue: meta.issues[0] ?? '' }), 'warn');
  } catch (error) {
    state.userThemeCss = null;
    applyTheme();
    notify(tr('toast.themeFailed', { message: (error as Error).message }), 'warn');
  }
}

function applyViewSettings(): void {
  const view = state.settings.view;
  sidebarEl.hidden = !view.sidebarVisible;
  sidebarResizer.hidden = !view.sidebarVisible;
  sidebarEl.style.width = `${view.sidebarWidth}px`;
  setSidebarTab(view.sidebarTab);
  modeEl.textContent = view.sourceMode ? tr('status.mode.source') : tr('status.mode.preview');
  const badges: string[] = [];
  if (view.sourceMode) badges.push(tr('status.mode.source'));
  if (view.focusMode) badges.push(tr('status.mode.focus'));
  if (view.typewriterMode) badges.push(tr('status.mode.typewriter'));
  modeBadge.hidden = badges.length === 0 || (view.sourceMode && badges.length === 1);
  modeBadge.textContent = badges.join(' · ');
  editor.applySettings(state.settings, state.keymap.bindings);
}

function setSidebarTab(tab: 'files' | 'outline' | 'search'): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('#sidebar-tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  for (const pane of document.querySelectorAll<HTMLElement>('#sidebar-panes .pane')) {
    pane.classList.toggle('active', pane.id === `pane-${tab}`);
  }
  if (tab === 'search') searchView.focusInput();
}

async function updateSettings(patch: unknown): Promise<void> {
  const { settings } = await window.mdstudio.updateSettings(patch as never);
  state.settings = settings;
  applyTheme();
  applyViewSettings();
}

// ---- 语言选择器 ----

const languageSelect = document.createElement('select');
languageSelect.id = 'stat-language';
languageSelect.append(new Option(tr('status.codeLanguage'), ''));
for (const choice of languageChoices()) languageSelect.append(new Option(choice.name, choice.alias));
languageSelect.addEventListener('change', () => {
  const value = languageSelect.value;
  if (!value) return;
  editor.focus();
  if (!setFenceLanguage(editor.view, value)) {
    toast(tr('editor.codeLanguageHint'), 'warn');
    languageSelect.value = '';
  }
});
modeEl.before(languageSelect);

function syncLanguageSelector(): void {
  const fence = fenceInfoAt(editor.view);
  const info = fence?.info ?? '';
  const alias = info.split(/\s+/)[0] ?? '';
  const known = [...languageSelect.options].some((option) => option.value === alias);
  languageSelect.value = known ? alias : '';
}

// ---- 命令 ----

type CommandHandler = (arg?: unknown) => unknown;

const commandRegistry = new Map<string, CommandHandler>();

function withEditor(action: (handle: EditorHandle) => void | Promise<void>): CommandHandler {
  return async () => {
    editor.focus();
    await action(editor);
  };
}

function toggleViewFlag(key: 'sourceMode' | 'focusMode' | 'typewriterMode'): CommandHandler {
  return () => updateSettings({ view: { [key]: !state.settings.view[key] } });
}

// ---- 剪贴板互操作（REQ-028） ----

interface SelectionInfo {
  text: string;
  all: boolean;
}

function currentSelection(): SelectionInfo {
  const viewState = editor.view.state;
  const range = viewState.selection.main;
  if (range.empty) return { text: viewState.doc.toString(), all: true };
  return { text: viewState.sliceDoc(range.from, range.to), all: false };
}

async function copySelection(kind: 'markdown' | 'html' | 'plain'): Promise<void> {
  const selection = currentSelection();
  if (!selection.text.trim()) {
    toast(tr('toast.noContent'), 'warn');
    return;
  }
  if (kind === 'markdown') {
    await window.mdstudio.writeClipboard({ text: selection.text });
    toast(selection.all ? tr('editor.copyAllMarkdown') : tr('toast.copied.markdown'));
    return;
  }
  if (kind === 'plain') {
    await window.mdstudio.writeClipboard({ text: markdownToPlainText(selection.text) });
    toast(tr('toast.copied.plain'));
    return;
  }
  const html = await renderDocumentBody({
    markdown: selection.text,
    title: 'selection',
    themeCss: currentThemeCss(),
    katexCss
  });
  await window.mdstudio.writeClipboard({ text: markdownToPlainText(selection.text), html });
  toast(tr('toast.copied.html'));
}

async function pasteMarkdown(): Promise<void> {
  const { text, html } = await window.mdstudio.readClipboard();
  const insert = html ? htmlToMarkdown(html) : text;
  if (!insert) {
    toast(tr('toast.clipboardEmpty'), 'warn');
    return;
  }
  editorCommands.insertText(editor.view, insert);
  toast(tr('toast.pasted.markdown'));
}

async function pastePlain(): Promise<void> {
  const { text, html } = await window.mdstudio.readClipboard();
  const insert = html ? htmlToPlain(html) : text;
  if (!insert) {
    toast(tr('toast.clipboardEmpty'), 'warn');
    return;
  }
  editorCommands.insertText(editor.view, insert);
  toast(tr('toast.pasted.plain'));
}

// ---- 视图控制（REQ-025） ----

async function changeZoom(direction: 1 | -1 | 0): Promise<void> {
  const next = stepZoomLevel(state.settings.view.zoomLevel, direction);
  await updateSettings({ view: { zoomLevel: next } });
  notify(tr('toast.zoom', { value: next === 0 ? '100%' : `${next > 0 ? '+' : ''}${next}` }));
}

async function toggleFullscreen(): Promise<void> {
  fullscreen = !fullscreen;
  const result = await window.mdstudio.setFullScreen(fullscreen);
  fullscreen = result.on;
  notify(fullscreen ? tr('toast.fullscreen.on') : tr('toast.fullscreen.off'));
}

async function importWithPandoc(): Promise<void> {
  const result = await window.mdstudio.pandocImport({});
  if (!result.ok) {
    if (result.canceled) return;
    toast(result.error, 'error');
    return;
  }
  docManager.openDocument(result.path, result.markdown, null);
  notify(tr('toast.imported', { name: result.name }));
}

function registerCommands(): void {
  const registry: Array<[string, CommandHandler]> = [
    // 文件
    ['file.new', () => docManager.newTab()],
    ['file.newTab', () => docManager.newTab()],
    ['file.open', () => docManager.openDialog()],
    ['file.print', () => docManager.print()],
    ['file.rename', () => docManager.renameFile()],
    ['file.delete', () => docManager.deleteFile()],
    ['file.reveal', () => docManager.revealInFolder()],
    ['file.history', () => docManager.showHistory()],
    ['file.exportText', () => docManager.exportText()],
    ['file.exportImage', () => docManager.exportImage('png')],
    ['file.exportDocx', () => docManager.exportWithPandoc('docx')],
    ['file.exportLatex', () => docManager.exportWithPandoc('latex')],
    ['file.exportEpub', () => docManager.exportWithPandoc('epub')],
    ['file.exportRtf', () => docManager.exportWithPandoc('rtf')],
    ['file.exportOdt', () => docManager.exportWithPandoc('odt')],
    ['file.importPandoc', () => importWithPandoc()],
    [
      'file.openFolder',
      async () => {
        const result = await window.mdstudio.openFolderDialog();
        if (result.canceled || !result.root) return;
        state.settings = (await window.mdstudio.getSettings()).settings;
        fileTree.setRoot(result.root);
        setSidebarTab('files');
        notify(tr('toast.folderOpened', { path: result.root }));
      }
    ],
    ['file.openRecent', (arg) => (typeof arg === 'string' ? docManager.openPath(arg) : undefined)],
    ['file.reloadFromDisk', () => docManager.reloadFromDisk()],
    ['file.save', () => docManager.save()],
    ['file.saveAs', () => docManager.saveAs()],
    ['file.save-and-close', () => docManager.saveAndClose()],
    ['file.exportHtml', () => docManager.exportHtml()],
    ['file.exportPdf', () => docManager.exportPdf()],
    [
      'file.close',
      () => {
        const id = docManager.activeId;
        if (id !== null) void docManager.closeTab(id);
      }
    ],
    ['tab.next', () => docManager.activateRelative(1)],
    ['tab.prev', () => docManager.activateRelative(-1)],

    // 编辑
    ['edit.copyHtml', () => copySelection('html')],
    ['edit.copyMarkdown', () => copySelection('markdown')],
    ['edit.copyPlainText', () => copySelection('plain')],
    ['edit.pasteMarkdown', withEditor(() => pasteMarkdown())],
    ['edit.pastePlainText', withEditor(() => pastePlain())],
    ['edit.find', withEditor((handle) => openFindPanel(handle.view))],
    ['edit.replace', withEditor((handle) => openFindPanel(handle.view))],
    ['edit.findNext', withEditor((handle) => findNextMatch(handle.view))],
    ['edit.findPrev', withEditor((handle) => findPreviousMatch(handle.view))],

    // 段落
    ['paragraph.h1', withEditor((h) => editorCommands.setHeadingLevel(h.view, 1))],
    ['paragraph.h2', withEditor((h) => editorCommands.setHeadingLevel(h.view, 2))],
    ['paragraph.h3', withEditor((h) => editorCommands.setHeadingLevel(h.view, 3))],
    ['paragraph.h4', withEditor((h) => editorCommands.setHeadingLevel(h.view, 4))],
    ['paragraph.h5', withEditor((h) => editorCommands.setHeadingLevel(h.view, 5))],
    ['paragraph.h6', withEditor((h) => editorCommands.setHeadingLevel(h.view, 6))],
    ['paragraph.paragraph', withEditor((h) => editorCommands.setHeadingLevel(h.view, 0))],
    ['paragraph.increaseHeading', withEditor((h) => editorCommands.changeHeadingLevel(h.view, 1))],
    ['paragraph.decreaseHeading', withEditor((h) => editorCommands.changeHeadingLevel(h.view, -1))],
    ['paragraph.quote', withEditor((h) => editorCommands.toggleQuote(h.view))],
    ['paragraph.bulletList', withEditor((h) => editorCommands.toggleList(h.view, 'bullet'))],
    ['paragraph.orderedList', withEditor((h) => editorCommands.toggleList(h.view, 'ordered'))],
    ['paragraph.taskList', withEditor((h) => editorCommands.toggleList(h.view, 'task'))],
    ['paragraph.codeBlock', withEditor((h) => editorCommands.insertCodeBlock(h.view))],
    ['paragraph.math', withEditor((h) => editorCommands.insertMathBlock(h.view))],
    ['paragraph.mermaid', withEditor((h) => editorCommands.insertMermaidBlock(h.view))],
    ['paragraph.table', withEditor((h) => editorCommands.insertTable(h.view))],
    ['paragraph.hr', withEditor((h) => editorCommands.insertHorizontalRule(h.view))],
    [
      'paragraph.toc',
      withEditor((h) => {
        const toc = editorCommands.insertToc(h.view);
        if (!toc) toast(tr('editor.noHeadings'), 'warn');
      })
    ],
    ['table.addRow', withEditor((h) => void editorCommands.tableOperation(h.view, 'addRow'))],
    ['table.addColumn', withEditor((h) => void editorCommands.tableOperation(h.view, 'addColumn'))],
    ['table.deleteRow', withEditor((h) => void editorCommands.tableOperation(h.view, 'deleteRow'))],
    ['table.deleteColumn', withEditor((h) => void editorCommands.tableOperation(h.view, 'deleteColumn'))],
    ['table.alignLeft', withEditor((h) => void editorCommands.tableOperation(h.view, 'alignLeft'))],
    ['table.alignCenter', withEditor((h) => void editorCommands.tableOperation(h.view, 'alignCenter'))],
    ['table.alignRight', withEditor((h) => void editorCommands.tableOperation(h.view, 'alignRight'))],
    ['table.alignNone', withEditor((h) => void editorCommands.tableOperation(h.view, 'alignNone'))],

    // 格式
    ['format.bold', withEditor((h) => editorCommands.toggleBold(h.view))],
    ['format.italic', withEditor((h) => editorCommands.toggleItalic(h.view))],
    ['format.strikethrough', withEditor((h) => editorCommands.toggleStrikethrough(h.view))],
    ['format.inlineCode', withEditor((h) => editorCommands.toggleInlineCode(h.view))],
    ['format.highlight', withEditor((h) => editorCommands.toggleHighlight(h.view))],
    ['format.footnote', withEditor((h) => editorCommands.insertFootnote(h.view))],
    [
      'format.link',
      withEditor(async (h) => {
        const selected = h.view.state.sliceDoc(h.view.state.selection.main.from, h.view.state.selection.main.to);
        const url = await promptDialog({
          title: tr('dialog.link.title'),
          label: tr('dialog.link.label'),
          placeholder: 'https://…',
          value: 'https://'
        });
        if (!url) return;
        const text = selected || url;
        editorCommands.insertLink(h.view, url, text);
      })
    ],
    [
      'format.image',
      withEditor(async (h) => {
        const docDir = docManager.docDir;
        if (!docDir) {
          toast(tr('editor.imageNeedsSave'), 'warn');
          return;
        }
        const picked = await window.mdstudio.pickAsset(docDir);
        if (picked.canceled || !picked.relativePath) return;
        editorCommands.insertImage(h.view, picked.relativePath, (picked.name ?? '').replace(/\.[a-z0-9]+$/i, ''));
      })
    ],
    ['format.clear', withEditor((h) => editorCommands.clearFormatting(h.view))],

    // 视图
    ['view.zoomIn', () => changeZoom(1)],
    ['view.zoomOut', () => changeZoom(-1)],
    ['view.zoomReset', () => changeZoom(0)],
    ['view.fullscreen', () => toggleFullscreen()],
    ['view.alwaysOnTop', () => updateSettings({ window: { alwaysOnTop: !state.settings.window.alwaysOnTop } })],
    ['view.spellcheck', () => updateSettings({ editor: { spellcheck: !state.settings.editor.spellcheck } })],
    ['view.source', toggleViewFlag('sourceMode')],
    ['view.focus', toggleViewFlag('focusMode')],
    ['view.typewriter', toggleViewFlag('typewriterMode')],
    ['view.sidebar', () => updateSettings({ view: { sidebarVisible: !state.settings.view.sidebarVisible } })],
    ['view.files', () => updateSettings({ view: { sidebarVisible: true, sidebarTab: 'files' } })],
    ['view.outline', () => updateSettings({ view: { sidebarVisible: true, sidebarTab: 'outline' } })],
    ['view.search', () => updateSettings({ view: { sidebarVisible: true, sidebarTab: 'search' } })],
    [
      'view.reload',
      () => {
        window.location.reload();
      }
    ],
    ['view.devTools', () => undefined],

    // 主题
    [
      'theme.toggle',
      () => updateSettings({ theme: { mode: state.settings.theme.mode === 'dark' ? 'light' : 'dark', userTheme: null } })
    ],
    ['theme.light', () => updateSettings({ theme: { mode: 'light', userTheme: null } })],
    ['theme.dark', () => updateSettings({ theme: { mode: 'dark', userTheme: null } })],
    [
      'theme.apply',
      (arg) => {
        const fileName = typeof arg === 'string' ? arg : null;
        if (!fileName) return;
        void updateSettings({ theme: { userTheme: fileName } }).then(loadUserTheme);
      }
    ],

    // 应用
    [
      'app.settings',
      () =>
        showSettingsDialog({
          settings: state.settings,
          themes: state.themes,
          onApply: (patch) => updateSettings(patch)
        })
    ],
    ['app.newWindow', () => window.mdstudio.newWindow()],
    ['app.about', () => window.mdstudio.showAbout()]
  ];
  for (const [id, handler] of registry) commandRegistry.set(id, handler);
}

function runCommand(id: string, arg?: unknown): boolean {
  const handler = commandRegistry.get(id);
  if (!handler) {
    notify(tr('toast.commandMissing', { id }), 'warn');
    return false;
  }
  try {
    const result = handler(arg) as Promise<unknown> | undefined;
    if (result && typeof result.then === 'function') {
      result.catch((error: unknown) => {
        notify(tr('toast.commandFailed', { id, message: (error as Error).message }), 'error');
        void window.mdstudio.log('error', `命令 ${id} 失败：${(error as Error).stack ?? String(error)}`);
      });
    }
    return true;
  } catch (error) {
    notify(tr('toast.commandFailed', { id, message: (error as Error).message }), 'error');
    return false;
  }
}

// ---- 事件接线 ----

filesToolbar.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-file-action]');
  if (!button) return;
  const action = button.dataset.fileAction;
  if (action === 'open-folder') void runCommand('file.openFolder');
  else if (action === 'refresh') fileTree.refreshRoot();
  else if (action === 'new-file' || action === 'new-folder') {
    const root = fileTree.getRoot();
    if (!root) {
      toast(tr('files.openFirst'), 'warn');
      return;
    }
    void fileTree.createEntryInteractive(root, action === 'new-file' ? 'file' : 'dir');
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>('#sidebar-tabs button')) {
  button.addEventListener('click', () => {
    const tab = button.dataset.tab as 'files' | 'outline' | 'search';
    void updateSettings({ view: { sidebarVisible: true, sidebarTab: tab } });
  });
}

sidebarToggle.addEventListener('click', () => {
  void updateSettings({ view: { sidebarVisible: !state.settings.view.sidebarVisible } });
});

sidebarResizer.addEventListener('mousedown', (event) => {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = sidebarEl.getBoundingClientRect().width;
  const onMove = (moveEvent: MouseEvent): void => {
    const width = Math.min(520, Math.max(180, startWidth + moveEvent.clientX - startX));
    sidebarEl.style.width = `${width}px`;
  };
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const width = Math.min(520, Math.max(180, sidebarEl.getBoundingClientRect().width));
    void updateSettings({ view: { sidebarWidth: width } });
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

window.mdstudio.onCommand((event) => {
  runCommand(event.id, event.arg);
});

// 编辑区右键菜单（REQ-021）：参数来自主进程的 Chromium context-menu 事件
window.mdstudio.onContextMenu((event) => {
  showEditorContextMenu(event, {
    runCommand: (id, arg) => {
      editor.focus();
      runCommand(id, arg);
    },
    isInsideTable: () => isInsideTable(editor.view),
    replaceMisspelling: (word) => {
      void window.mdstudio.replaceMisspelling(word);
    },
    openExternal: (url) => {
      void window.mdstudio.openExternal(url).catch(() => toast(tr('toast.linkOpenFailed', { url }), 'warn'));
    },
    notify
  });
});

window.mdstudio.onSettingsChanged(({ settings }) => {
  const themeChanged =
    settings.theme.mode !== state.settings.theme.mode || settings.theme.userTheme !== state.settings.theme.userTheme;
  const languageChanged = settings.language !== state.settings.language;
  const exportChanged = settings.exportOptions.inlineMathFonts !== state.settings.exportOptions.inlineMathFonts;
  state.settings = settings;
  if (languageChanged) applyLocale(settings, { notifyUser: true });
  applyTheme();
  applyViewSettings();
  if (themeChanged) {
    invalidateMermaidCache();
    redrawMermaidWidgets(editor.view);
    void loadUserTheme();
  }
  if (exportChanged) notify(tr('settings.exportOptions'));
});

/** 应用界面语言：静态文案 + 动态视图重绘（REQ-033）。 */
function applyLocale(settings: Settings, options: { notifyUser?: boolean } = {}): void {
  setLocale(settings.language);
  applyStaticTexts();
  languageSelect.options[0] = new Option(tr('status.codeLanguage'), '');
  fileTree.render();
  outlineView.render();
  searchView.render();
  renderTitle();
  tabBar.render();
  applyTheme();
  updateStats();
  if (options.notifyUser) {
    notify(tr('toast.languageChanged', { name: settings.language === 'en' ? 'English' : '简体中文' }));
  }
}

window.mdstudio.onKeymapChanged((result) => {
  state.keymap = result;
  editor.applySettings(state.settings, result.bindings);
  if (result.conflicts.length > 0) {
    notify(tr('toast.keymapConflicts', { count: result.conflicts.length }), 'warn');
  }
});

window.mdstudio.onThemesChanged(({ themes }) => {
  state.themes = themes;
  void loadUserTheme();
});

window.mdstudio.onWorkspaceChanged((batch) => {
  fileTree.handleEvents(batch.events as WorkspaceChangedEvent[]);
});

window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const path = window.mdstudio.getPathForFile(file);
  if (path && isMarkdownPath(path)) {
    event.preventDefault();
    void docManager.openPath(path);
  }
});

// ---- 启动 ----

async function checkRecovery(): Promise<void> {
  try {
    const info = await window.mdstudio.startupInfo();
    if (info.drafts.length === 0) return;
    if (!info.crashed) {
      await window.mdstudio.discardDrafts();
      return;
    }
    const preview = info.drafts
      .slice(0, 3)
      .map((draft) =>
        tr('app.recoveryItem', { name: draft.name, time: new Date(draft.updatedAt).toLocaleString(locale()) })
      )
      .join('\n');
    const choice = await confirmDialog({
      title: tr('dialog.recovery.title'),
      message: `${tr('dialog.recovery.message', { count: info.drafts.length })}\n${preview}${info.drafts.length > 3 ? '\n…' : ''}`,
      buttons: [
        { label: tr('dialog.recovery.discard'), value: 'discard' },
        { label: tr('dialog.recovery.recover'), value: 'recover', kind: 'primary' }
      ]
    });
    if (choice === 'recover') {
      const first = info.drafts[0];
      if (first) {
        const { draft } = await window.mdstudio.readDraft(first.id);
        if (draft) await docManager.applyRecoveredDraft(draft);
      }
    }
    await window.mdstudio.discardDrafts();
  } catch (error) {
    void window.mdstudio.log('warn', `草稿恢复检查失败：${(error as Error).message}`);
  }
}

async function bootstrap(): Promise<void> {
  const [settingsResult, keymapResult, themesResult] = await Promise.all([
    window.mdstudio.getSettings(),
    window.mdstudio.getKeymap(),
    window.mdstudio.listThemes()
  ]);
  state.settings = settingsResult.settings;
  state.keymap = keymapResult;
  state.themes = themesResult.themes;

  setLocale(state.settings.language);
  applyStaticTexts();
  registerCommands();
  applyTheme();
  await loadUserTheme();
  applyViewSettings();
  editor.applySettings(state.settings, state.keymap.bindings);

  fileTree.setRoot(state.settings.files.workspaceRoot);
  renderTitle();
  tabBar.render();
  updateStats();
  updateCursor();
  outlineView.update(editor.view.state.doc.toString());

  const restored = await docManager.restoreSession();
  if (!restored) docManager.loadWelcome(welcomeText());

  if (state.keymap.conflicts.length > 0) {
    notify(tr('toast.keymapConflicts', { count: state.keymap.conflicts.length }), 'warn');
  }

  editor.focus();
  void checkRecovery();
  void window.mdstudio.log('info', '渲染层就绪');
  console.log('[md-studio] renderer ready');
}

void bootstrap().catch((error: unknown) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#b3301f">${tr('app.startFailed', {
    message: String(error)
  })}</pre>`;
  void window.mdstudio.log('error', `渲染层启动失败：${(error as Error).stack ?? String(error)}`);
});
