import type { TopLevelWindowInfo, WindowLister } from '../native/window-scanner';

/** Fake: lists a fixed set of windows, or fails once `failWith` is set. */
export class FakeWindowLister implements WindowLister {
  failWith: Error | null = null;
  calls = 0;

  constructor(public windows: readonly TopLevelWindowInfo[] = []) {}

  listWindows(): Promise<readonly TopLevelWindowInfo[]> {
    this.calls += 1;
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.windows);
  }
}
