# Design system

Rules live in `stack.md` (Design direction). This page is how to use what exists. Code: `apps/desktop/src/renderer`.

## Tokens

- `styles/tokens.css` holds the eight palette tokens, `--signal`, and three derived fills (`--hover`, `--pressed`, `--scrim`, all ink at low strength). Light is the default; dark follows `prefers-color-scheme`; `data-theme="light|dark"` on `<html>` is the user override. Under `forced-colors: active` every token maps to a system color.
- `styles/index.css` wires them to Tailwind v4 and removes Tailwind's default palette, shadows and radii, so only tokens compile: `bg-paper`, `bg-paper-raised`, `text-ink`, `text-ink-muted`, `text-ink-faint`, `border-hairline`, `border-border-control`, `bg-signal`, `rounded-control` (4), `rounded-overlay` (6), `shadow-overlay` (overlays only).
- Type utilities: `text-ui` 13, `text-ui-lg` 14, `text-read` 15, `text-read-lg` 16, `text-heading` 20, `text-title` 30 (documents only). `font-mono` for timestamps and data.
- Fonts come from `@fontsource` and are bundled; the CSP allows `'self'` only.
- Theme: `useTheme()` (`app/theme.tsx`) keeps the preference in localStorage and tells the main process (`app.setThemePreference`), which sets `nativeTheme` and recolors the `titleBarOverlay` (`main/windows/title-bar-theme.ts`).

## Strings

`scripts/convert-strings.mjs` converts the WinUI `.resw` and Core `.resx` files to `i18n/locales/{en,es}.json`, keys untouched, placeholders (`{0}`, `{1:t}`) kept. `--check` fails when the JSON is stale (run in unit tests). New keys that have no WinUI equivalent go in `locales/ui.{en,es}.json` with a `Ui_` prefix. Use `useT()`; `t('Nav_Record.Content')`, `t('Download_ModelProgress', name, 40)`. Keys are typed.

## Kit (`ui/`)

Pure components: no IPC, no router, no i18n; text arrives as props. Containers live in `features/*`.

Button (primary, secondary, quiet; no danger variant), IconButton (`label` is required and becomes the name and tooltip), Input, Textarea, Field (label, help, error), Select, Combobox, Checkbox, Switch, RadioGroup, Tabs, Tooltip, Menu, ContextMenu, Dialog, ToastProvider and `useToast()`, Progress, Skeleton, Tree, Splitter, SectionHeader, SettingRow, EmptyState, Kbd, Badge, Mark. Icons: lucide through `Icon` only (1.5 stroke, decorative).

Tree and Splitter are ours (Base UI has neither); their key handling is in `tree-navigation.ts` and `splitter-logic.ts`, unit tested.

Rules: errors are ink plus an icon and words, never red; `signal` appears only as the Badge `live` dot; every state that uses color also changes something else (border, weight, check) so forced-colors stays legible; Base UI popups are portaled, so do not rely on a parent theme scope.

## Shell and gallery

`features/shell/AppShell.tsx`: sidebar (resizable with the Splitter, Mark, nav) and a 720 px document column. The top 40 px of both panes is the drag strip behind the native caption buttons. Routes are hash-routed (`app/router.tsx`). Record, Library and Settings are placeholders using real strings; the Record button is inert until the recording module lands.

`#/gallery` shows every component and has a theme switch. It redirects to Record in a packaged app.

## Checks and screenshots

- `pnpm test` covers the logic and component keyboard behavior (jsdom).
- `pnpm test:e2e` includes `shell.spec.ts`: navigation, theme to `nativeTheme`, language switch, keyboard resize, axe on the gallery in both themes (serious and critical must be zero). axe is injected directly because Electron cannot open the second page AxeBuilder wants.
- Playwright pins `prefers-color-scheme` to light, so the system-follow path is not observable there.
- `VOZELLA_SCREENSHOTS=1 pnpm --filter @vozella/desktop exec playwright test screens` rewrites `docs/port/screens/foundation/`.

Not verified: real forced-colors rendering (only the CSS mapping exists), screen readers, a high-DPI or multi-monitor window, caption buttons in the screenshots (they are drawn by Windows outside the page).
