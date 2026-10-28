import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { COMMANDS } from '../shared/commands';
import { commandLabel, t } from '../shared/i18n';
import { toElectronAccelerator, type ResolvedKeymap } from '../shared/keymap';
import type { Settings } from '../shared/settings';
import type { ThemeMeta } from '../shared/theme-meta';

export interface MenuDeps {
  runCommand(id: string, arg?: unknown): void;
  keymap(): ResolvedKeymap;
  settings(): Settings;
  themes(): ThemeMeta[];
}

export function buildApplicationMenu(deps: MenuDeps): void {
  const settings = deps.settings();
  const keymap = deps.keymap();
  const locale = settings.language;

  const label = (id: string): string => {
    const fallback = COMMANDS.find((command) => command.id === id)?.label ?? id;
    return commandLabel(id, fallback, locale);
  };
  const text = (key: Parameters<typeof t>[0]): string => t(key, undefined, locale);

  const accelerator = (id: string): string | undefined => {
    const first = keymap.bindings[id]?.[0];
    return first ? toElectronAccelerator(first) : undefined;
  };

  const item = (id: string, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => ({
    label: label(id),
    accelerator: accelerator(id),
    click: () => deps.runCommand(id),
    ...extra
  });

  const recent = settings.files.recent;
  const themes = deps.themes();

  const template: MenuItemConstructorOptions[] = [
    {
      label: text('menu.file'),
      submenu: [
        item('file.new'),
        item('file.open'),
        item('file.openFolder'),
        {
          label: text('menu.recent'),
          enabled: recent.length > 0,
          submenu:
            recent.length === 0
              ? [{ label: text('menu.empty'), enabled: false }]
              : recent.map((path) => ({
                  label: path,
                  click: () => deps.runCommand('file.openRecent', path)
                }))
        },
        item('file.newTab'),
        { type: 'separator' },
        item('file.save'),
        item('file.saveAs'),
        item('file.rename'),
        item('file.delete'),
        item('file.reveal'),
        { type: 'separator' },
        {
          label: text('menu.export'),
          submenu: [
            item('file.exportHtml'),
            item('file.exportPdf'),
            item('file.exportText'),
            item('file.exportImage'),
            { type: 'separator' },
            {
              label: text('menu.pandocExport'),
              submenu: [
                item('file.exportDocx'),
                item('file.exportLatex'),
                item('file.exportEpub'),
                item('file.exportRtf'),
                item('file.exportOdt')
              ]
            }
          ]
        },
        item('file.importPandoc'),
        item('file.print'),
        item('file.history'),
        { type: 'separator' },
        item('app.settings'),
        { type: 'separator' },
        item('file.close'),
        { role: 'quit', label: text('menu.quit') }
      ]
    },
    {
      label: text('menu.edit'),
      submenu: [
        { role: 'undo', label: text('menu.undo'), accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', label: text('menu.redo'), accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut', label: text('menu.cut'), accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', label: text('menu.copy'), accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', label: text('menu.paste'), accelerator: 'CmdOrCtrl+V' },
        { role: 'selectAll', label: text('menu.selectAll'), accelerator: 'CmdOrCtrl+A' },
        { type: 'separator' },
        {
          label: text('menu.copyAs'),
          submenu: [item('edit.copyHtml'), item('edit.copyMarkdown'), item('edit.copyPlainText')]
        },
        {
          label: text('menu.pasteAs'),
          submenu: [item('edit.pasteMarkdown'), item('edit.pastePlainText')]
        },
        { type: 'separator' },
        item('edit.find'),
        item('edit.replace'),
        item('edit.findNext'),
        item('edit.findPrev')
      ]
    },
    {
      label: text('menu.paragraph'),
      submenu: [
        item('paragraph.h1', { type: 'checkbox', checked: false }),
        ...(['paragraph.h2', 'paragraph.h3', 'paragraph.h4', 'paragraph.h5', 'paragraph.h6'] as const).map((id) =>
          item(id, { type: 'checkbox', checked: false })
        ),
        item('paragraph.paragraph'),
        { type: 'separator' },
        item('paragraph.increaseHeading', { accelerator: accelerator('paragraph.increaseHeading') ?? 'CmdOrCtrl+[' }),
        item('paragraph.decreaseHeading', { accelerator: accelerator('paragraph.decreaseHeading') ?? 'CmdOrCtrl+]' }),
        { type: 'separator' },
        item('paragraph.quote'),
        item('paragraph.bulletList'),
        item('paragraph.orderedList'),
        item('paragraph.taskList'),
        { type: 'separator' },
        item('paragraph.codeBlock'),
        item('paragraph.math'),
        item('paragraph.mermaid'),
        item('paragraph.table'),
        item('paragraph.hr'),
        item('paragraph.toc'),
        { type: 'separator' },
        {
          label: text('menu.tableOps'),
          submenu: [
            item('table.addRow'),
            item('table.addColumn'),
            item('table.deleteRow'),
            item('table.deleteColumn'),
            { type: 'separator' },
            item('table.alignLeft'),
            item('table.alignCenter'),
            item('table.alignRight'),
            item('table.alignNone')
          ]
        }
      ]
    },
    {
      label: text('menu.format'),
      submenu: [
        item('format.bold'),
        item('format.italic'),
        item('format.strikethrough'),
        item('format.inlineCode'),
        item('format.highlight'),
        item('format.footnote'),
        { type: 'separator' },
        item('format.link'),
        item('format.image'),
        { type: 'separator' },
        item('format.clear')
      ]
    },
    {
      label: text('menu.view'),
      submenu: [
        item('view.source', { type: 'checkbox', checked: settings.view.sourceMode }),
        item('view.focus', { type: 'checkbox', checked: settings.view.focusMode }),
        item('view.typewriter', { type: 'checkbox', checked: settings.view.typewriterMode }),
        { type: 'separator' },
        item('view.sidebar', { type: 'checkbox', checked: settings.view.sidebarVisible }),
        item('view.files', { type: 'radio', checked: settings.view.sidebarTab === 'files' }),
        item('view.outline', { type: 'radio', checked: settings.view.sidebarTab === 'outline' }),
        item('view.search', { type: 'radio', checked: settings.view.sidebarTab === 'search' }),
        { type: 'separator' },
        item('view.zoomIn'),
        item('view.zoomOut'),
        item('view.zoomReset'),
        item('view.fullscreen'),
        item('view.alwaysOnTop', { type: 'checkbox', checked: settings.window.alwaysOnTop }),
        item('view.spellcheck', { type: 'checkbox', checked: settings.editor.spellcheck }),
        { type: 'separator' },
        item('view.reload', { role: 'reload', label: label('view.reload'), accelerator: undefined }),
        item('view.devTools', { role: 'toggleDevTools', label: label('view.devTools'), accelerator: 'F12' })
      ]
    },
    {
      label: text('menu.theme'),
      submenu: [
        item('theme.light', { type: 'checkbox', checked: settings.theme.mode === 'light' && !settings.theme.userTheme }),
        item('theme.dark', { type: 'checkbox', checked: settings.theme.mode === 'dark' && !settings.theme.userTheme }),
        { type: 'separator' },
        item('theme.toggle'),
        { type: 'separator' },
        {
          label: text('menu.userThemes'),
          submenu:
            themes.length === 0
              ? [{ label: text('menu.empty'), enabled: false }]
              : themes.map((theme) => ({
                  label: `${theme.name}${theme.issues.length > 0 ? ' ⚠' : ''}`,
                  type: 'checkbox' as const,
                  checked: settings.theme.userTheme === theme.fileName,
                  click: () => deps.runCommand('theme.apply', theme.fileName)
                }))
        }
      ]
    },
    {
      label: text('menu.help'),
      submenu: [item('app.about'), { label: t('menu.version', { version: app.getVersion() }, locale), enabled: false }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
