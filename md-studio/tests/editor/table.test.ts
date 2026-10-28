import { describe, expect, it } from 'vitest';
import {
  addColumn,
  addRow,
  createTableTemplate,
  deleteColumn,
  deleteRow,
  displayWidth,
  parseTableSource,
  serializeTable,
  splitRow
} from '../../src/shared/table';

const SOURCE = ['| 名称 | 数量 | 备注 |', '| :--- | ---: | :--: |', '| 苹果 | 3 | 新鲜 |', '| 梨 | 12 | |'].join('\n');

describe('parseTableSource', () => {
  it('解析表头、数据行与对齐', () => {
    const model = parseTableSource(SOURCE);
    expect(model).not.toBeNull();
    expect(model?.rows).toEqual([
      ['名称', '数量', '备注'],
      ['苹果', '3', '新鲜'],
      ['梨', '12', '']
    ]);
    expect(model?.aligns).toEqual(['left', 'right', 'center']);
  });

  it('列数不一致时补齐', () => {
    const model = parseTableSource('| a | b |\n| --- | --- |\n| 1 |');
    expect(model?.rows[1]).toEqual(['1', '']);
  });

  it('非表格返回 null', () => {
    expect(parseTableSource('普通文本')).toBeNull();
    expect(parseTableSource('| a | b |\n| nope |')).toBeNull();
  });

  it('splitRow 保留转义竖线', () => {
    expect(splitRow('| a\\|b | c |')).toEqual(['a\\|b', 'c']);
  });
});

describe('serializeTable', () => {
  it('按显示宽度对齐并输出规范表格', () => {
    const model = parseTableSource(SOURCE)!;
    const text = serializeTable(model);
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('| :--- | ---: | :--: |');
    // 中文按 2 宽计算：名称(4) 至少与「苹果」等宽
    expect(lines[0]).toContain('名称');
    expect(text).toContain('| 苹果');
  });

  it('displayWidth 对 CJK 计 2', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('中a')).toBe(3);
  });

  it('序列化结果可再解析（往返稳定）', () => {
    const model = parseTableSource(SOURCE)!;
    const again = parseTableSource(serializeTable(model));
    expect(again?.rows).toEqual(model.rows);
    expect(again?.aligns).toEqual(model.aligns);
  });
});

describe('行列操作', () => {
  const model = parseTableSource(SOURCE)!;

  it('插入行（在指定行之后）', () => {
    const next = addRow(model, 2);
    expect(next.rows).toHaveLength(4);
    expect(next.rows[2]).toEqual(['', '', '']);
    expect(next.rows[1]).toEqual(['苹果', '3', '新鲜']);
    expect(next.rows[3]).toEqual(['梨', '12', '']);
    // 表头下方插入（索引夹取到 1）
    expect(addRow(model, 0).rows[1]).toEqual(['', '', '']);
  });

  it('删除行但保留表头', () => {
    const next = deleteRow(model, 1);
    expect(next.rows[1]).toEqual(['梨', '12', '']);
    expect(deleteRow({ rows: [model.rows[0]!, model.rows[1]!], aligns: model.aligns }, 1).rows).toHaveLength(2);
  });

  it('插入列保持对齐标记', () => {
    const next = addColumn(model, 1);
    expect(next.aligns).toEqual(['left', null, 'right', 'center']);
    expect(next.rows[0]).toEqual(['名称', '', '数量', '备注']);
  });

  it('删除列', () => {
    const next = deleteColumn(model, 0);
    expect(next.aligns).toEqual(['right', 'center']);
    expect(next.rows[0]).toEqual(['数量', '备注']);
    expect(next.rows[2]).toEqual(['12', '']);
  });

  it('模板可直接序列化', () => {
    const template = createTableTemplate(2, 1);
    const text = serializeTable(template);
    expect(text.split('\n')).toHaveLength(3);
    expect(parseTableSource(text)).not.toBeNull();
  });
});

describe('20×10 表格性能（REQ-003：<150 ms）', () => {
  it('解析 + 序列化往返在预算内', () => {
    const columns = 10;
    const rows = 20;
    const header = `| ${Array.from({ length: columns }, (_, c) => `列 ${c}`).join(' | ')} |`;
    const align = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const body = Array.from(
      { length: rows },
      (_, r) => `| ${Array.from({ length: columns }, (_, c) => `单元格 ${r}-${c}`).join(' | ')} |`
    );
    const source = [header, align, ...body].join('\n');

    const started = performance.now();
    const model = parseTableSource(source);
    const text = serializeTable(model!);
    const elapsed = performance.now() - started;
    console.log(`[perf] 20×10 表格解析 + 序列化：${elapsed.toFixed(2)} ms`);

    expect(model?.rows).toHaveLength(rows + 1);
    expect(model?.aligns).toHaveLength(columns);
    // 序列化会按显示宽度补空格，往返以「再解析结果一致」为准
    expect(parseTableSource(text)?.rows).toEqual(model?.rows);
    expect(elapsed).toBeLessThan(150);
  });
});
