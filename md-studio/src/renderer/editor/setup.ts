import { closeBrackets, closeBracketsKeymap, autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder,
  type KeyBinding
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { emojiEntries, searchEmoji } from '../../shared/emoji';
import { toCodeMirrorKey } from '../../shared/keymap';
import type { Settings } from '../../shared/settings';
import { isMarkdownPath } from '../../shared/paths';
import { CODE_LANGUAGES } from './languages';
import { blockWidgetsExtension, createLivePreview, type PreviewContext } from './live-preview';
import { focusModeExtension, setTypewriterClass, typewriterExtension } from './modes';
import { searchExtensions } from './search';
import { insertImage, insertText } from './commands';
import { tr } from '../i18n';
import { toast } from '../shell/dialogs';

export interface EditorCallbacks {
  onDocChanged(): void;
  onSelectionChanged(): void;
  getDocDir(): string | null;
  openExternal(url: string): void;
  openPath(path: string): void;
  runCommand(id: string): boolean;
  notify(message: string, kind?: 'info' | 'warn' | 'error'): void;
}

export interface EditorHandle {
  view: EditorView;
  setDoc(content: string, anchor?: number): void;
  getDoc(): string;
  focus(): void;
  applySettings(settings: Settings, bindings: Record<string, string[]>): void;
  /** 新建标签用的独立 `EditorState`（REQ-032）：扩展集合与当前设置一致。 */
  createState(content: string, anchor?: number): EditorState;
}

const ASSET_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** `:` 触发 Emoji 短代码补全（REQ-019）。 */
function emojiSource(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/:[a-zA-Z0-9_+-]*/);
  if (!before) return null;
  if (before.from === before.to && !context.explicit) return null;
  const query = before.text.slice(1);
  const matches = searchEmoji(query, 30);
  if (matches.length === 0) return null;
  return {
    from: before.from,
    options: matches.map((match) => ({
      label: `:${match.name}:`,
      detail: match.char,
      info: match.canonical === match.name ? undefined : `规范名：:${match.canonical}:`,
      apply: match.char,
      type: 'text'
    })),
    validFor: /^:[a-zA-Z0-9_+-]*$/
  };
}

/** Emoji 补全源（供测试与外部复用）。 */
export function emojiCompletionSource(context: CompletionContext): CompletionResult | null {
  return emojiSource(context);
}

/** 短代码总数（设置页/诊断用）。 */
export function emojiShortcodeCount(): number {
  return emojiEntries().length;
}

const previewCompartment = new Compartment();
const focusCompartment = new Compartment();
const typewriterCompartment = new Compartment();
const keymapCompartment = new Compartment();

const codeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--md-color-accent)' },
  { tag: [tags.atom, tags.bool, tags.number, tags.null], color: 'var(--md-color-accent)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--md-color-success)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--md-color-muted)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--md-color-ink)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--md-color-ink-secondary)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--md-color-ink-secondary)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--md-color-muted)' },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: 'var(--md-color-muted)' },
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--md-color-accent)' },
  { tag: tags.monospace, fontFamily: 'var(--md-font-mono)' },
  { tag: tags.invalid, color: 'var(--md-color-danger)' }
]);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取剪贴板图片失败'));
    reader.readAsDataURL(file);
  });
}

type ConcreteKeyBinding = KeyBinding & { key: string };

function buildKeyBinding(command: string, key: string, callbacks: EditorCallbacks): ConcreteKeyBinding | null {
  const cmKey = toCodeMirrorKey(key);
  if (!cmKey) return null;
  return {
    key: cmKey,
    run: () => callbacks.runCommand(command),
    preventDefault: true
  };
}

