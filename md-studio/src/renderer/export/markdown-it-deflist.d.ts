declare module 'markdown-it-deflist' {
  import type { MarkdownIt } from 'markdown-it';

  /** 注册定义列表（`term` + `: definition`）支持。 */
  const deflist: (md: MarkdownIt) => void;
  export default deflist;
}
