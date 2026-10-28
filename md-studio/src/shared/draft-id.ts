/**
 * 草稿 id：按文档路径稳定生成（djb2 32 位十六进制），主进程与渲染层共用。
 */
export function draftIdFor(path: string | null): string {
  const key = path ?? 'untitled';
  let hash = 5381;
  for (let index = 0; index < key.length; index++) {
    hash = ((hash << 5) + hash + key.charCodeAt(index)) >>> 0;
  }
  return `d${hash.toString(16).padStart(8, '0')}`;
}
