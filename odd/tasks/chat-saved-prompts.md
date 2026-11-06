# Feature: Saved prompts on `/` (Phase 5 of the AI panel plan)

## Objective
Let the user save their own chat prompts ("recipes"), run them from the `/` menu or starter chips, and share them as files — Granola Recipes / Fathom saved prompts / Notion custom skills parity.

## Why
Granola: `/` recipes with name = shortcut, single vs multi-meeting type, optional model, share/remix. Fathom: saved prompt collections. Notion: custom skills listed first. Vozella only has 12+4 built-in recipes; user recipes were not ported (`packages/core/src/chat/recipes.ts:5`).

## Approach
- User recipe: `{ id, name, prompt, availability: 'single' | 'multiple', engine?: 'claude-code' | 'codex' | 'local' | null }`, stored next to settings in app data (JSON), validated with zod.
- `/` menu and starter chips list user recipes first (Notion pattern), then built-ins for the scope.
- Create from the `/` menu ("New prompt…"), from a sent message ("Save as prompt"), edit/delete in a small dialog; export/import `.vozella-prompts.json`.
- Optional per-recipe engine override for that send only.

## Delivery strategy
`exception-ok`, local merge. RDD off. Overnight autonomous run authorized.

## Tasks
- [x] T1 — Storage + contracts + core merge with built-ins + UI (menu, chips, dialogs, save-from-message, import/export) + per-recipe engine; tests + e2e. Route: delegated (writer trigger: 2+ non-trivial files across core, platform, contracts, main, renderer). Commit pending.

## Acceptance criteria
- Create, edit, delete, run a saved prompt; it appears first in `/` and chips for its scope type.
- Export then import round-trips; invalid files are refused with a clear message.
- Per-recipe engine is honored for that send only.

## Progress / evidence
T1 (commit pending):
- Storage: `chat-prompts.json` in app data (`AppPaths.chatPromptsFilePath`), `{ version: 1, prompts: [{ id, name, prompt, availability, engine }] }`; `JsonChatPromptStore` (platform) with lock + atomic write, tolerant load (bad file: empty, logged, kept as `.corrupt` on next write), max 100. WinUI `chat-recipes.json` untouched.
- Core `user-prompts.ts`: validation, `scopeRecipes` (saved first, then built-ins), `scopeStarters` (up to 2 saved + built-ins to 4), file parse/serialize, `uniquePromptName` "(2)", `mergeImportedPrompts`. `ChatRecipe` gains `owner`/`engine`. `ChatService.send` option `engine` -> `providers.resolve(engine)`.
- Contracts: `chat.prompts.{list,create,update,delete,export,import}`, event `chat.promptsChanged`, `chat.send.engine`.
- Main: `ChatPromptsController`, `registerChatPromptHandlers`, `chatProviderSource(engine)` -> resolver `{ kind }`; save/open dialogs; fake prompt log adds `<<<ENGINE id>>>`.
- Renderer: "Your prompts"/"Suggested" groups, footer (New prompt…, Import, Export, Edit/Delete for the highlighted saved prompt), row hover icons (tabindex -1, aria-hidden), `PromptDialog`, `DeletePromptDialog`, "Save as prompt" on user messages, armed engine line. Strings in `ui.{en,es}.json`. Spec: `docs/port/specs/chat.md` section 10.
- RED observed then GREEN: core `user-prompts.test.ts` (module missing), `chat-service.engine.test.ts` (2 failed); contracts `chat-prompts.test.ts` (7 failed); platform `chat-prompt-store.test.ts` (module missing); main `chat-prompts-handlers.test.ts` (module missing) + 2 engine cases in `chat-handlers.test.ts`; renderer `SavedPrompts.test.tsx` (15 failed).
- Checks: core 2018 passed; contracts 62 passed; platform 513 passed, 1 failed (known B18 pin); desktop unit 2245 passed, 6 skipped; `pnpm typecheck` ok; prettier + eslint clean on touched files; `pnpm build` ok; e2e `chat-saved-prompts` + `chat-recipes` + `chat-panel` + `chat-attachments`: 17 passed, 1 skipped (screenshot-gated), visible windows.

## Next step
Commit T1 on `feat/chat-saved-prompts`.
