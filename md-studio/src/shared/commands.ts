/**
 * 全量命令表（REQ-015）：菜单、快捷键、面板共用同一批命令 id。
 * - `scope: 'editor'` 的命令需要编辑器焦点，由渲染层命令注册表实现；
 * - `scope: 'global'` 的命令在任何焦点下都可用；
 * - `menu: false` 的命令不直接出现在菜单里（由动态子菜单或面板调用）。
 */

export type CommandScope = 'global' | 'editor';

export type CommandCategory = 'file' | 'edit' | 'paragraph' | 'table' | 'format' | 'view' | 'theme' | 'app';

export interface CommandDef {
  id: string;
  label: string;
  category: CommandCategory;
  scope: CommandScope;
  /** 是否直接出现在菜单中（默认 true；false 用于动态子菜单/内部命令） */
  menu?: boolean;
}

export const COMMANDS: readonly CommandDef[] = [
  // ---- 文件 ----
  { id: 'file.new', label: '新建', category: 'file', scope: 'global' },
  { id: 'file.open', label: '打开…', category: 'file', scope: 'global' },
  { id: 'file.openFolder', label: '打开文件夹…', category: 'file', scope: 'global' },
  { id: 'file.openRecent', label: '最近文件', category: 'file', scope: 'global', menu: false },
  { id: 'file.reloadFromDisk', label: '重新载入', category: 'file', scope: 'global', menu: false },
  { id: 'file.save', label: '保存', category: 'file', scope: 'global' },
  { id: 'file.saveAs', label: '另存为…', category: 'file', scope: 'global' },
  { id: 'file.newTab', label: '新建标签页', category: 'file', scope: 'global' },
  { id: 'file.exportHtml', label: '导出 HTML…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportPdf', label: '导出 PDF…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportText', label: '导出纯文本…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportImage', label: '导出图片…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportDocx', label: 'Word (.docx)…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportLatex', label: 'LaTeX (.tex)…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportEpub', label: 'EPUB (.epub)…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportRtf', label: 'RTF (.rtf)…', category: 'file', scope: 'global', menu: false },
  { id: 'file.exportOdt', label: 'OpenDocument (.odt)…', category: 'file', scope: 'global', menu: false },
  { id: 'file.importPandoc', label: '导入 Word / HTML…', category: 'file', scope: 'global' },
  { id: 'file.print', label: '打印…', category: 'file', scope: 'global' },
  { id: 'file.rename', label: '重命名…', category: 'file', scope: 'global' },
  { id: 'file.delete', label: '删除文件…', category: 'file', scope: 'global', menu: false },
  { id: 'file.reveal', label: '在资源管理器中显示', category: 'file', scope: 'global', menu: false },
  { id: 'file.history', label: '历史版本…', category: 'file', scope: 'global' },
  { id: 'file.close', label: '关闭', category: 'file', scope: 'global' },
  { id: 'tab.next', label: '下一个标签页', category: 'file', scope: 'global', menu: false },
  { id: 'tab.prev', label: '上一个标签页', category: 'file', scope: 'global', menu: false },

  // ---- 编辑 ----
  { id: 'edit.find', label: '查找…', category: 'edit', scope: 'editor' },
  { id: 'edit.replace', label: '替换…', category: 'edit', scope: 'editor' },
  { id: 'edit.findNext', label: '查找下一个', category: 'edit', scope: 'editor' },
  { id: 'edit.findPrev', label: '查找上一个', category: 'edit', scope: 'editor' },
  { id: 'edit.copyHtml', label: '复制为 HTML', category: 'edit', scope: 'global', menu: false },
  { id: 'edit.copyMarkdown', label: '复制为 Markdown', category: 'edit', scope: 'global', menu: false },
  { id: 'edit.copyPlainText', label: '复制为纯文本', category: 'edit', scope: 'global', menu: false },
  { id: 'edit.pasteMarkdown', label: '粘贴为 Markdown', category: 'edit', scope: 'editor', menu: false },
  { id: 'edit.pastePlainText', label: '粘贴为纯文本', category: 'edit', scope: 'editor', menu: false },

  // ---- 段落 ----
  { id: 'paragraph.h1', label: '一级标题', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.h2', label: '二级标题', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.h3', label: '三级标题', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.h4', label: '四级标题', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.h5', label: '五级标题', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.h6', label: '六级标题', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.paragraph', label: '正文', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.increaseHeading', label: '提升标题级别', category: 'paragraph', scope: 'editor', menu: false },
  { id: 'paragraph.decreaseHeading', label: '降低标题级别', category: 'paragraph', scope: 'editor', menu: false },
  { id: 'paragraph.quote', label: '引用', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.bulletList', label: '无序列表', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.orderedList', label: '有序列表', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.taskList', label: '任务列表', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.codeBlock', label: '代码块', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.math', label: '公式块', category: 'paragraph', scope: 'editor', menu: false },
  { id: 'paragraph.mermaid', label: '图表', category: 'paragraph', scope: 'editor', menu: false },
  { id: 'paragraph.table', label: '表格', category: 'paragraph', scope: 'editor' },
  { id: 'paragraph.hr', label: '分隔线', category: 'paragraph', scope: 'editor', menu: false },
  { id: 'paragraph.toc', label: '插入目录', category: 'paragraph', scope: 'editor' },
  { id: 'table.addRow', label: '在下方插入行', category: 'table', scope: 'editor', menu: false },
  { id: 'table.addColumn', label: '在右侧插入列', category: 'table', scope: 'editor', menu: false },
  { id: 'table.deleteRow', label: '删除本行', category: 'table', scope: 'editor', menu: false },
  { id: 'table.deleteColumn', label: '删除本列', category: 'table', scope: 'editor', menu: false },
  { id: 'table.alignLeft', label: '左对齐', category: 'table', scope: 'editor', menu: false },
  { id: 'table.alignCenter', label: '居中', category: 'table', scope: 'editor', menu: false },
  { id: 'table.alignRight', label: '右对齐', category: 'table', scope: 'editor', menu: false },
  { id: 'table.alignNone', label: '取消对齐', category: 'table', scope: 'editor', menu: false },

  // ---- 格式 ----
  { id: 'format.bold', label: '加粗', category: 'format', scope: 'editor' },
  { id: 'format.italic', label: '斜体', category: 'format', scope: 'editor' },
  { id: 'format.strikethrough', label: '删除线', category: 'format', scope: 'editor' },
  { id: 'format.inlineCode', label: '行内代码', category: 'format', scope: 'editor' },
  { id: 'format.highlight', label: '高亮', category: 'format', scope: 'editor' },
  { id: 'format.footnote', label: '脚注', category: 'format', scope: 'editor' },
  { id: 'format.link', label: '链接…', category: 'format', scope: 'editor' },
  { id: 'format.image', label: '图片…', category: 'format', scope: 'editor' },
  { id: 'format.clear', label: '清除格式', category: 'format', scope: 'editor' },

  // ---- 视图 ----
  { id: 'view.source', label: '源码模式', category: 'view', scope: 'editor' },
  { id: 'view.focus', label: '聚焦模式', category: 'view', scope: 'editor' },
  { id: 'view.typewriter', label: '打字机模式', category: 'view', scope: 'editor' },
  { id: 'view.sidebar', label: '显示侧栏', category: 'view', scope: 'global' },
  { id: 'view.files', label: '文件列表', category: 'view', scope: 'global' },
  { id: 'view.outline', label: '大纲', category: 'view', scope: 'global' },
  { id: 'view.search', label: '文件搜索', category: 'view', scope: 'global' },
  { id: 'view.zoomIn', label: '放大', category: 'view', scope: 'global' },
  { id: 'view.zoomOut', label: '缩小', category: 'view', scope: 'global' },
  { id: 'view.zoomReset', label: '实际大小', category: 'view', scope: 'global' },
  { id: 'view.fullscreen', label: '全屏', category: 'view', scope: 'global' },
  { id: 'view.alwaysOnTop', label: '窗口置顶', category: 'view', scope: 'global' },
  { id: 'view.spellcheck', label: '拼写检查', category: 'view', scope: 'global' },
  { id: 'view.reload', label: '重新加载', category: 'view', scope: 'global', menu: false },
  { id: 'view.devTools', label: '开发者工具', category: 'view', scope: 'global', menu: false },

  // ---- 主题 ----
  { id: 'theme.toggle', label: '切换明亮 / 暗色', category: 'theme', scope: 'global' },
  { id: 'theme.light', label: '明亮', category: 'theme', scope: 'global', menu: false },
  { id: 'theme.dark', label: '暗色', category: 'theme', scope: 'global', menu: false },
  { id: 'theme.apply', label: '应用用户主题', category: 'theme', scope: 'global', menu: false },

  // ---- 应用 ----
  { id: 'app.settings', label: '偏好设置…', category: 'app', scope: 'global' },
  { id: 'app.newWindow', label: '新建窗口', category: 'app', scope: 'global', menu: false },
  { id: 'app.languageZh', label: '简体中文', category: 'app', scope: 'global', menu: false },
  { id: 'app.languageEn', label: 'English', category: 'app', scope: 'global', menu: false },
  { id: 'app.about', label: '关于 MD-Studio', category: 'app', scope: 'global', menu: false }
];

const BY_ID = new Map(COMMANDS.map((command) => [command.id, command]));

export function getCommand(id: string): CommandDef | undefined {
  return BY_ID.get(id);
}

export function commandLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}
