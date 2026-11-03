import type { LegacySecretPort } from '@vozella/core';

/**
 * Fake: "decrypts" blobs registered by the test, so no real DPAPI data is ever needed.
 * Unknown blobs fail the way CryptUnprotectData does for foreign data.
 */
export class FakeLegacySecret implements LegacySecretPort {
  private readonly known = new Map<string, Uint8Array>();

  register(blob: Uint8Array, plain: Uint8Array): void {
    this.known.set(Buffer.from(blob).toString('hex'), plain);
  }

  unprotect(blob: Uint8Array): Promise<Uint8Array> {
    const plain = this.known.get(Buffer.from(blob).toString('hex'));
    return plain
      ? Promise.resolve(plain)
      : Promise.reject(new Error('CryptUnprotectData: the data is invalid'));
  }
}
