declare module '*.css';

declare module '*.css?raw' {
  const content: string;
  export default content;
}

declare module '*?raw' {
  const content: string;
  export default content;
}

/** Vite 的 `?inline`：任意资源内联为 data URI（KaTeX 字体导出用）。 */
declare module '*?inline' {
  const dataUrl: string;
  export default dataUrl;
}
