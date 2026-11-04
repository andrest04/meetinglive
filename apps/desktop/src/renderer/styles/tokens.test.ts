import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Items 161 to 168, bugs 18, 19, 22, 23. The token table of the spec (section 4.9) is the single
// palette; this reads it and compares it with tokens.css in both themes, then checks the rules
// that keep the look quiet: no shadows or gradients outside real overlays, a 4 px radius, one
// focus ring, forced colors, reduced motion.

const root = path.resolve(__dirname, '../../../../..');
const spec = fs.readFileSync(path.join(root, 'docs/port/specs/shell-platform.md'), 'utf8');
const renderer = path.resolve(__dirname, '..');
const tokens = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8').replace(/\r\n/g, '\n');
const indexCss = fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8').replace(/\r\n/g, '\n');

interface Pair {
  readonly light: string;
  readonly dark: string;
}

function specTable(): Map<string, Pair> {
  const start = spec.indexOf('### 4.9 Design tokens');
  const end = spec.indexOf('Type: sans', start);
  const table = new Map<string, Pair>();
  for (const line of spec.slice(start, end).split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim().replace(/`/g, ''));
    const name = cells[1];
    if (name?.startsWith('--') && cells[2]?.startsWith('#') && cells[3]?.startsWith('#')) {
      table.set(name, { light: cells[2], dark: cells[3] });
    }
  }
  return table;
}

/** Declarations of a block that starts at `header` (up to its closing brace at the same depth). */
function block(css: string, header: string): Map<string, string> {
  const open = css.indexOf(header);
  if (open < 0) throw new Error(`missing block ${header}`);
  const from = css.indexOf('{', open) + 1;
  let depth = 1;
  let i = from;
  while (depth > 0 && i < css.length) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  const declarations = new Map<string, string>();
  for (const match of css.slice(from, i - 1).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    declarations.set(match[1]!, match[2]!.trim());
  }
  return declarations;
}

describe('palette (item 161)', () => {
  const expected = specTable();
  const light = block(tokens, ':root {');
  const darkOverride = block(tokens, ":root[data-theme='dark']");
  const darkFollowsOs = block(tokens, ":root:not([data-theme='light'])");

  it('the spec table has the eleven tokens', () => {
    expect([...expected.keys()]).toEqual([
      '--paper',
      '--paper-raised',
      '--ink',
      '--on-ink',
      '--ink-muted',
      '--ink-faint',
      '--on-ink-muted',
      '--border-control',
      '--hairline',
      '--hairline-on-ink',
      '--signal',
    ]);
  });

  it.each([...expected])('%s matches the spec in light and dark', (name, pair) => {
    expect(light.get(name)).toBe(pair.light);
    expect(darkOverride.get(name)).toBe(pair.dark);
    expect(darkFollowsOs.get(name)).toBe(pair.dark);
  });

  it('keeps the eight folder accents in both themes (item 166)', () => {
    const accents = ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple', 'neutral'];
    for (const accent of accents) {
      const name = `--accent-${accent}`;
      expect(light.get(name)).toMatch(/^#[0-9a-f]{6}$/);
      expect(darkOverride.get(name)).toMatch(/^#[0-9a-f]{6}$/);
      expect(darkOverride.get(name)).not.toBe(light.get(name));
    }
  });

  it('maps every token to a system color in forced colors mode (high contrast)', () => {
    const forced = block(tokens, '@media (forced-colors: active)');
    for (const name of expected.keys()) expect(forced.get(name)).toMatch(/^[A-Z][A-Za-z]+$/);
    // Spec 4.9: every folder accent is the system highlight, except Neutral, which is window text.
    for (const n of ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple']) {
      expect(forced.get(`--accent-${n}`)).toBe('Highlight');
    }
    expect(forced.get('--accent-neutral')).toBe('CanvasText');
  });
});

describe('theme (item 168)', () => {
  it('follows the OS and lets data-theme override it, with no third mode', () => {
    expect(tokens).toContain('@media (prefers-color-scheme: dark)');
    expect(tokens).toContain(":root:not([data-theme='light'])");
    expect(tokens).toContain(":root[data-theme='dark']");
  });
});

describe('geometry and motion (items 163 to 165)', () => {
  it('uses a 4 px control radius and the spec focus ring', () => {
    expect(indexCss).toMatch(/--radius-control:\s*4px/);
    expect(indexCss).toMatch(
      /:focus-visible\s*\{\s*outline:\s*2px solid var\(--ink\);\s*outline-offset:\s*2px;/,
    );
    expect(indexCss).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*:focus-visible\s*\{\s*outline-color: Highlight;/,
    );
  });

  it('removes motion when the user prefers reduced motion', () => {
    const reduced = indexCss.slice(indexCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(reduced).toMatch(/scroll-behavior:\s*auto !important/);
  });

  it('the default palette, shadows and radii are cleared so only tokens exist', () => {
    expect(indexCss).toMatch(/--color-\*:\s*initial/);
    expect(indexCss).toMatch(/--shadow-\*:\s*initial/);
    expect(indexCss).toMatch(/--radius-\*:\s*initial/);
  });
});

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(tsx|css)$/.test(entry.name) && !entry.name.includes('.test.') ? [full] : [];
  });
}

describe('no decoration outside overlays (item 163)', () => {
  const files = sources(renderer).map((file) => ({
    file: path.relative(renderer, file).replace(/\\/g, '/'),
    text: fs.readFileSync(file, 'utf8'),
  }));

  it('has no gradients', () => {
    expect(files.filter((f) => /gradient/i.test(f.text)).map((f) => f.file)).toEqual([]);
  });

  it('uses a shadow only through the overlay token, on floating surfaces', () => {
    const offenders = files
      .filter((f) => f.file !== 'styles/index.css')
      .flatMap((f) =>
        [...f.text.matchAll(/(?<![\w-])shadow-[\w[\]-]+|box-shadow/g)]
          .map((m) => m[0])
          .filter((token) => token !== 'shadow-overlay')
          .map((token) => `${f.file}: ${token}`),
      );
    expect(offenders).toEqual([]);
  });

  it('uses the signal color only for live state: the live dot and the pulse', () => {
    const users = files
      .filter((f) => f.file !== 'styles/index.css' && f.file !== 'styles/tokens.css')
      .filter((f) => /(bg|text|border|ring|fill|stroke)-signal/.test(f.text))
      .map((f) => f.file)
      .sort();
    // The pill's stop button is the one live control: it stops the recording the dot announces.
    expect(users).toEqual([
      'features/live-copilot/CapsuleView.tsx',
      'ui/Badge.tsx',
      'ui/Pulse.tsx',
    ]);
  });

  it('has no hard-coded colors outside the tokens', () => {
    const offenders = files
      // The Claude mark keeps its brand orange (_gaps.md section 1).
      .filter(
        (f) => f.file !== 'styles/tokens.css' && f.file !== 'features/settings/ProviderMark.tsx',
      )
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(f.text))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });
});

describe('the popup stays dark (item 167, bug 19)', () => {
  it('forces the dark theme before it renders and starts the card hidden', () => {
    const main = fs.readFileSync(path.join(renderer, 'popup/main.tsx'), 'utf8');
    expect(main).toContain("setAttribute('data-theme', 'dark')");
    expect(fs.readFileSync(path.join(renderer, 'meeting-prompt.html'), 'utf8')).toContain(
      'data-theme="dark"',
    );
    // The card is invisible until the entrance runs, so there is no one-frame flash (bug 19).
    const css = fs.readFileSync(path.join(renderer, 'popup/popup.css'), 'utf8');
    expect(css).toMatch(/\.popup-card\[data-phase='hidden'\]\s*\{\s*opacity:\s*0;/);
  });
});
