// Copies the built Rust addon next to the bundles, so `out/` is self-contained and
// electron-builder can unpack it from the archive.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = `vozella-native.${process.platform}-${process.arch}-msvc.node`;
const source = path.resolve(here, '..', '..', '..', 'native', 'vozella-native', file);
const targetDir = path.resolve(here, '..', 'out', 'native');

if (!existsSync(source)) {
  console.error(`[copy-native] ${source} not found. Run: pnpm build:native`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, path.join(targetDir, file));
console.log(`[copy-native] ${file} -> out/native`);
