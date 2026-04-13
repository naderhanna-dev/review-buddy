// Browser stub for node:child_process — never called from browser code,
// but the barrel export from @reviewradar/shared pulls in pr-provider.ts
// which imports spawn. This satisfies the import without crashing.
export function spawn() {
  throw new Error("spawn is not available in the browser");
}
export function execSync() {
  throw new Error("execSync is not available in the browser");
}
