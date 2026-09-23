// Minimal optional host services shared by browsers, workers and Node; no DOM or Node type dependency.
const host = globalThis as typeof globalThis & {
  performance?: { now(): number };
  console?: { error(error: unknown): void };
};

export const monotonicNow = () => host.performance?.now() ?? Date.now();
export const reportError = (error: unknown) => host.console?.error(error);