export function createEditor(parent: HTMLElement, initialDoc: string, callbacks: EditorCallbacks): EditorHandle {
  const previewContext: PreviewContext = {
    getDocDir: () => callbacks.getDocDir(),
    openExternal: (url) => callbacks.openExternal(url),
    notify: (message, kind) => callbacks.notify(message, kind)
  };

  /** 预览扩展：ViewPlugin（视口内装饰）+ StateField（跨行块 widget，CM6 限制要求）。 */
  const previewExtensions = (): Extension[] => [
    ...createLivePreview(previewContext),
    blockWidgetsExtension(previewContext)
  ];

  const imagePaste: Extension = EditorView.domEventHandlers({
    paste: (event, view) => {
      const items = event.clipboardData?.items;
      if (!items) return false;
      const imageItem = [...items].find((item) => item.type.startsWith('image/'));
      if (!imageItem) return false;
      const file = imageItem.getAsFile();
      if (!file) return false;
      event.preventDefault();
      const docDir = callbacks.getDocDir();
      if (!docDir) {
        toast(tr('editor.imageNeedsSave'), 'warn');
        return true;
      }
      void (async () => {
        try {
          const dataBase64 = await fileToBase64(file);
          const name = file.name && /\./.test(file.name) ? file.name : `pasted-${Date.now()}.png`;
          const result = await window.mdstudio.saveAsset({ docDir, name, dataBase64 });
          if (!result.ok) {
            toast(tr('editor.imageFailed', { message: result.error }), 'error');
            return;
          }
          insertImage(view, result.relativePath, altFromName(name));
        } catch (error) {
          toast(tr('editor.imageFailed', { message: (error as Error).message }), 'error');
        }
      })();
      return true;
    },
    drop: (event, view) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return false;
      const path = window.mdstudio.getPathForFile(file);
      if (!path) return false;
      event.preventDefault();
      if (isMarkdownPath(path)) {
        callbacks.openPath(path);
        return true;
      }
      const extension = path.split('.').pop()?.toLowerCase() ?? '';
      if (!ASSET_EXTENSIONS.has(extension)) {
        toast(tr('editor.unsupportedDrop', { ext: extension || tr('widget.imageNoPath') }), 'warn');
        return true;
      }
      const docDir = callbacks.getDocDir();
      if (!docDir) {
        toast(tr('editor.imageNeedsSave'), 'warn');
        return true;
      }
      void (async () => {
        const result = await window.mdstudio.copyAsset({ docDir, sourcePath: path });
        if (!result.ok) {
          toast(tr('editor.imageFailed', { message: result.error }), 'error');
          return;
        }
        insertImage(view, result.relativePath, altFromName(path));
      })();
      return true;
    }
  });

  /** 基础扩展集合（初始状态与各标签状态共用；compartment 配置跟随最近一次设置）。 */
  let appliedSettings: Settings | null = null;
  const extensions = (): Extension[] => [
      history(),
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      syntaxHighlighting(codeHighlight),
      markdown({ base: markdownLanguage, codeLanguages: CODE_LANGUAGES }),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, icons: false, override: [emojiSource] }),
      searchExtensions(),
      previewCompartment.of(appliedSettings?.view.sourceMode ? [] : previewExtensions()),
      focusCompartment.of(appliedSettings?.view.focusMode ? focusModeExtension() : []),
      typewriterCompartment.of(appliedSettings?.view.typewriterMode ? typewriterExtension() : []),
      placeholder(tr('editor.placeholder')),
      keymapCompartment.of(
        keymap.of([
          { key: 'Tab', run: indentWithTab.run ?? (() => false) },
          ...closeBracketsKeymap,
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap
        ])
      ),
      imagePaste,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.onDocChanged();
        if (update.docChanged || update.selectionSet) callbacks.onSelectionChanged();
      })
  ];

  const state = EditorState.create({ doc: initialDoc, extensions: extensions() });
  const view = new EditorView({ parent, state });

  return {
    view,
    setDoc(content: string, anchor = 0): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: Math.min(anchor, content.length) },
        scrollIntoView: true
      });
    },
    getDoc(): string {
      return view.state.doc.toString();
    },
    focus(): void {
      view.focus();
    },
    createState(content: string, anchor = 0): EditorState {
      return EditorState.create({
        doc: content,
        selection: { anchor: Math.min(anchor, content.length) },
        extensions: extensions()
      });
    },
    applySettings(settings: Settings, bindings: Record<string, string[]>): void {
      appliedSettings = settings;
      const bindingList: ConcreteKeyBinding[] = [];
      const seenKeys = new Set<string>();
      for (const [command, keys] of Object.entries(bindings)) {
        for (const key of keys) {
          const binding = buildKeyBinding(command, key, callbacks);
          if (!binding || seenKeys.has(binding.key)) continue;
          seenKeys.add(binding.key);
          bindingList.push(binding);
        }
      }
      view.dispatch({
        effects: [
          keymapCompartment.reconfigure(
            keymap.of([
              ...bindingList,
              { key: 'Tab', run: indentWithTab.run ?? (() => false) },
              ...closeBracketsKeymap,
              ...markdownKeymap,
              ...defaultKeymap,
              ...historyKeymap
            ])
          ),
          previewCompartment.reconfigure(settings.view.sourceMode ? [] : previewExtensions()),
          focusCompartment.reconfigure(settings.view.focusMode ? focusModeExtension() : []),
          typewriterCompartment.reconfigure(settings.view.typewriterMode ? typewriterExtension() : [])
        ]
      });
      setTypewriterClass(view, settings.view.typewriterMode);
    }
  };
}

function altFromName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[a-z0-9]+$/i, '');
}

export { insertText };
