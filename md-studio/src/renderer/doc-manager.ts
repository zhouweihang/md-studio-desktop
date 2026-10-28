import type { DraftRecord, FileChangedEvent } from '../shared/channels';
import { draftIdFor } from '../shared/draft-id';
import { baseName, dirName } from '../shared/paths';
import type { InlineMathFontsScope, Settings } from '../shared/settings';
import type { EditorHandle } from './editor/setup';
import { renderDocumentHtml } from './export/render-html';
import { tr } from './i18n';
import { SessionPool, type TabOptions, type TabRecord } from './session';
import { confirmDialog, promptDialog, toast } from './shell/dialogs';

export interface ExportSupport {
  themeCss(): string;
  katexCss: string;
  mermaidToSvg(code: string): Promise<string | null>;
}

export type PandocFormat = 'docx' | 'latex' | 'epub' | 'rtf' | 'odt';

export interface DocManagerDeps {
  editor(): EditorHandle;
  settings(): Settings;
  exportSupport(): ExportSupport;
  /** 标签集合/标题/脏状态变化后重绘外壳 */
  onStateChanged(): void;
  notify(message: string, kind?: 'info' | 'warn' | 'error'): void;
  /** 激活标签后同步编辑器设置（模式/键位） */
  applyEditorSettings(): void;
  /** 未命名标签的本地化名称 */
  untitledName(): string;
}

interface OpenOptions {
  /** 后台打开（启动恢复时用，不切换视图） */
  activate?: boolean;
  anchor?: number;
}

const DRAFT_INTERVAL_MS = 5000;
const DRAFT_SIZE_DELTA = 2000;
const SESSION_SAVE_DELAY_MS = 400;

