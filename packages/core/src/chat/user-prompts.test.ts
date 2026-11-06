import { describe, expect, it } from 'vitest';
import { filterRecipes, recipesForScope } from './recipes';
import {
  USER_PROMPT_LIMIT,
  USER_PROMPT_NAME_MAX,
  USER_PROMPT_TEXT_MAX,
  mergeImportedPrompts,
  normalizePromptDraft,
  parsePromptsFile,
  parseUserPrompt,
  scopeRecipes,
  scopeStarters,
  serializePromptsFile,
  uniquePromptName,
  type UserPrompt,
} from './user-prompts';

const names = (key: string): string => key;

const prompt = (n: number, over: Partial<UserPrompt> = {}): UserPrompt => ({
  id: `p${String(n)}`,
  name: `Prompt ${String(n)}`,
  prompt: `Do thing ${String(n)}`,
  availability: 'single',
  engine: null,
  ...over,
});

describe('normalizePromptDraft (validation)', () => {
  it('trims the name and the prompt and keeps a null engine', () => {
    expect(
      normalizePromptDraft({
        name: '  Risks ',
        prompt: ' List the risks.\n',
        availability: 'single',
      }),
    ).toEqual({ name: 'Risks', prompt: 'List the risks.', availability: 'single', engine: null });
  });

  it('accepts every engine and both availabilities', () => {
    for (const engine of ['claude-code', 'codex', 'local'] as const) {
      expect(
        normalizePromptDraft({ name: 'a', prompt: 'b', availability: 'multiple', engine })?.engine,
      ).toBe(engine);
    }
  });

  it('refuses blank or too long names and prompts, and unknown values', () => {
    const base = { name: 'a', prompt: 'b', availability: 'single', engine: null };
    expect(normalizePromptDraft({ ...base, name: '   ' })).toBeNull();
    expect(normalizePromptDraft({ ...base, prompt: '' })).toBeNull();
    expect(
      normalizePromptDraft({ ...base, name: 'x'.repeat(USER_PROMPT_NAME_MAX) }),
    ).not.toBeNull();
    expect(
      normalizePromptDraft({ ...base, name: 'x'.repeat(USER_PROMPT_NAME_MAX + 1) }),
    ).toBeNull();
    expect(
      normalizePromptDraft({ ...base, prompt: 'x'.repeat(USER_PROMPT_TEXT_MAX) }),
    ).not.toBeNull();
    expect(
      normalizePromptDraft({ ...base, prompt: 'x'.repeat(USER_PROMPT_TEXT_MAX + 1) }),
    ).toBeNull();
    expect(normalizePromptDraft({ ...base, availability: 'live' })).toBeNull();
    expect(normalizePromptDraft({ ...base, engine: 'grok' })).toBeNull();
    expect(normalizePromptDraft({ ...base, name: 5 })).toBeNull();
    expect(normalizePromptDraft(null)).toBeNull();
    expect(normalizePromptDraft('text')).toBeNull();
  });

  it('parseUserPrompt also needs an id', () => {
    expect(parseUserPrompt({ ...prompt(1), id: '' })).toBeNull();
    expect(parseUserPrompt({ ...prompt(1), id: 7 })).toBeNull();
    expect(parseUserPrompt(prompt(1))).toEqual(prompt(1));
  });
});

describe('scopeRecipes (merge with built-ins)', () => {
  const mine = [
    prompt(1, { availability: 'single' }),
    prompt(2, { availability: 'multiple' }),
    prompt(3, { availability: 'single', engine: 'codex' }),
  ];

  it('lists the user prompts of the scope first, in saved order, then the built-ins', () => {
    const list = scopeRecipes('Meeting', names, mine);
    const builtIns = recipesForScope('Meeting', names);
    expect(list.map((r) => r.id)).toEqual(['p1', 'p3', ...builtIns.map((r) => r.id)]);
    expect(list[0]).toMatchObject({ owner: 'user', engine: null, name: 'Prompt 1' });
    expect(list[1]).toMatchObject({ owner: 'user', engine: 'codex' });
    expect(list[2]?.owner).toBeUndefined();
  });

  it('a folder or all meetings take the multiple-meeting prompts; Live takes the single ones', () => {
    expect(scopeRecipes('Folder', names, mine)[0]?.id).toBe('p2');
    expect(scopeRecipes('AllMeetings', names, mine).filter((r) => r.owner === 'user')).toHaveLength(
      1,
    );
    const live = scopeRecipes('Live', names, mine);
    expect(live.slice(0, 2).map((r) => r.id)).toEqual(['p1', 'p3']);
    expect(live.slice(2)).toEqual(recipesForScope('Live', names));
  });

  it('keeps the content order of the built-ins for a meeting without action items', () => {
    const list = scopeRecipes('Meeting', names, [], { hasActionItems: false });
    expect(list).toEqual(recipesForScope('Meeting', names, { hasActionItems: false }));
  });

  it('the slash filter matches user prompts by name and by prompt text', () => {
    const list = scopeRecipes('Meeting', names, [
      prompt(1, { name: 'Risk review', prompt: 'Find blockers' }),
    ]);
    expect(filterRecipes(list, '/risk').map((r) => r.id)).toEqual(['p1']);
    expect(filterRecipes(list, '/BLOCKERS').map((r) => r.id)).toEqual(['p1']);
  });
});

