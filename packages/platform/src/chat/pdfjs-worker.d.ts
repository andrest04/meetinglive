// pdfjs-dist ships no types for its worker module; chat only hands it to pdfjs as a value.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
