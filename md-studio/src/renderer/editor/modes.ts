import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** 聚焦模式（REQ-007）：当前段落之外的行降透明度。 */
export function focusModeExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.build(update.view);
        }
      }

      private build(view: EditorView): DecorationSet {
        const { state } = view;
        const active = new Set<number>();
        for (const range of state.selection.ranges) {
          const start = state.doc.lineAt(range.from).number;
          const end = state.doc.lineAt(range.to).number;
          for (let number = start; number <= end; number++) active.add(number);
        }
        const decorations: Array<{ from: number; value: Decoration }> = [];
        for (const visible of view.visibleRanges) {
          let lineNumber = state.doc.lineAt(visible.from).number;
          const lastLine = state.doc.lineAt(visible.to).number;
          while (lineNumber <= lastLine) {
            if (!active.has(lineNumber)) {
              const line = state.doc.line(lineNumber);
              decorations.push({ from: line.from, value: Decoration.line({ class: 'md-dim' }) });
            }
            lineNumber += 1;
          }
        }
        return Decoration.set(
          decorations.map((item) => item.value.range(item.from)),
          true
        );
      }
    },
    { decorations: (value) => value.decorations }
  );
}

/** 打字机模式（REQ-007）：光标始终滚动到视口垂直中心。 */
export function typewriterExtension(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet || update.view.composing) return;
    const view = update.view;
    const head = update.state.selection.main.head;
    queueMicrotask(() => {
      if (view.composing) return;
      view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
    });
  });
}

/** 打字机模式的排版类（内容区上下留白，光标可停在中间）。 */
export function setTypewriterClass(view: EditorView, on: boolean): void {
  view.dom.dataset.typewriter = on ? 'on' : 'off';
}
