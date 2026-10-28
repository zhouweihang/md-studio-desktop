/** 应用内对话框组件（Electron 无 window.prompt，统一走这里）。 */

import { tr } from '../i18n';

export interface DialogButton {
  label: string;
  value: string;
  kind?: 'primary' | 'default' | 'danger';
}

function layer(): HTMLElement {
  const node = document.getElementById('dialog-layer');
  if (!node) throw new Error('缺少 #dialog-layer');
  return node;
}

function closeLayer(): void {
  const node = layer();
  node.hidden = true;
  node.innerHTML = '';
}

export function isDialogOpen(): boolean {
  return !layer().hidden;
}

export interface PromptOptions {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
}

/** 文本输入对话框；取消返回 null。 */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const node = layer();
    node.hidden = false;
    node.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'dialog';
    box.innerHTML = `
      <h2></h2>
      <div class="dialog-body"></div>
      <input class="dialog-input" type="text" />
      <div class="dialog-actions"></div>
    `;
    box.querySelector('h2')!.textContent = options.title;
    const body = box.querySelector<HTMLDivElement>('.dialog-body')!;
    if (options.label) body.textContent = options.label;
    else body.remove();

    const input = box.querySelector<HTMLInputElement>('.dialog-input')!;
    input.value = options.value ?? '';
    input.placeholder = options.placeholder ?? '';

    const actions = box.querySelector<HTMLDivElement>('.dialog-actions')!;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = tr('dialog.cancel');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary';
    confirm.textContent = options.confirmLabel ?? tr('dialog.confirm');
    actions.append(cancel, confirm);

    const error = document.createElement('div');
    error.className = 'dialog-body';
    error.style.color = 'var(--md-color-danger)';
    error.hidden = true;
    actions.before(error);

    const finish = (value: string | null): void => {
      closeLayer();
      resolve(value);
    };

    const submit = (): void => {
      const value = input.value.trim();
      const problem = options.validate?.(value) ?? (value.length === 0 ? tr('dialog.required') : null);
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        input.focus();
        return;
      }
      finish(value);
    };

    cancel.addEventListener('click', () => finish(null));
    confirm.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
      if (event.key === 'Escape') finish(null);
    });
    node.addEventListener('mousedown', (event) => {
      if (event.target === node) finish(null);
    });

    node.append(box);
    input.focus();
    input.select();
  });
}

export interface ConfirmOptions {
  title: string;
  message: string;
  buttons?: DialogButton[];
  /** 补充说明（等宽字体展示，适合放命令或路径） */
  detail?: string;
}

/** 确认对话框，返回被点击按钮的 value；点遮罩/Esc 返回最后一个按钮值（视作取消）。 */
export function confirmDialog(options: ConfirmOptions): Promise<string> {
  const buttons: DialogButton[] =
    options.buttons && options.buttons.length > 0
      ? options.buttons
      : [
          { label: tr('dialog.cancel'), value: 'cancel' },
          { label: tr('dialog.confirm'), value: 'ok', kind: 'primary' }
        ];
  return new Promise((resolve) => {
    const node = layer();
    node.hidden = false;
    node.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = options.title;
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.textContent = options.message;
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    const finish = (value: string): void => {
      closeLayer();
      resolve(value);
    };

    const detail = options.detail ? document.createElement('pre') : null;
    if (detail) {
      detail.className = 'dialog-detail';
      detail.textContent = options.detail ?? '';
    }

    for (const button of buttons) {
      const element = document.createElement('button');
      element.type = 'button';
      if (button.kind === 'primary') element.className = 'primary';
      element.textContent = button.label;
      element.addEventListener('click', () => finish(button.value));
      actions.append(element);
    }

    box.append(heading, body);
    if (detail) box.append(detail);
    box.append(actions);
    node.append(box);
    node.addEventListener('mousedown', (event) => {
      if (event.target === node) finish(buttons[buttons.length - 1]?.value ?? 'cancel');
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onKey, true);
        finish(buttons[buttons.length - 1]?.value ?? 'cancel');
      }
    };
    document.addEventListener('keydown', onKey, true);
    actions.querySelector<HTMLButtonElement>('button.primary')?.focus();
  });
}

export interface ContextMenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

/** 右键菜单；点击空白处或滚动时关闭。 */
export function contextMenu(options: { x: number; y: number; items: ContextMenuItem[] }): void {
  const node = document.getElementById('menu-layer');
  if (!node) return;
  node.hidden = false;
  node.innerHTML = '';
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const close = (): void => {
    node.hidden = true;
    node.innerHTML = '';
    node.removeEventListener('mousedown', onDown);
    document.removeEventListener('keydown', onKey, true);
  };
  const onDown = (event: MouseEvent): void => {
    if (event.target === node) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };

  for (const item of options.items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'sep';
      menu.append(sep);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label ?? '';
    button.disabled = item.disabled ?? false;
    button.addEventListener('click', () => {
      const action = item.action;
      close();
      action?.();
    });
    menu.append(button);
  }

  node.append(menu);
  const rect = menu.getBoundingClientRect();
  const x = Math.min(options.x, window.innerWidth - rect.width - 8);
  const y = Math.min(options.y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;
  node.addEventListener('mousedown', onDown);
  document.addEventListener('keydown', onKey, true);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** 轻提示（右下角上方居中）。 */
export function toast(message: string, kind: 'info' | 'warn' | 'error' = 'info', timeout = 2600): void {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  node.style.borderColor = kind === 'error' ? 'var(--md-color-danger)' : '';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
    toastTimer = null;
  }, timeout);
}