/** 单窗口多标签的文档生命周期管理（REQ-009/010/014/032）。 */
export class DocManager {
  private readonly pool: SessionPool;
  private switching = false;
  private lastSyncedId: number | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DocManagerDeps) {
    this.pool = new SessionPool((content, anchor) => this.deps.editor().createState(content, anchor));
    window.mdstudio.onFileChanged((event) => void this.handleExternalChange(event));
    // 首个标签直接采用编辑器已构造的状态（欢迎文档随其保留）
    const first = this.pool.add({ content: '', name: this.deps.untitledName() });
    this.pool.storeState(first.id, this.deps.editor().view.state);
    this.lastSyncedId = first.id;
  }

  // ---- 标签查询 ----

  get tabs(): TabRecord[] {
    return [...this.pool.all];
  }

  get activeId(): number | null {
    return this.pool.currentId;
  }

  get currentPath(): string | null {
    return this.pool.active?.path ?? null;
  }

  get currentMtime(): number | null {
    return this.pool.active?.mtimeMs ?? null;
  }

  get isDirty(): boolean {
    return this.pool.active?.dirty ?? false;
  }

  get hasDirtyTabs(): boolean {
    return this.pool.all.some((tab) => tab.dirty);
  }

  get documentName(): string {
    const tab = this.pool.active;
    if (!tab) return this.deps.untitledName();
    // 未保存文档的显示名按当前语言实时计算（B5-7），不读存储的旧语言名称
    if (tab.untitled) return this.deps.untitledName();
    return tab.path ? baseName(tab.path) : tab.name;
  }

  get docDir(): string | null {
    const path = this.currentPath;
    return path ? dirName(path) : null;
  }

  /** 当前文档内容（活动标签取视图，后台标签取其状态）。 */
  get content(): string {
    const tab = this.pool.active;
    return tab ? this.contentOf(tab) : '';
  }

  // ---- 标签切换 / 新建 / 关闭 ----

  /** 把视图状态（含游标与滚动）回存到活动标签。 */
  commitActive(): void {
    const tab = this.pool.active;
    if (!tab) return;
    this.pool.storeState(tab.id, this.deps.editor().view.state, this.deps.editor().view.scrollDOM.scrollTop);
  }

  /** 激活标签并让视图载入其状态。 */
  activateTab(id: number): void {
    if (this.pool.currentId === id) return;
    this.commitActive();
    if (!this.pool.activate(id)) return;
    this.syncViewToActive();
    this.scheduleSessionSave();
  }

  activateRelative(delta: number): void {
    this.commitActive();
    if (!this.pool.activateRelative(delta)) return;
    this.syncViewToActive();
    this.scheduleSessionSave();
  }

  /** 拖拽重排标签（顺序随 `settings.tabs.open` 持久化）。 */
  moveTab(id: number, targetIndex: number): void {
    if (!this.pool.moveTo(id, targetIndex)) return;
    this.deps.onStateChanged();
    this.scheduleSessionSave();
  }

  newTab(): void {
    this.commitActive();
    this.pool.add({ content: '', name: this.deps.untitledName() });
    this.syncViewToActive();
    this.scheduleSessionSave();
  }

  /** 兼容 `file.new`：与新建标签同义。 */
  newDocument(): void {
    this.newTab();
  }

  /** 启动时把欢迎文档写入空白标签（语言切换后由调用方再次传入）。 */
  loadWelcome(content: string): void {
    const tab = this.pool.active;
    if (!tab || tab.path || tab.dirty) return;
    if (this.contentOf(tab).trim().length > 0) return;
    this.switching = true;
    try {
      this.deps.editor().setDoc(content);
    } finally {
      this.switching = false;
    }
    tab.lastDraftLength = content.length;
    this.commitActive();
    this.pool.setDirty(tab.id, false);
    this.deps.onStateChanged();
  }

  async closeTab(id: number): Promise<void> {
    const tab = this.pool.find(id);
    if (!tab) return;
    if (tab.id === this.pool.currentId) this.commitActive();
    if (tab.dirty) {
      const choice = await confirmDialog({
        title: tr('dialog.unsaved.title'),
        message: tr('dialog.unsaved.message'),
        detail: `${tab.name}\n${tr('dialog.unsaved.detail')}`,
        buttons: [
          { label: tr('dialog.cancel'), value: 'cancel' },
          { label: tr('dialog.unsaved.discard'), value: 'discard' },
          { label: tr('dialog.unsaved.save'), value: 'save', kind: 'primary' }
        ]
      });
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await this.saveTab(tab, true))) return;
    }
    await this.discardTab(tab);
  }

  async closeOtherTabs(id: number): Promise<void> {
    const tab = this.pool.find(id);
    if (!tab) return;
    this.commitActive();
    const removed = this.pool.closeOthers(id);
    for (const item of removed) await this.clearTabDraft(item);
    this.pool.activate(id);
    this.syncViewToActive();
    this.scheduleSessionSave();
  }

  async closeTabsToRight(id: number): Promise<void> {
    const tab = this.pool.find(id);
    if (!tab) return;
    this.commitActive();
    const removed = this.pool.closeRight(id);
    for (const item of removed) await this.clearTabDraft(item);
    this.pool.activate(id);
    this.syncViewToActive();
    this.scheduleSessionSave();
  }

  private async discardTab(tab: TabRecord): Promise<void> {
    const closedActive = this.pool.currentId === tab.id;
    const nextId = this.pool.close(tab.id);
    await this.clearTabDraft(tab);
    if (nextId === null) {
      this.newTab();
      return;
    }
    if (closedActive) this.syncViewToActive();
    this.scheduleSessionSave();
  }

  private async clearTabDraft(tab: TabRecord): Promise<void> {
    try {
      await window.mdstudio.clearDraft(draftIdFor(tab.path));
    } catch {
      // 草稿清理失败不阻塞关闭
    }
  }

  /** 视图载入当前活动标签的状态（切换/新建/恢复后调用）。 */
  private syncViewToActive(): void {
    const tab = this.pool.active;
    if (!tab) return;
    const view = this.deps.editor().view;
    this.switching = true;
    try {
      if (this.lastSyncedId !== tab.id) view.setState(tab.state);
      view.scrollDOM.scrollTop = tab.scrollTop;
    } finally {
      this.switching = false;
    }
    this.lastSyncedId = tab.id;
    this.deps.applyEditorSettings();
    void window.mdstudio.watchFile(tab.path);
    this.refreshDirtyFlag();
    this.deps.editor().focus();
    this.deps.onStateChanged();
  }

  private refreshDirtyFlag(): void {
    void window.mdstudio.setDirty(this.hasDirtyTabs).catch(() => undefined);
  }

  // ---- 打开 / 新建 ----

  openDocument(path: string | null, content: string, mtimeMs: number | null, options: OpenOptions = {}): TabRecord {
    const existing = path ? this.pool.findByPath(path) : null;
    if (existing) {
      if (options.activate !== false) this.activateTab(existing.id);
      return existing;
    }
    const previous = this.pool.currentId;
    const tab = this.pool.add({
      content,
      path,
      name: path ? baseName(path) : this.deps.untitledName(),
      mtimeMs,
      anchor: options.anchor ?? 0
    });
    if (options.activate === false && previous !== null) {
      this.pool.activate(previous);
      return tab;
    }
    this.syncViewToActive();
    this.scheduleSessionSave();
    return tab;
  }

  async openDialog(): Promise<boolean> {
    const result = await window.mdstudio.openFileDialog();
    if (result.canceled) return false;
    if (result.error || result.content === undefined) {
      this.deps.notify(result.error ?? tr('toast.openFailed'), 'error');
      return false;
    }
    this.openDocument(result.path ?? null, result.content, result.mtimeMs ?? null);
    return true;
  }

  async openPath(path: string, line?: number, options: OpenOptions = {}): Promise<boolean> {
    const result = await window.mdstudio.openPath(path);
    if (result.canceled || result.content === undefined) {
      this.deps.notify(result.error ?? tr('toast.openFailed'), 'error');
      return false;
    }
    const tab = this.openDocument(result.path ?? path, result.content, result.mtimeMs ?? null, options);
    if (line && line > 1) this.gotoLine(tab, line);
    return true;
  }

  private gotoLine(tab: TabRecord, line: number): void {
    if (tab.id !== this.pool.currentId) this.activateTab(tab.id);
    const view = this.deps.editor().view;
    const target = Math.min(line, view.state.doc.lines);
    const position = view.state.doc.line(target).from;
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    this.deps.editor().focus();
  }

  /** 启动恢复（REQ-032）：按 `settings.tabs` 重开上次的标签集合。 */
  async restoreSession(): Promise<boolean> {
    const snapshot = this.deps.settings().tabs;
    const wanted = snapshot.open.filter((entry) => !!entry.path);
    if (wanted.length === 0) return false;
    const restoredIds: number[] = [];
    const skipped: string[] = [];
    const anchors = new Map<string, number>();
    for (const entry of wanted) anchors.set(entry.path as string, entry.anchor);
    for (const entry of wanted) {
      const path = entry.path as string;
      const result = await window.mdstudio.openPath(path);
      if (result.canceled || result.content === undefined) {
        skipped.push(entry.name || baseName(path));
        continue;
      }
      const tab = this.openDocument(result.path ?? path, result.content, result.mtimeMs ?? null, {
        activate: false,
        anchor: anchors.get(path) ?? 0
      });
      restoredIds.push(tab.id);
    }
    if (restoredIds.length === 0) return false;
    const initial = this.pool.all.find((tab) => !tab.path && !tab.dirty);
    if (initial) this.pool.close(initial.id);
    const targetId = restoredIds[Math.min(Math.max(snapshot.active, 0), restoredIds.length - 1)];
    if (targetId !== undefined) {
      this.pool.activate(targetId);
      this.syncViewToActive();
    }
    this.scheduleSessionSave();
    if (skipped.length > 0) {
      this.deps.notify(tr('toast.restoreSkipped', { names: skipped.join('、') }), 'warn');
      void window.mdstudio.log('warn', `标签恢复跳过：${skipped.join(', ')}`);
    }
    return true;
  }

  /** 从磁盘重载指定标签（默认活动标签）。 */
  async reloadFromDisk(silent = false, target?: TabRecord): Promise<void> {
    const tab = target ?? this.pool.active;
    if (!tab || !tab.path) return;
    try {
      const result = await window.mdstudio.readFile(tab.path);
      if (tab.id === this.pool.currentId) {
        this.switching = true;
        try {
          this.deps.editor().setDoc(result.content);
        } finally {
          this.switching = false;
        }
      }
      tab.state = tab.id === this.pool.currentId ? this.deps.editor().view.state : this.deps.editor().createState(result.content);
      tab.mtimeMs = result.mtimeMs;
      tab.lastDraftLength = result.content.length;
      this.pool.setDirty(tab.id, false);
      await window.mdstudio.clearDraft(draftIdFor(tab.path));
      this.refreshDirtyFlag();
      this.deps.onStateChanged();
      if (!silent) this.deps.notify(tr('toast.reloaded'));
    } catch (error) {
      this.deps.notify(tr('toast.reloadFailed', { message: (error as Error).message }), 'error');
    }
  }

  // ---- 脏状态 / 自动保存 / 草稿 ----

  markDirty(): void {
    if (this.switching) return;
    const tab = this.pool.active;
    if (!tab) return;
    const wasDirty = tab.dirty;
    this.pool.setDirty(tab.id, true);
    this.refreshDirtyFlag();
    this.scheduleAutosave(tab);
    this.scheduleDraft(tab);
    // 不在每次输入后写 settings.tabs：标签集合/游标由切标签、开关标签、保存等事件负责持久化，
    // 否则每 400 ms 就会触发一次设置广播与编辑器重配置（会干扰输入法组合）
    if (!wasDirty) this.deps.onStateChanged();
  }

  private scheduleAutosave(tab: TabRecord): void {
    const settings = this.deps.settings();
    if (!settings.autosave.enabled || !tab.path) return;
    if (tab.autosaveTimer) clearTimeout(tab.autosaveTimer);
    tab.autosaveTimer = setTimeout(() => {
      tab.autosaveTimer = null;
      void this.saveTab(tab, true);
    }, settings.autosave.delayMs);
  }

  private scheduleDraft(tab: TabRecord): void {
    const length = this.contentOf(tab).length;
    if (Math.abs(length - tab.lastDraftLength) >= DRAFT_SIZE_DELTA) {
      tab.lastDraftLength = length;
      void this.writeDraft(tab);
      return;
    }
    if (tab.draftTimer) clearTimeout(tab.draftTimer);
    tab.draftTimer = setTimeout(() => {
      tab.draftTimer = null;
      void this.writeDraft(tab);
    }, DRAFT_INTERVAL_MS);
  }

  private async writeDraft(tab: TabRecord): Promise<void> {
    if (!tab.dirty) return;
    try {
      await window.mdstudio.saveDraft({
        id: draftIdFor(tab.path),
        path: tab.path,
        name: tab.path ? baseName(tab.path) : tab.name,
        content: this.contentOf(tab)
      });
    } catch {
      // 草稿写入失败不打扰用户，下一次节拍重试
    }
  }

  private contentOf(tab: TabRecord): string {
    if (tab.id === this.pool.currentId && this.lastSyncedId === tab.id) {
      return this.deps.editor().view.state.doc.toString();
    }
    return tab.state.doc.toString();
  }

  // ---- 保存 ----

  async save(silent = false): Promise<boolean> {
    const tab = this.pool.active;
    if (!tab) return false;
    return this.saveTab(tab, silent);
  }

  async saveTab(tab: TabRecord, silent = false): Promise<boolean> {
    if (!tab.path) return this.saveTabAs(tab);
    const content = this.contentOf(tab);
    const result = await window.mdstudio.saveFile({
      path: tab.path,
      content,
      mtimeMs: tab.mtimeMs ?? undefined
    });
    if (result.ok) {
      tab.mtimeMs = result.mtimeMs;
      this.pool.setDirty(tab.id, false);
      tab.lastDraftLength = content.length;
      await window.mdstudio.clearDraft(draftIdFor(tab.path));
      this.refreshDirtyFlag();
      this.deps.onStateChanged();
      this.deps.notify(silent ? tr('toast.autosaved') : tr('toast.saved'));
      return true;
    }
    if (!result.ok && result.conflict) {
      await this.handleSaveConflict(tab);
      return !tab.dirty;
    }
    if (!result.ok) this.deps.notify(result.error, 'error');
    return false;
  }

  async saveAs(): Promise<boolean> {
    const tab = this.pool.active;
    if (!tab) return false;
    return this.saveTabAs(tab);
  }

  async saveTabAs(tab: TabRecord): Promise<boolean> {
    const suggestedName = tab.path ? baseName(tab.path) : `${tab.name}.md`;
    const result = await window.mdstudio.saveFileAs({
      content: this.contentOf(tab),
      suggestedName
    });
    if (result.canceled) return false;
    if (result.error || !result.path) {
      this.deps.notify(result.error ?? tr('toast.saveAsFailed'), 'error');
      return false;
    }
    const previous = tab.path;
    const savedPath = result.path;
    this.pool.setPath(tab.id, savedPath);
    tab.mtimeMs = result.mtimeMs ?? null;
    tab.lastDraftLength = this.contentOf(tab).length;
    this.pool.setDirty(tab.id, false);
    if (previous) await window.mdstudio.clearDraft(draftIdFor(previous));
    await window.mdstudio.clearDraft(draftIdFor(savedPath));
    if (tab.id === this.pool.currentId) void window.mdstudio.watchFile(savedPath);
    this.refreshDirtyFlag();
    this.deps.onStateChanged();
    this.scheduleSessionSave();
    this.deps.notify(tr('toast.savedAs', { name: baseName(savedPath) }));
    return true;
  }

  /** 关闭窗口流程：保存全部脏标签；任一步失败则不放行关闭。 */
  async saveAndClose(): Promise<void> {
    this.commitActive();
    for (const tab of this.pool.all) {
      if (!tab.dirty) continue;
      const saved = await this.saveTab(tab, true);
      if (!saved) {
        await window.mdstudio.confirmClose(false);
        return;
      }
    }
    await window.mdstudio.confirmClose(true);
  }

  private async handleSaveConflict(tab: TabRecord): Promise<void> {
    if (!tab.path) return;
    const { choice } = await window.mdstudio.conflictDialog({
      path: tab.path,
      suggestedName: baseName(tab.path)
    });
    if (choice === 'reload') {
      await this.reloadFromDisk(false, tab);
      return;
    }
    if (choice === 'save-as') {
      await this.saveTabAs(tab);
      return;
    }
    if (choice === 'overwrite') {
      const content = this.contentOf(tab);
      const result = await window.mdstudio.saveFile({ path: tab.path, content, force: true });
      if (result.ok) {
        tab.mtimeMs = result.mtimeMs;
        this.pool.setDirty(tab.id, false);
        this.refreshDirtyFlag();
        this.deps.onStateChanged();
        this.deps.notify(tr('toast.overwritten'));
      } else if (!result.ok && !result.conflict) {
        this.deps.notify(result.error, 'error');
      }
    }
  }

  // ---- 外部变更 ----

  private async handleExternalChange(event: FileChangedEvent): Promise<void> {
    const tab = this.pool.findByPath(event.path);
    if (!tab) return;
    if (event.deleted) {
      this.deps.notify(tr('toast.deletedOnDisk'), 'warn');
      tab.mtimeMs = null;
      return;
    }
    if (!tab.dirty) {
      await this.reloadFromDisk(true, tab);
      this.deps.notify(tr('toast.externalChanged'));
      return;
    }
    const choice = await confirmDialog({
      title: tr('dialog.external.title'),
      message: tr('dialog.external.message'),
      buttons: [
        { label: tr('dialog.external.keep'), value: 'keep' },
        { label: tr('dialog.conflict.reload'), value: 'reload', kind: 'primary' }
      ]
    });
    if (choice === 'reload') await this.reloadFromDisk(false, tab);
  }

  private scheduleSessionSave(): void {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null;
      this.commitActive();
      void window.mdstudio
        .updateSettings({ tabs: this.pool.snapshot() } as never)
        .catch(() => undefined);
    }, SESSION_SAVE_DELAY_MS);
  }

  // ---- 导出 ----

  /** 当前文档名（去扩展名），导出默认名用。 */
  private get baseNameWithoutExtension(): string {
    return this.documentName.replace(/\.[^.]+$/, '');
  }

  private async renderHtml(options: { inlineMathFonts?: InlineMathFontsScope } = {}): Promise<string> {
    const support = this.deps.exportSupport();
    return renderDocumentHtml({
      markdown: this.content,
      title: this.documentName,
      themeCss: support.themeCss(),
      katexCss: support.katexCss,
      inlineMathFonts: options.inlineMathFonts,
      mermaidToSvg: support.mermaidToSvg
    });
  }

  async exportHtml(): Promise<void> {
    const supportsFonts = this.supportsInlineMathFonts();
    const html = await this.renderHtml({ inlineMathFonts: supportsFonts });
    const result = await window.mdstudio.exportHtml({
      html,
      suggestedName: `${this.baseNameWithoutExtension}.html`
    });
    if (result.canceled) return;
    if (result.error) {
      this.deps.notify(result.error, 'error');
      return;
    }
    this.deps.notify(tr('toast.exported', { name: `HTML · ${baseName(result.path ?? '')}` }));
  }

  async exportPdf(): Promise<void> {
    const html = await this.renderHtml({ inlineMathFonts: this.supportsInlineMathFonts() });
    const result = await window.mdstudio.exportPdf({
      html,
      suggestedName: `${this.baseNameWithoutExtension}.pdf`
    });
    if (result.canceled) return;
    if (result.error) {
      this.deps.notify(result.error, 'error');
      toast(tr('toast.exportedFailed', { name: 'PDF' }), 'error');
      return;
    }
    this.deps.notify(tr('toast.exported', { name: `PDF · ${baseName(result.path ?? '')}` }));
  }

  /** 导出纯文本（REQ-027）：按原始 Markdown 文字写出。 */
  async exportText(): Promise<void> {
    const result = await window.mdstudio.exportText({
      content: this.content,
      suggestedName: `${this.baseNameWithoutExtension}.txt`
    });
    if (result.canceled) return;
    if (result.error) {
      this.deps.notify(result.error, 'error');
      return;
    }
    this.deps.notify(tr('toast.exported', { name: `TXT · ${baseName(result.path ?? '')}` }));
  }

  /** 导出整页图片（REQ-027）：PNG / JPEG。 */
  async exportImage(format: 'png' | 'jpeg'): Promise<void> {
    const html = await this.renderHtml({ inlineMathFonts: this.supportsInlineMathFonts() });
    const result = await window.mdstudio.exportImage({
      html,
      suggestedName: `${this.baseNameWithoutExtension}.${format === 'png' ? 'png' : 'jpg'}`,
      format
    });
    if (!result.ok) {
      if (result.canceled) return;
      this.deps.notify(result.error, 'error');
      return;
    }
    const names = result.paths.map((path) => baseName(path)).join(', ');
    this.deps.notify(tr('toast.exported', { name: names }) + (result.truncated ? ` ${tr('toast.exportedPaged')}` : ''));
  }

  /** 打印（REQ-022）：走系统打印对话框。 */
  async print(): Promise<void> {
    const html = await this.renderHtml({ inlineMathFonts: this.supportsInlineMathFonts() });
    const result = await window.mdstudio.print({ html, suggestedName: this.documentName });
    if (!result.ok) this.deps.notify(result.error ?? tr('toast.printFailed'), 'error');
    else if (!result.canceled) this.deps.notify(tr('toast.print'));
  }

  /** 导出件内联 KaTeX 字体的范围（REQ-035 / B5-5，默认 `off`）。 */
  private supportsInlineMathFonts(): InlineMathFontsScope {
    return this.deps.settings().exportOptions.inlineMathFonts;
  }

  /** Pandoc 导出（REQ-031）：docx / LaTeX / ePub / RTF / ODT。 */
  async exportWithPandoc(format: PandocFormat): Promise<void> {
    const status = await window.mdstudio.pandocStatus();
    if (!status.available) {
      await confirmDialog({
        title: tr('dialog.pandoc.title'),
        message: tr('dialog.pandoc.message'),
        buttons: [{ label: tr('dialog.confirm'), value: 'ok' }],
        detail: tr('dialog.pandoc.detail')
      });
      return;
    }
    const extension =
      format === 'docx' ? 'docx' : format === 'latex' ? 'tex' : format === 'epub' ? 'epub' : format === 'rtf' ? 'rtf' : 'odt';
    const result = await window.mdstudio.pandocExport({
      markdown: this.content,
      docName: this.baseNameWithoutExtension,
      format,
      docDir: this.docDir,
      title: this.baseNameWithoutExtension
    });
    if (result.canceled) return;
    if (result.error) {
      this.deps.notify(result.error, 'error');
      return;
    }
    this.deps.notify(tr('toast.exported', { name: `${extension.toUpperCase()} · ${baseName(result.path ?? '')}` }));
  }

  // ---- 文件操作补全（REQ-029） ----

  async renameFile(): Promise<void> {
    const tab = this.pool.active;
    if (!tab?.path) {
      this.deps.notify(tr('toast.needSaveFirst'), 'warn');
      return;
    }
    const current = baseName(tab.path);
    const next = await promptDialog({ title: tr('dialog.rename.title'), label: tr('dialog.rename.label'), value: current });
    if (!next || next === current) return;
    const result = await window.mdstudio.renameFile({ path: tab.path, name: next });
    if (!result.ok || !result.path) {
      this.deps.notify(result.error ?? tr('toast.renameFailed'), 'error');
      return;
    }
    const previous = tab.path;
    this.pool.setPath(tab.id, result.path);
    await window.mdstudio.clearDraft(draftIdFor(previous));
    if (tab.id === this.pool.currentId) void window.mdstudio.watchFile(tab.path);
    this.deps.onStateChanged();
    this.scheduleSessionSave();
    this.deps.notify(tr('toast.renamed', { name: baseName(tab.path) }));
  }

  async deleteFile(): Promise<void> {
    const tab = this.pool.active;
    if (!tab?.path) return;
    const choice = await confirmDialog({
      title: tr('dialog.delete.title'),
      message: tr('dialog.delete.message', { name: baseName(tab.path) }),
      buttons: [
        { label: tr('dialog.cancel'), value: 'cancel' },
        { label: tr('dialog.delete.confirm'), value: 'delete', kind: 'primary' }
      ]
    });
    if (choice !== 'delete') return;
    const result = await window.mdstudio.deleteFile(tab.path);
    if (!result.ok) {
      this.deps.notify(result.error ?? tr('toast.deleteFailed'), 'error');
      return;
    }
    await window.mdstudio.clearDraft(draftIdFor(tab.path));
    this.pool.setPath(tab.id, null);
    tab.mtimeMs = null;
    this.pool.setDirty(tab.id, true);
    this.refreshDirtyFlag();
    if (tab.id === this.pool.currentId) void window.mdstudio.watchFile(null);
    this.deps.onStateChanged();
    this.scheduleSessionSave();
    this.deps.notify(tr('toast.deleted'), 'warn');
  }

  async revealInFolder(): Promise<void> {
    const path = this.currentPath;
    if (!path) {
      this.deps.notify(tr('toast.notOnDisk'), 'warn');
      return;
    }
    await window.mdstudio.reveal(path);
  }

  /** 历史版本（REQ-030）：列出快照 → 预览差异 → 恢复。 */
  async showHistory(): Promise<void> {
    const tab = this.pool.active;
    if (!tab?.path) {
      this.deps.notify(tr('toast.noHistoryUnsaved'), 'warn');
      return;
    }
    const path = tab.path;
    const { entries } = await window.mdstudio.listHistory(path);
    if (entries.length === 0) {
      this.deps.notify(tr('toast.noHistory'), 'warn');
      return;
    }
    const { showHistoryDialog } = await import('./shell/history-view');
    await showHistoryDialog({
      path,
      entries,
      current: this.content,
      onRestore: async (content) => {
        this.switching = true;
        try {
          this.deps.editor().setDoc(content);
        } finally {
          this.switching = false;
        }
        this.pool.setDirty(tab.id, true);
        this.refreshDirtyFlag();
        const saved = await this.save();
        this.deps.notify(saved ? tr('toast.historyRestored') : tr('toast.historyLoaded'), saved ? 'info' : 'warn');
      }
    });
  }

  // ---- 崩溃恢复 ----

  async applyRecoveredDraft(draft: DraftRecord): Promise<void> {
    this.openDocument(draft.path, draft.content, null);
    const tab = this.pool.active;
    if (tab) {
      this.pool.setDirty(tab.id, true);
      this.refreshDirtyFlag();
    }
    if (draft.path) void window.mdstudio.watchFile(draft.path);
    this.deps.onStateChanged();
    this.deps.notify(tr('toast.draftRecovered', { name: draft.name }));
  }

}
