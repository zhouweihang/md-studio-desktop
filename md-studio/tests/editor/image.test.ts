import { describe, expect, it } from 'vitest';
import { collapseSegments, resolveAssetPath, toAssetUrl, isInside, toPosixPath } from '../../src/shared/paths';

describe('resolveAssetPath', () => {
  it('相对路径解析到文档目录', () => {
    expect(resolveAssetPath('./assets/a.png', 'C:/proj/docs')).toBe('C:/proj/docs/assets/a.png');
    expect(resolveAssetPath('assets/img/图 1.png', 'C:/proj/docs')).toBe('C:/proj/docs/assets/img/图 1.png');
  });

  it('折叠 ../ 与 ./', () => {
    expect(resolveAssetPath('../images/a.png', 'C:/proj/docs')).toBe('C:/proj/images/a.png');
    expect(resolveAssetPath('./a/./b.png', '/home/u/docs')).toBe('/home/u/docs/a/b.png');
  });

  it('绝对路径与 Windows 盘符保留', () => {
    expect(resolveAssetPath('/home/u/a.png', '/home/u/docs')).toBe('/home/u/a.png');
    expect(resolveAssetPath('C:\\pics\\a.png', 'C:/proj')).toBe('C:/pics/a.png');
  });

  it('外链与 data URL 不当作本地路径', () => {
    expect(resolveAssetPath('https://example.com/a.png', '/docs')).toBeNull();
    expect(resolveAssetPath('data:image/png;base64,AAA', '/docs')).toBeNull();
  });

  it('mdstudio-asset 协议还原为绝对路径', () => {
    const url = toAssetUrl('C:\\proj\\docs\\assets\\a.png');
    const restored = resolveAssetPath(url, null);
    expect(restored).toBe('C:/proj/docs/assets/a.png');
  });

  it('未知文档目录时相对路径不可解析（缺失态）', () => {
    expect(resolveAssetPath('./assets/a.png', null)).toBeNull();
  });
});

describe('路径工具', () => {
  it('toAssetUrl 编码特殊字符', () => {
    const url = toAssetUrl('C:/proj/图 #1.png');
    expect(url.startsWith('mdstudio-asset://local/')).toBe(true);
    expect(decodeURIComponent(new URL(url).pathname).replace(/^\//, '')).toBe('C:/proj/图 #1.png');
  });

  it('collapseSegments 处理越界 ..', () => {
    expect(collapseSegments('/a/../../b')).toBe('/b');
    expect(collapseSegments('C:/a/b/../c')).toBe('C:/a/c');
  });

  it('isInside 判断目录包含关系（大小写不敏感）', () => {
    expect(isInside('C:/proj/docs/a.md', 'C:/proj')).toBe(true);
    expect(isInside('C:/proj2/a.md', 'C:/proj')).toBe(false);
    expect(isInside('C:/Proj/a.md', 'c:/proj')).toBe(true);
  });

  it('toPosixPath 统一分隔符', () => {
    expect(toPosixPath('a\\b\\c')).toBe('a/b/c');
  });
});
