import { describe, expect, it } from 'vitest';
import { scanMath, wrapMath } from '../../src/shared/math';

describe('scanMath 行内', () => {
  it('识别基本行内公式', () => {
    const spans = scanMath('体积 $V = \\frac{4}{3}\\pi r^3$ 与质量');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('inline');
    expect(spans[0]?.body).toBe('V = \\frac{4}{3}\\pi r^3');
    expect('体积 $V = \\frac{4}{3}\\pi r^3$ 与质量'.slice(spans[0]!.from, spans[0]!.to)).toBe('$V = \\frac{4}{3}\\pi r^3$');
  });

  it('中文与公式相邻不误判', () => {
    const spans = scanMath('中文$x+y$中文');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.body).toBe('x+y');
  });

  it('货币写法不当作公式', () => {
    expect(scanMath('价格是 $5 和 $6 美元', {})).toHaveLength(0);
    expect(scanMath('$ 5x $')).toHaveLength(0);
  });

  it('转义 \\$ 不算定界符', () => {
    expect(scanMath('金额 \\$100 与 \\$200')).toHaveLength(0);
  });

  it('闭定界符后接数字视为货币（不识别）', () => {
    expect(scanMath('$12$3')).toHaveLength(0);
  });

  it('行内公式不跨行', () => {
    expect(scanMath('$a\nb$')).toHaveLength(0);
  });

  it('skip 区间（代码）内的 $ 被忽略', () => {
    const text = '`$x$` 与 $y$';
    const spans = scanMath(text, { skip: [{ from: 0, to: 5 }] });
    expect(spans).toHaveLength(1);
    expect(spans[0]?.body).toBe('y');
  });
});

describe('scanMath 块级', () => {
  it('识别跨行块级公式', () => {
    const text = ['前文', '$$', '\\int_0^1 x dx', '$$', '后文'].join('\n');
    const spans = scanMath(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('block');
    expect(spans[0]?.body.trim()).toBe('\\int_0^1 x dx');
  });

  it('单行块级公式', () => {
    const spans = scanMath('$$E = mc^2$$');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.body).toBe('E = mc^2');
  });

  it('未闭合的 $$ 不产生区间', () => {
    expect(scanMath('$$\n未闭合')).toHaveLength(0);
  });
});

describe('wrapMath', () => {
  it('行内包裹与幂等', () => {
    expect(wrapMath('x^2', false)).toBe('$x^2$');
    expect(wrapMath('$x^2$', false)).toBe('$x^2$');
  });

  it('块级包裹', () => {
    expect(wrapMath('a+b', true)).toBe('$$\na+b\n$$');
    expect(wrapMath('', true)).toBe('$$\n\n$$');
  });
});
