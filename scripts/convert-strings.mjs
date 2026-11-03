// Converts the WinUI string resources into the JSON catalogs the renderer loads.
//
//   MeetingLive.App/Strings/{en-us,es}/Resources.resw   app strings
//   MeetingLive.Core/Strings/CoreStrings[.es].resx      core strings (CLI failures, prompts)
//
// Keys are kept exactly as they are in the source so the parity ledger and the specs
// keep pointing at the same names. Placeholders ({0}, {1:t}) are kept verbatim.
// Run: node scripts/convert-strings.mjs           writes apps/desktop/src/renderer/i18n/locales
//      node scripts/convert-strings.mjs --check   exits 1 when the committed JSON is stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'apps/desktop/src/renderer/i18n/locales');

const sources = {
  en: ['MeetingLive.App/Strings/en-us/Resources.resw', 'MeetingLive.Core/Strings/CoreStrings.resx'],
  es: ['MeetingLive.App/Strings/es/Resources.resw', 'MeetingLive.Core/Strings/CoreStrings.es.resx'],
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Parses the text entries of a .resw or .resx file. Binary and typed entries are skipped. */
export function parseResources(xml) {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
  const entries = {};
  const pattern = /<data\s+([^>]*?)>\s*<value>([\s\S]*?)<\/value>/g;
  for (const match of withoutComments.matchAll(pattern)) {
    const attributes = match[1] ?? '';
    if (/\b(type|mimetype)=/.test(attributes)) continue;
    const name = /\bname="([^"]+)"/.exec(attributes)?.[1];
    if (name === undefined) continue;
    entries[decodeXml(name)] = decodeXml(match[2] ?? '');
  }
  return entries;
}

/** Merges files in order. A key defined twice with different text is a source defect. */
export function mergeCatalogs(files) {
  const merged = {};
  for (const { file, entries } of files) {
    for (const [key, value] of Object.entries(entries)) {
      if (key in merged && merged[key] !== value) {
        throw new Error(`duplicate key with different text: ${key} (${file})`);
      }
      merged[key] = value;
    }
  }
  return merged;
}

function main(check) {
  fs.mkdirSync(outDir, { recursive: true });
  let stale = false;
  for (const [locale, files] of Object.entries(sources)) {
    const catalog = mergeCatalogs(
      files.map((file) => ({
        file,
        entries: parseResources(fs.readFileSync(path.join(root, file), 'utf8')),
      })),
    );
    const target = path.join(outDir, `${locale}.json`);
    const json = `${JSON.stringify(catalog, null, 2)}\n`;
    if (check) {
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (current.replace(/\r\n/g, '\n') !== json) {
        stale = true;
        console.error(`stale: ${path.relative(root, target)}`);
      }
      continue;
    }
    fs.writeFileSync(target, json);
    console.log(`${locale}: ${Object.keys(catalog).length} keys -> ${path.relative(root, target)}`);
  }
  if (stale) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.includes('--check'));
}
