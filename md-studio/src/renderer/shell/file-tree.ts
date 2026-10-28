import type { DirEntry, WorkspaceChangedEvent } from '../../shared/channels';
import { baseName, dirName, extName, joinPath } from '../../shared/paths';
import { tr } from '../i18n';
import { confirmDialog, contextMenu, promptDialog, toast } from './dialogs';

export interface FileTreeOptions {
  onOpenFile(path: string): void;
  currentFile(): string | null;
}

const ICONS: Record<string, string> = {
  md: '▤',
  markdown: '▤',
  txt: '▤',
  png: '▣',
  jpg: '▣',
  jpeg: '▣',
  gif: '▣',
  webp: '▣',
  svg: '▣',
  json: '∷',
  css: '≣',
  html: '≺',
  ts: '⌘',
  js: '⌘'
};

function iconFor(entry: DirEntry): string {
  if (entry.kind === 'dir') return '▸';
  return ICONS[extName(entry.name)] ?? '·';
}

/** 工作区文件树（按需加载目录，避免一次性遍历 1000+ 节点）。 */
export class FileTree {
  private root: string | null = null;
  private readonly expanded = new Set<string>();
  private readonly cache = new Map<string, DirEntry[]>();
  private readonly containers = new Map<string, HTMLElement>();
  private readonly dirtyDirs = new Set<string>();
  private selected: string | null = null;
  private dragging: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: FileTreeOptions
  ) {}

  setRoot(root: string | null): void {
    this.root = root;
    this.expanded.clear();
    this.cache.clear();
    this.containers.clear();
    this.dirtyDirs.clear();
    void this.renderAll();
  }

  getRoot(): string | null {
    return this.root;
  }

  setSelected(path: string | null): void {
    if (this.selected === path) return;
    this.selected = path;
    for (const row of this.container.querySelectorAll<HTMLElement>('.tree-row')) {
      row.classList.toggle('selected', row.dataset.path === path);
    }
  }

  /** 外部变更：刷新受影响的已加载目录。 */
  handleEvents(events: WorkspaceChangedEvent[]): void {
    let fullReload = false;
    for (const event of events) {
      const dir = event.event === 'unlinkDir' || event.event === 'addDir' ? dirName(event.path) : dirName(event.path);
      if (!this.root) continue;
      if (this.root === event.path || this.root === dir) {
        fullReload = true;
        continue;
      }
      if (this.cache.has(dir)) {
        this.cache.delete(dir);
        const host = this.containers.get(dir);
        if (host) void this.renderDirInto(dir, host);
      }
    }
    if (fullReload) void this.renderAll();
  }

  async renderAll(): Promise<void> {
    this.containers.clear();
    this.cache.clear();
    this.container.innerHTML = '';
    if (!this.root) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = `${tr('files.empty')}\n${tr('files.emptyHint')}`;
      this.container.append(empty);
      return;
    }
    const host = document.createElement('div');
    this.container.append(host);
    this.containers.set(this.root, host);
    this.expanded.add(this.root);
    await this.renderDirInto(this.root, host);
  }

  private async loadDir(dir: string): Promise<DirEntry[]> {
    const cached = this.cache.get(dir);
    if (cached) return cached;
    try {
      const result = await window.mdstudio.readDir(dir);
      this.cache.set(dir, result.entries);
      if (result.truncated) toast(tr('files.truncated', { name: baseName(dir) }), 'warn');
      return result.entries;
    } catch (error) {
      toast(tr('files.readDirFailed', { message: (error as Error).message }), 'error');
      this.cache.set(dir, []);
      return [];
    }
  }

  private async renderDirInto(dir: string, host: HTMLElement): Promise<void> {
    host.innerHTML = '';
    const entries = await this.loadDir(dir);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = tr('files.emptyDir');
      host.append(empty);
      return;
    }
    for (const entry of entries) {
      host.append(this.createRow(entry));
      if (entry.kind === 'dir' && this.expanded.has(entry.path)) {
        const childHost = document.createElement('div');
        childHost.className = 'tree-children';
        host.append(childHost);
        this.containers.set(entry.path, childHost);
        await this.renderDirInto(entry.path, childHost);
      }
    }
  }

  private toggleDir(entry: DirEntry, row: HTMLElement): void {
    const host = this.containers.get(entry.path);
    if (this.expanded.has(entry.path) && host) {
      this.expanded.delete(entry.path);
      this.containers.delete(entry.path);
      host.remove();
      row.querySelector('.twisty')!.textContent = '▸';
      return;
    }
    this.expanded.add(entry.path);
    row.querySelector('.twisty')!.textContent = '▾';
    const childHost = document.createElement('div');
    childHost.className = 'tree-children';
    row.after(childHost);
    this.containers.set(entry.path, childHost);
    void this.renderDirInto(entry.path, childHost);
  }

  private createRow(entry: DirEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.path = entry.path;
    row.draggable = true;
    if (entry.path === this.selected) row.classList.add('selected');

    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    twisty.textContent = entry.kind === 'dir' ? (this.expanded.has(entry.path) ? '▾' : '▸') : '';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = iconFor(entry);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.name;
    row.append(twisty, icon, name);

    row.addEventListener('click', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (entry.kind === 'dir') this.toggleDir(entry, row);
      else this.options.onOpenFile(entry.path);
    });

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      contextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          ...(entry.kind === 'dir'
            ? [
                { label: `${tr('files.newFile')}…`, action: () => void this.createIn(entry.path, 'file') },
                { label: `${tr('files.newFolder')}…`, action: () => void this.createIn(entry.path, 'dir') },
                { separator: true }
              ]
            : []),
          { label: `${tr('files.rename')}…`, action: () => void this.rename(entry, row, name) },
          { label: tr('files.delete'), action: () => void this.remove(entry) },
          { separator: true },
          { label: tr('files.reveal'), action: () => void window.mdstudio.reveal(entry.path) },
          {
            label: tr('files.copyPath'),
            action: () => {
              const root = this.root ?? '';
              const relative = entry.path.startsWith(root) ? entry.path.slice(root.length).replace(/^[\\/]/, '') : entry.path;
              void navigator.clipboard.writeText(relative);
              toast(tr('files.copiedPath'));
            }
          }
        ]
      });
    });

    row.addEventListener('dragstart', (event) => {
      this.dragging = entry.path;
      event.dataTransfer?.setData('text/plain', entry.path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      this.dragging = null;
    });
    if (entry.kind === 'dir') {
      row.addEventListener('dragover', (event) => {
        if (!this.dragging || this.dragging === entry.path) return;
        event.preventDefault();
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove('drop-target');
        const from = this.dragging;
        this.dragging = null;
        if (!from || from === entry.path) return;
        void this.move(from, entry.path);
      });
    }

    return row;
  }

  private async move(from: string, toDir: string): Promise<void> {
    try {
      await window.mdstudio.moveEntry({ from, toDir });
      toast(tr('files.moved', { name: baseName(toDir) }));
      this.refreshDir(dirName(from));
      this.refreshDir(toDir);
    } catch (error) {
      toast(tr('files.moveFailed', { message: (error as Error).message }), 'error');
    }
  }

  private async createIn(parent: string, kind: 'file' | 'dir'): Promise<void> {
    const name = await promptDialog({
      title: kind === 'file' ? tr('files.newFileTitle') : tr('files.newFolderTitle'),
      label: kind === 'file' ? tr('files.fileNameLabel') : tr('files.folderNameLabel'),
      placeholder: kind === 'file' ? tr('files.fileNamePlaceholder') : tr('files.folderNamePlaceholder'),
      validate: (value) => (/[\\/]/.test(value) ? tr('files.invalidChars') : null)
    });
    if (!name) return;
    try {
      const { path } = await window.mdstudio.createEntry({ parent, name, kind });
      this.refreshDir(parent);
      if (kind === 'file') this.options.onOpenFile(path);
    } catch (error) {
      toast(tr('files.createFailed', { message: (error as Error).message }), 'error');
    }
  }

  private async rename(entry: DirEntry, row: HTMLElement, name: HTMLElement): Promise<void> {
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = entry.name;
    name.replaceWith(input);
    input.focus();
    input.select();
    const finish = (commit: boolean): void => {
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      if (!commit || input.value.trim() === entry.name || !input.value.trim()) {
        input.replaceWith(name);
        return;
      }
      void (async () => {
        try {
          await window.mdstudio.renameEntry({ path: entry.path, name: input.value.trim() });
          this.refreshDir(dirName(entry.path));
        } catch (error) {
          toast(tr('files.renameFailed', { message: (error as Error).message }), 'error');
          input.replaceWith(name);
        }
      })();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
      if (event.key === 'Escape') finish(false);
      event.stopPropagation();
    };
    const onBlur = (): void => finish(false);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
    void row;
  }

  private async remove(entry: DirEntry): Promise<void> {
    const choice = await confirmDialog({
      title: tr('dialog.delete.title'),
      message: `${tr('files.deleteMessage', { name: entry.name })}${
        entry.kind === 'dir' ? `\n${tr('files.deleteFolderMessage', { name: entry.name })}` : ''
      }`,
      buttons: [
        { label: tr('dialog.cancel'), value: 'cancel' },
        { label: tr('files.delete'), value: 'delete', kind: 'danger' }
      ]
    });
    if (choice !== 'delete') return;
    try {
      await window.mdstudio.deleteEntry(entry.path);
      this.refreshDir(dirName(entry.path));
      toast(tr('files.deleted', { name: entry.name }));
    } catch (error) {
      toast(tr('files.deleteFailed', { message: (error as Error).message }), 'error');
    }
  }

  /** 重新加载某个目录（缓存失效 + 重新渲染）。 */
  refreshDir(dir: string): void {
    this.cache.delete(dir);
    const host = this.containers.get(dir);
    if (host) void this.renderDirInto(dir, host);
    this.dirtyDirs.add(dir);
  }

  /** 便捷方法：刷新根目录。 */
  refreshRoot(): void {
    if (this.root) this.refreshDir(this.root);
  }

  /** 重画整棵树（语言切换后重建静态文案）。 */
  render(): void {
    void this.renderAll();
  }

  /** 工具栏入口：新建文件/文件夹（弹输入框）。 */
  async createEntryInteractive(parent: string, kind: 'file' | 'dir'): Promise<void> {
    await this.createIn(parent, kind);
  }
}

export function joinChild(dir: string, name: string): string {
  return joinPath(dir, name);
}
