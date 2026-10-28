/**
 * 偏好设置对话框（REQ-025/031/033 的设置入口）：视图、语言、拼写检查、自动保存、Pandoc 路径。
 * 只做「收集 → patch」，实际落盘与副作用由主进程负责（settings:update）。
 */

import type { ThemeMeta } from '../../shared/theme-meta';
import type { Settings, SettingsPatch } from '../../shared/settings';
import { AUTOSAVE_DELAY_MAX, AUTOSAVE_DELAY_MIN, ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '../../shared/settings';
import { zoomPercent } from '../../shared/view-controls';
import { tr } from '../i18n';

export interface SettingsDialogOptions {
  settings: Settings;
  themes: ThemeMeta[];
  onApply(patch: SettingsPatch): Promise<void>;
}

export function showSettingsDialog(options: SettingsDialogOptions): Promise<void> {
  return new Promise((resolve) => {
    const layer = document.getElementById('dialog-layer');
    if (!layer) {
      resolve();
      return;
    }
    layer.hidden = false;
    layer.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'dialog dialog-settings';
    box.innerHTML = `
      <h2></h2>
      <div class="settings-grid"></div>
      <div class="dialog-actions">
        <button type="button" class="settings-cancel"></button>
        <button type="button" class="primary settings-save"></button>
      </div>
    `;
    box.querySelector('h2')!.textContent = tr('dialog.settings.title');
    box.querySelector<HTMLButtonElement>('.settings-cancel')!.textContent = tr('dialog.close');
    box.querySelector<HTMLButtonElement>('.settings-save')!.textContent = tr('dialog.save');
    layer.append(box);

    const grid = box.querySelector<HTMLDivElement>('.settings-grid')!;
    const settings = options.settings;

    const addRow = (label: string, control: HTMLElement): void => {
      const text = document.createElement('label');
      text.textContent = label;
      grid.append(text, control);
    };

    const addHint = (text: string): void => {
      const hint = document.createElement('div');
      hint.className = 'settings-hint';
      grid.append(document.createElement('span'), hint);
      hint.textContent = text;
    };

    // 界面语言
    const language = document.createElement('select');
    language.innerHTML = `<option value="zh-CN">简体中文</option><option value="en">English</option>`;
    language.value = settings.language;
    addRow(tr('settings.language'), language);

    // 主题
    const theme = document.createElement('select');
    const lightOption = new Option(tr('settings.theme.lightBuiltin'), 'light');
    const darkOption = new Option(tr('settings.theme.darkBuiltin'), 'dark');
    theme.append(lightOption, darkOption);
    for (const item of options.themes) {
      const option = document.createElement('option');
      option.value = `user:${item.fileName}`;
      option.textContent = `${tr('settings.theme.userPrefix', { name: item.name })}${item.issues.length > 0 ? ' ⚠' : ''}`;
      theme.append(option);
    }
    theme.value = settings.theme.userTheme ? `user:${settings.theme.userTheme}` : settings.theme.mode;
    addRow(tr('settings.theme'), theme);

    // 缩放
    const zoom = document.createElement('input');
    zoom.type = 'number';
    zoom.min = String(ZOOM_LEVEL_MIN);
    zoom.max = String(ZOOM_LEVEL_MAX);
    zoom.step = '1';
    zoom.value = String(settings.view.zoomLevel);
    addRow(tr('settings.zoom'), zoom);
    addHint(tr('settings.zoomHint', { percent: zoomPercent(settings.view.zoomLevel) }));

    // 拼写检查
    const spellcheck = document.createElement('input');
    spellcheck.type = 'checkbox';
    spellcheck.id = 'settings-spellcheck';
    spellcheck.checked = settings.editor.spellcheck;
    addRow(tr('settings.spellcheck'), spellcheck);

    // 自动保存
    const autosave = document.createElement('input');
    autosave.type = 'checkbox';
    autosave.checked = settings.autosave.enabled;
    addRow(tr('settings.autosave'), autosave);

    const autosaveDelay = document.createElement('input');
    autosaveDelay.type = 'number';
    autosaveDelay.min = String(AUTOSAVE_DELAY_MIN / 1000);
    autosaveDelay.max = String(AUTOSAVE_DELAY_MAX / 1000);
    autosaveDelay.step = '1';
    autosaveDelay.value = String(Math.round(settings.autosave.delayMs / 1000));
    addRow(tr('settings.autosaveInterval'), autosaveDelay);

    // 导出选项（REQ-035 / B5-5）：KaTeX 字体内联范围
    const inlineMathFonts = document.createElement('select');
    inlineMathFonts.id = 'settings-inline-math-fonts';
    for (const scope of ['off', 'common', 'all'] as const) {
      const option = document.createElement('option');
      option.value = scope;
      option.textContent = tr(`settings.inlineMathFonts.${scope}`);
      inlineMathFonts.append(option);
    }
    inlineMathFonts.value = settings.exportOptions.inlineMathFonts;
    addRow(tr('settings.exportOptions'), inlineMathFonts);
    addHint(tr('settings.inlineMathFonts'));

    // Pandoc 路径
    const pandocPath = document.createElement('input');
    pandocPath.type = 'text';
    pandocPath.placeholder = tr('settings.pandoc.placeholder');
    pandocPath.value = settings.pandoc.path;
    addRow(tr('settings.pandoc'), pandocPath);
    const pandocHint = document.createElement('span');
    pandocHint.className = 'settings-hint';
    grid.append(document.createElement('span'), pandocHint);

    const refreshPandocHint = async (): Promise<void> => {
      pandocHint.textContent = tr('settings.pandoc.detecting');
      const status = await window.mdstudio.pandocStatus();
      pandocHint.textContent = status.available
        ? tr('settings.pandoc.detected', { version: status.version ?? '', path: status.path ?? '' })
        : tr('settings.pandoc.missing');
    };
    void refreshPandocHint();

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
    box.querySelector<HTMLButtonElement>('.settings-cancel')!.addEventListener('click', () => {
      document.removeEventListener('keydown', onKey, true);
      finish();
    });
    layer.addEventListener('mousedown', (event) => {
      if (event.target === layer) {
        document.removeEventListener('keydown', onKey, true);
        finish();
      }
    });

    box.querySelector<HTMLButtonElement>('.settings-save')!.addEventListener('click', () => {
      void (async () => {
        const themeValue = theme.value;
        const patch: SettingsPatch = {
          language: language.value === 'en' ? 'en' : 'zh-CN',
          editor: { spellcheck: spellcheck.checked },
          view: { zoomLevel: Number(zoom.value) },
          autosave: {
            enabled: autosave.checked,
            delayMs: Math.min(
              AUTOSAVE_DELAY_MAX,
              Math.max(AUTOSAVE_DELAY_MIN, Math.round(Number(autosaveDelay.value) * 1000))
            )
          },
          exportOptions: {
            inlineMathFonts:
              inlineMathFonts.value === 'all' || inlineMathFonts.value === 'common'
                ? inlineMathFonts.value
                : 'off'
          },
          pandoc: { path: pandocPath.value.trim() },
          theme: themeValue.startsWith('user:')
            ? { userTheme: themeValue.slice('user:'.length) }
            : { mode: themeValue === 'dark' ? 'dark' : 'light', userTheme: null }
        };
        await options.onApply(patch);
        document.removeEventListener('keydown', onKey, true);
        finish();
      })();
    });
  });
}
