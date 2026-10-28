declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';

  /** 脚注（`[^id]` + `[^id]: …`）支持。 */
  const footnote: (md: MarkdownIt) => void;
  export default footnote;
}
