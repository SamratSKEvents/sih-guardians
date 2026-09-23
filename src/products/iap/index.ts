/** Public API of the standalone IAP generator. */
export * from './IapTypes';
export { IAP_CONFIG } from './IapConfig';
export { generateIap, validateIapState, toSnapshot, toPreviousIap, IapInputError } from './IapGenerator';
export { compareIapStates } from './analysis/IapDeltaEngine';
export { detectResourceConflicts, validateDependencies } from './analysis/IapValidator';
export { renderJson } from './renderers/JsonRenderer';
export { renderMarkdown } from './renderers/MarkdownRenderer';
export { renderPdf } from './renderers/PdfRenderer';
