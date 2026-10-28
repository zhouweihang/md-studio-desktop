/**
 * 渲染层可用的轻量路径工具（不依赖 node:path，浏览器侧同构）。
 * Windows 与 POSIX 分隔符都支持。
 */

const SEPARATOR = /[\\/]/;

export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function splitPath(path: string): string[] {
  return path.split(SEPARATOR).filter((part) => part.length > 0);
}

/** 取路径最后一段（文件名或目录名）。 */
export function baseName(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? path;
}

/** 去掉文件名后的目录（保留盘符/根）。 */
export function dirName(path: string): string {
  const normalized = toPosixPath(path);
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '';
  if (index === 0) return '/';
  return normalized.slice(0, index);
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const last = dir[dir.length - 1];
  if (last === '/' || last === '\\') return `${dir}${name}`;
  return `${dir}/${name}`;
}

export function extName(path: string): string {
  const name = baseName(path);
  const index = name.lastIndexOf('.');
  if (index <= 0) return '';
  return name.slice(index + 1).toLowerCase();
}

export function isMarkdownPath(path: string): boolean {
  const ext = extName(path);
  return ext === 'md' || ext === 'markdown' || ext === 'mdx' || ext === 'txt';
}

export function stripExtension(name: string): string {
  const index = name.lastIndexOf('.');
  if (index <= 0) return name;
  return name.slice(0, index);
}

/**
 * 本地文件 → 自定义协议 URL（mdstudio-asset://local/<encodeURIComponent(path)>）。
 * 主进程用 decodeURIComponent(url.pathname) 还原，去掉首个 "/"。
 */
export function toAssetUrl(absPath: string): string {
  return `mdstudio-asset://local/${encodeURIComponent(toPosixPath(absPath))}`;
}

/** 文件是否位于目录内（含自身），用于文件树/资源落盘判断。 */
export function isInside(childPath: string, parentDir: string): boolean {
  const child = toPosixPath(childPath).toLowerCase();
  const parent = toPosixPath(parentDir).toLowerCase().replace(/\/+$/, '');
  if (!parent) return false;
  if (child === parent) return true;
  return child.startsWith(`${parent}/`);
}

/** 计算 markdown 中的资源路径相对当前文档目录的绝对路径；http(s)/data 等外部地址返回 null。 */
export function resolveAssetPath(src: string, docDir: string | null): string | null {
  const trimmed = src.trim().replace(/^<|>$/g, '');
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed)) {
    // http:, https:, data:, mdstudio-asset: 等 → 外部地址，不处理
    if (/^mdstudio-asset:/i.test(trimmed)) return decodeURIComponent(trimmed.replace(/^mdstudio-asset:\/\/local\//i, ''));
    return null;
  }
  if (/^[\\/]/.test(trimmed)) return toPosixPath(trimmed);
  if (/^[a-z]:[\\/]/i.test(trimmed)) return toPosixPath(trimmed);
  if (!docDir) return null;
  const base = toPosixPath(docDir).replace(/\/+$/, '');
  const joined = `${base}/${toPosixPath(trimmed)}`;
  return collapseSegments(joined);
}

/** 折叠 a/./b、a/../b 形式的路径段（不解析符号链接）。 */
export function collapseSegments(path: string): string {
  const normalized = toPosixPath(path);
  const prefixMatch = normalized.match(/^([a-z]:)?\//i);
  const prefix = prefixMatch?.[0] ?? '';
  const rest = normalized.slice(prefix.length);
  const stack: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `${prefix}${stack.join('/')}`;
}
