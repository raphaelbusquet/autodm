declare module '*.html' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const data: ArrayBuffer;
  export default data;
}