describe('scopeStarters (chips)', () => {
  it('takes at most two user prompts, then fills four with the built-ins', () => {
    const chips = scopeStarters('Meeting', names, [prompt(1), prompt(2), prompt(3)]);
    const builtIns = recipesForScope('Meeting', names);
    expect(chips.map((r) => r.id)).toEqual(['p1', 'p2', builtIns[0]?.id, builtIns[1]?.id]);
  });

  it('one user prompt leaves three built-ins; none leaves the built-in four', () => {
    const builtIns = recipesForScope('Folder', names);
    expect(
      scopeStarters('Folder', names, [prompt(9, { availability: 'multiple' })]).map((r) => r.id),
    ).toEqual(['p9', ...builtIns.slice(0, 3).map((r) => r.id)]);
    expect(scopeStarters('Meeting', names, [])).toEqual(
      recipesForScope('Meeting', names).slice(0, 4),
    );
  });

  it('prompts of the other availability never become chips', () => {
    const chips = scopeStarters('Meeting', names, [prompt(1, { availability: 'multiple' })]);
    expect(chips.some((r) => r.owner === 'user')).toBe(false);
  });
});

describe('prompts file (export / import)', () => {
  it('serializes version 1 without ids and parses it back', () => {
    const text = serializePromptsFile([prompt(1, { engine: 'local' }), prompt(2)]);
    const raw = JSON.parse(text) as { version: number; prompts: Record<string, unknown>[] };
    expect(raw.version).toBe(1);
    expect(raw.prompts[0]).toEqual({
      name: 'Prompt 1',
      prompt: 'Do thing 1',
      availability: 'single',
      engine: 'local',
    });
    expect(parsePromptsFile(text)).toEqual({
      status: 'ok',
      prompts: [
        { name: 'Prompt 1', prompt: 'Do thing 1', availability: 'single', engine: 'local' },
        { name: 'Prompt 2', prompt: 'Do thing 2', availability: 'single', engine: null },
      ],
    });
  });

  it('refuses text that is not JSON, the wrong shape, another version, or a bad entry', () => {
    expect(parsePromptsFile('nope')).toEqual({ status: 'invalid' });
    expect(parsePromptsFile('[]')).toEqual({ status: 'invalid' });
    expect(parsePromptsFile('{"version":2,"prompts":[]}')).toEqual({ status: 'invalid' });
    expect(parsePromptsFile('{"version":1}')).toEqual({ status: 'invalid' });
    expect(
      parsePromptsFile(
        JSON.stringify({
          version: 1,
          prompts: [{ name: 'a', prompt: '', availability: 'single' }],
        }),
      ),
    ).toEqual({ status: 'invalid' });
    expect(parsePromptsFile('x'.repeat(2_000_001))).toEqual({ status: 'invalid' });
  });

  it('an empty list is a valid file', () => {
    expect(parsePromptsFile('{"version":1,"prompts":[]}')).toEqual({ status: 'ok', prompts: [] });
  });
});

describe('uniquePromptName', () => {
  it('adds (2), (3) for names taken, ignoring case', () => {
    expect(uniquePromptName('Risks', [])).toBe('Risks');
    expect(uniquePromptName('Risks', ['risks'])).toBe('Risks (2)');
    expect(uniquePromptName('Risks', ['Risks', 'Risks (2)'])).toBe('Risks (3)');
  });

  it('keeps the name within the limit by shortening the base', () => {
    const long = 'x'.repeat(USER_PROMPT_NAME_MAX);
    const next = uniquePromptName(long, [long]);
    expect(next).toHaveLength(USER_PROMPT_NAME_MAX);
    expect(next.endsWith(' (2)')).toBe(true);
  });
});

describe('mergeImportedPrompts', () => {
  let n = 0;
  const newId = (): string => `new-${String((n += 1))}`;

  it('appends with new ids and renames duplicates, also within the file', () => {
    n = 0;
    const existing = [prompt(1, { name: 'Risks' })];
    const result = mergeImportedPrompts(
      existing,
      [
        { name: 'risks', prompt: 'a', availability: 'single', engine: null },
        { name: 'Fresh', prompt: 'b', availability: 'multiple', engine: 'codex' },
        { name: 'Fresh', prompt: 'c', availability: 'multiple', engine: null },
      ],
      newId,
    );
    expect(result.prompts.map((p) => [p.id, p.name])).toEqual([
      ['p1', 'Risks'],
      ['new-1', 'risks (2)'],
      ['new-2', 'Fresh'],
      ['new-3', 'Fresh (2)'],
    ]);
    expect(result).toMatchObject({ added: 3, renamed: 2, skipped: 0 });
  });

  it('stops at the limit and counts what was left out', () => {
    n = 0;
    const existing = Array.from({ length: USER_PROMPT_LIMIT - 1 }, (_, i) => prompt(i));
    const result = mergeImportedPrompts(
      existing,
      [
        { name: 'One', prompt: 'a', availability: 'single', engine: null },
        { name: 'Two', prompt: 'b', availability: 'single', engine: null },
      ],
      newId,
    );
    expect(result.prompts).toHaveLength(USER_PROMPT_LIMIT);
    expect(result).toMatchObject({ added: 1, skipped: 1 });
  });
});
