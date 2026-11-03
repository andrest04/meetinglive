/**
 * Port: decrypt a secret written by the .NET app with DPAPI (CurrentUser scope).
 * New secrets never use this; they go through Electron safeStorage. This exists
 * only for the explicit import of old credential files.
 */
export interface LegacySecretPort {
  unprotect(blob: Uint8Array): Promise<Uint8Array>;
}
