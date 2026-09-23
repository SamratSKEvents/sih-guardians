declare module 'pdfkit/output' {
  export function toBytes(doc: PDFKit.PDFDocument): Promise<Uint8Array>;
  export function toBlob(doc: PDFKit.PDFDocument): Promise<Blob>;
}
