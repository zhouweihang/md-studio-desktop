import { describe, expect, it } from 'vitest';
import { countText } from '../src/shared/text-stats';

describe('countText', () => {
  it('中文逐字计数', () => {
    const stats = countText('你好世界');
    expect(stats.chars).toBe(4);
    expect(stats.words).toBe(4);
  });

  it('英文按词计数', () => {
    const stats = countText('hello, world! MD-Studio');
    expect(stats.words).toBe(3);
  });

  it('中英混排', () => {
    const stats = countText('你好 MD-Studio 世界');
    expect(stats.chars).toBe(15);
    expect(stats.words).toBe(5);
  });

  it('行数统计', () => {
    expect(countText('a\nb\nc').lines).toBe(3);
    expect(countText('').lines).toBe(0);
    expect(countText('a\r\nb').lines).toBe(2);
  });

  it('阅读时间非空至少 1 分钟，空文本为 0', () => {
    expect(countText('hi').minutes).toBe(1);
    expect(countText('').minutes).toBe(0);
  });
});
