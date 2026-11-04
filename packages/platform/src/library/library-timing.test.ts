import fs from 'node:fs';
import path from 'node:path';
import { LibraryService, MeetingBusyRegistry, renderMeetingMarkdown } from '@vozella/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FOLDER_1,
  createLibraryFixture,
  folder,
  meeting,
  type LibraryFixture,
} from './library-test-kit';

/**
 * Measures the Library's slow paths against real files at the size the redesign has to carry. It
 * writes thousands of files, so it runs only when asked:
 *
 *   VOZELLA_LIBRARY_TIMING=1 pnpm --filter @vozella/platform exec vitest run src/library/library-timing --silent=false
 *
 * The numbers go to the console; budgets are checked by the people reading them, because a shared
 * machine would make a hard limit here flaky.
 */
const COUNT = 3000;
const MOVES = 200;

const report = (line: string): void => {
  process.stdout.write(`${line}
`);
};

const elapsed = async <T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> => {
  const start = performance.now();
  const value = await run();
  return { ms: Math.round(performance.now() - start), value };
};

const idOf = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

/** Writes meetings the way the app stores them, with a transcript of about `lines` lines. */
function seed(fx: LibraryFixture, lines: number): number {
  const inbox = path.join(fx.root, 'Inbox');
  fs.mkdirSync(inbox, { recursive: true });
  let bytes = 0;
  for (let index = 0; index < COUNT; index += 1) {
    const day = String((index % 28) + 1).padStart(2, '0');
    const month = String((index % 12) + 1).padStart(2, '0');
    const year = 2020 + (index % 6);
    const transcript = Array.from(
      { length: lines },
      (_, line) =>
        `[00:${String(line % 60).padStart(2, '0')}:00] Revisión ${String(index)} del año: acordamos la línea ${String(line)} y seguimos con el plan.`,
    ).join('\n');
    const text = renderMeetingMarkdown(
      meeting({
        id: idOf(index),
        title: `Reunión ${String(index)}`,
        recordedAt: `${String(year)}-${month}-${day}T10:00:00.0000000+00:00`,
        endedAt: `${String(year)}-${month}-${day}T10:45:00.0000000+00:00`,
        summary: `Resumen de la reunión ${String(index)}. Decidimos seguir con el plan.`,
        notes: `Notas personales ${String(index)}`,
        transcript,
      }),
    );
    bytes += text.length;
    fs.writeFileSync(
      path.join(inbox, `${String(year)}-${month}-${day} Reunion ${String(index)}.md`),
      text,
    );
  }
  return bytes;
}

const newService = (fx: LibraryFixture): LibraryService =>
  new LibraryService({
    meetings: fx.meetings,
    folders: fx.folders,
    busy: new MeetingBusyRegistry(),
    clock: { now: () => new Date('2026-09-05T15:00:00.000Z') },
    newId: () => crypto.randomUUID(),
  });

describe.runIf(process.env.VOZELLA_LIBRARY_TIMING === '1')(
  `library timing at ${String(COUNT)} meetings`,
  { timeout: 600_000 },
  () => {
    let fx: LibraryFixture;

    beforeAll(() => {
      fx = createLibraryFixture();
    });
    afterAll(() => {
      fx.cleanup();
    });

    it(`moves ${String(MOVES)} meetings in one batch`, async () => {
      const bytes = seed(fx, 40);
      report(`seeded ${String(COUNT)} meetings, ${String(Math.round(bytes / 1e6))} MB`);
      await fx.folders.save(folder(FOLDER_1, 'Clients'));
      const service = newService(fx);
      const load = await elapsed(() => service.load());
      report(`library.load, first: ${String(load.ms)} ms`);
      const again = await elapsed(() => service.load());
      report(`library.load, second: ${String(again.ms)} ms`);

      const ids = Array.from({ length: MOVES }, (_, index) => idOf(index));
      const move = await elapsed(() =>
        service.moveMeetings({ meetingIds: ids, folderId: FOLDER_1 }),
      );
      report(`moveMeetings ${String(MOVES)}: ${String(move.ms)} ms`);
      expect(move.value.every((result) => result.ok)).toBe(true);
    });
  },
);
