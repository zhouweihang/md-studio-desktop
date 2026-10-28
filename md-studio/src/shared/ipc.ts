/**
 * IPC 请求 schema（zod）：所有写请求在主进程入口 safeParse 后执行。
 * 结果类型见 ./channels。
 */
import { z } from 'zod';

export const PathRequest = z.object({ path: z.string().min(1) });
export type PathRequest = z.infer<typeof PathRequest>;

export const ReadFileRequest = PathRequest;
export const WatchFileRequest = z.object({ path: z.string().min(1).nullable() });

export const SaveFileRequest = z.object({
  path: z.string().min(1),
  content: z.string(),
  mtimeMs: z.number().optional(),
  force: z.boolean().optional()
});
export type SaveFileRequest = z.infer<typeof SaveFileRequest>;

export const SaveFileAsRequest = z.object({
  content: z.string(),
  suggestedName: z.string().optional(),
  targetPath: z.string().optional()
});
export type SaveFileAsRequest = z.infer<typeof SaveFileAsRequest>;

export const ConflictDialogRequest = z.object({
  path: z.string().min(1),
  suggestedName: z.string().optional()
});
export type ConflictDialogRequest = z.infer<typeof ConflictDialogRequest>;

export const SetRootRequest = z.object({ root: z.string().min(1).nullable() });

export const ReadDirRequest = z.object({ dir: z.string().min(1) });
export type ReadDirRequest = z.infer<typeof ReadDirRequest>;

export const CreateEntryRequest = z.object({
  parent: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['file', 'dir'])
});
export type CreateEntryRequest = z.infer<typeof CreateEntryRequest>;

export const RenameEntryRequest = z.object({
  path: z.string().min(1),
  name: z.string().min(1)
});
export type RenameEntryRequest = z.infer<typeof RenameEntryRequest>;

export const MoveEntryRequest = z.object({
  from: z.string().min(1),
  toDir: z.string().min(1)
});
export type MoveEntryRequest = z.infer<typeof MoveEntryRequest>;

export const SettingsUpdateRequest = z.object({ patch: z.unknown() });
export type SettingsUpdateRequest = z.infer<typeof SettingsUpdateRequest>;

export const KeymapUpdateRequest = z.object({
  bindings: z.record(z.string(), z.array(z.string()))
});
export type KeymapUpdateRequest = z.infer<typeof KeymapUpdateRequest>;

export const ThemeReadRequest = z.object({ fileName: z.string().min(1) });
export type ThemeReadRequest = z.infer<typeof ThemeReadRequest>;

export const DraftSaveRequest = z.object({
  id: z.string().min(1),
  path: z.string().nullable(),
  name: z.string(),
  content: z.string()
});
export type DraftSaveRequest = z.infer<typeof DraftSaveRequest>;

export const DraftIdRequest = z.object({ id: z.string().min(1) });
export const DraftDiscardRequest = z.object({ id: z.string().min(1).optional() });
export type DraftDiscardRequest = z.infer<typeof DraftDiscardRequest>;

export const AssetSaveRequest = z.object({
  docDir: z.string().min(1),
  name: z.string().min(1),
  dataBase64: z.string().min(1)
});
export type AssetSaveRequest = z.infer<typeof AssetSaveRequest>;

export const AssetCopyRequest = z.object({
  docDir: z.string().min(1),
  sourcePath: z.string().min(1)
});
export type AssetCopyRequest = z.infer<typeof AssetCopyRequest>;

export const AssetPickRequest = z.object({ docDir: z.string().min(1) });
export type AssetPickRequest = z.infer<typeof AssetPickRequest>;

export const SearchStartRequest = z.object({
  root: z.string().min(1),
  query: z.string().min(1),
  mode: z.enum(['content', 'name']),
  caseSensitive: z.boolean().optional()
});
export type SearchStartRequest = z.infer<typeof SearchStartRequest>;

export const ExportHtmlRequest = z.object({
  html: z.string(),
  suggestedName: z.string(),
  targetPath: z.string().optional()
});
export type ExportHtmlRequest = z.infer<typeof ExportHtmlRequest>;

export const ExportPdfRequest = z.object({
  html: z.string(),
  suggestedName: z.string(),
  targetPath: z.string().optional(),
  margins: z
    .object({
      top: z.number(),
      bottom: z.number(),
      left: z.number(),
      right: z.number()
    })
    .optional(),
  footer: z.boolean().optional()
});
export type ExportPdfRequest = z.infer<typeof ExportPdfRequest>;

export const ExportTextRequest = z.object({
  content: z.string(),
  suggestedName: z.string(),
  targetPath: z.string().optional()
});
export type ExportTextRequest = z.infer<typeof ExportTextRequest>;

export const ExportImageRequest = z.object({
  html: z.string(),
  suggestedName: z.string(),
  format: z.enum(['png', 'jpeg']),
  width: z.number().optional(),
  targetPath: z.string().optional()
});
export type ExportImageRequest = z.infer<typeof ExportImageRequest>;

export const ZoomRequest = z.object({ level: z.number() });
export type ZoomRequest = z.infer<typeof ZoomRequest>;

export const BooleanStateRequest = z.object({ on: z.boolean() });
export type BooleanStateRequest = z.infer<typeof BooleanStateRequest>;

export const PrintRequest = z.object({ html: z.string(), suggestedName: z.string() });
export type PrintRequest = z.infer<typeof PrintRequest>;

export const EditActionRequest = z.object({
  action: z.enum(['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo'])
});
export type EditActionRequest = z.infer<typeof EditActionRequest>;

export const ReplaceMisspellingRequest = z.object({ word: z.string().min(1) });
export type ReplaceMisspellingRequest = z.infer<typeof ReplaceMisspellingRequest>;

export const ClipboardWriteRequest = z.object({
  text: z.string(),
  html: z.string().optional()
});
export type ClipboardWriteRequest = z.infer<typeof ClipboardWriteRequest>;

export const RenameFileRequest = z.object({ path: z.string().min(1), name: z.string().min(1) });
export type RenameFileRequest = z.infer<typeof RenameFileRequest>;

export const HistoryReadRequest = z.object({ path: z.string().min(1), id: z.string().min(1) });
export type HistoryReadRequest = z.infer<typeof HistoryReadRequest>;

export const HistorySnapshotRequest = z.object({ path: z.string().min(1), content: z.string() });
export type HistorySnapshotRequest = z.infer<typeof HistorySnapshotRequest>;

export const PandocExportRequest = z.object({
  markdown: z.string(),
  docName: z.string(),
  format: z.enum(['docx', 'latex', 'epub', 'rtf', 'odt', 'html']),
  targetPath: z.string().min(1).optional(),
  docDir: z.string().nullable(),
  title: z.string().optional()
});
export type PandocExportRequest = z.infer<typeof PandocExportRequest>;

export const PandocImportRequest = z.object({ path: z.string().optional() });
export type PandocImportRequest = z.infer<typeof PandocImportRequest>;

export const SetDirtyRequest = z.object({ dirty: z.boolean() });
export const EmptyRequest = z.object({}).optional();

export const CloseConfirmRequest = z.object({ ok: z.boolean() });

export const LogRequest = z.object({
  level: z.enum(['info', 'warn', 'error']),
  message: z.string()
});
export type LogRequest = z.infer<typeof LogRequest>;

export const OpenExternalRequest = z.object({ url: z.string().min(1) });
export type OpenExternalRequest = z.infer<typeof OpenExternalRequest>;

/** 供主进程统一友好报错 */
export function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown, label: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`无效的请求载荷（${label}）`);
  }
  return parsed.data;
}
