/**
 * 历史版本对话框（REQ-030）：列出快照 → 选择查看行级 diff → 恢复为当前文档。
 * 恢复前主进程会再存一份快照（保存流程自动触发），因此恢复本身也可回退。
 */

import type { HistoryEntry } from '../../shared/channels';
import { diffLines, diffSummary } from '../../shared/diff';
import { locale, tr } from '../i18n';
import { confirmDialog, toast } from './dialogs';

export interface HistoryDialogOptions {
  path: string;
  entries: HistoryEntry[];
  current: string;
  onRestore(content: string): Promise<void> | void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(locale(), { hour12: false });
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function showHistoryDialog(options: HistoryDialogOptions): Promise<void> {
  return new Promise((resolve) => {
    const layer = document.getElementById('dialog-layer');
    if (!layer) {
      resolve();
      return;
    }
    layer.hidden = false;
    layer.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'dialog dialog-history';
    box.innerHTML = `
      <h2></h2>
      <div class="history-layout">
        <div class="history-list" role="listbox"></div>
        <div class="history-detail">
          <div class="history-meta"></div>
          <pre class="history-diff" tabindex="0"></pre>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="history-close"></button>
        <button type="button" class="primary history-restore" disabled></button>
      </div>
    `;
    box.querySelector('h2')!.textContent = tr('dialog.history.title');
    box.querySelector<HTMLButtonElement>('.history-close')!.textContent = tr('dialog.close');
    box.querySelector<HTMLButtonElement>('.history-restore')!.textContent = tr('dialog.history.restore');
    layer.append(box);

    const list = box.querySelector<HTMLDivElement>('.history-list')!;
    const meta = box.querySelector<HTMLDivElement>('.history-meta')!;
    const diffHost = box.querySelector<HTMLPreElement>('.history-diff')!;
    const restore = box.querySelector<HTMLButtonElement>('.history-restore')!;
    const close = box.querySelector<HTMLButtonElement>('.history-close')!;

    let selected: HistoryEntry | null = null;
    let selectedContent: string | null = null;

    const finish = (): void => {
      layer.hidden = true;
      layer.innerHTML = '';
      resolve();
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        document.removeEventListener('keydown', onKey, true);
        finish();
      }
    };
    document.addEventListener('keydown', onKey, true);
    close.addEventListener('click', () => {
      document.removeEventListener('keydown', onKey, true);
      finish();
    });
    layer.addEventListener('mousedown', (event) => {
      if (event.target === layer) {
        document.removeEventListener('keydown', onKey, true);
        finish();
      }
    });

    const renderDiff = (content: string, entry: HistoryEntry): void => {
      const lines = diffLines(content, options.current);
      const summary = diffSummary(lines);
      meta.textContent = tr('dialog.history.meta', {
        time: formatTime(entry.savedAt),
        size: formatSize(entry.size),
        added: summary.added,
        removed: summary.removed
      });
      diffHost.innerHTML = '';
      const fragment = document.createDocumentFragment();
      // 只展示变更行及其上下 2 行上下文，其余折叠为省略标记
      const context = 2;
      const keep = new Set<number>();
      lines.forEach((line, index) => {
        if (line.kind === 'same') return;
        for (let cursor = index - context; cursor <= index + context; cursor++) {
          if (cursor >= 0 && cursor < lines.length) keep.add(cursor);
        }
      });
      let skipped = 0;
      lines.forEach((line, index) => {
        if (!keep.has(index)) {
          skipped += 1;
          return;
        }
        if (skipped > 0) {
          const ellipsis = document.createElement('div');
          ellipsis.className = 'diff-line diff-skip';
          ellipsis.textContent = tr('dialog.history.skipped', { count: skipped });
          fragment.append(ellipsis);
          skipped = 0;
        }
        const row = document.createElement('div');
        row.className = `diff-line diff-${line.kind}`;
        const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
        const number = line.fromLine ?? line.toLine ?? '';
        row.textContent = `${sign} ${String(number).padStart(4, ' ')} │ ${line.text}`;
        fragment.append(row);
      });
    };

    const select = async (entry: HistoryEntry, button: HTMLButtonElement): Promise<void> => {
      for (const item of list.querySelectorAll('button')) item.classList.remove('active');
      button.classList.add('active');
      selected = entry;
      const { content } = await window.mdstudio.readHistory({ path: options.path, id: entry.id });
      if (content === null) {
        toast(tr('dialog.history.missing'), 'error');
        restore.disabled = true;
        return;
      }
      selectedContent = content;
      restore.disabled = false;
      renderDiff(content, entry);
    };

    void (async () => {
      for (const entry of options.entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item';
        button.innerHTML = `<span class="history-time"></span><span class="history-size"></span>`;
        button.querySelector('.history-time')!.textContent = formatTime(entry.savedAt);
        button.querySelector('.history-size')!.textContent = formatSize(entry.size);
        button.addEventListener('click', () => void select(entry, button));
        list.append(button);
      }
      const first = options.entries[0];
      if (first) {
        const firstButton = list.querySelector<HTMLButtonElement>('button');
        if (firstButton) await select(first, firstButton);
      }
    })();

    restore.addEventListener('click', () => {
      if (!selectedContent || !selected) return;
      void (async () => {
        const choice = await confirmDialog({
          title: tr('dialog.history.title'),
          message: tr('dialog.history.confirm'),
          buttons: [
            { label: tr('dialog.cancel'), value: 'cancel' },
            { label: tr('dialog.history.restoreSave'), value: 'restore', kind: 'primary' }
          ]
        });
        if (choice !== 'restore') {
          // 确认框会覆盖当前图层，重开后需重新挂载历史对话框
          finish();
          return;
        }
        finish();
        await options.onRestore(selectedContent!);
      })();
    });
  });
}
