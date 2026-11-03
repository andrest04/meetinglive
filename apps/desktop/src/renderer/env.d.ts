/// <reference types="vite/client" />
import type { VozellaApi } from '@vozella/contracts';

declare global {
  interface Window {
    /** Exposed by the preload script. The only way the page talks to the main process. */
    readonly vozella: VozellaApi;
  }
}
