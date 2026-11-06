import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import uiEn from './locales/ui.en.json';
import uiEs from './locales/ui.es.json';

// R12, items 192 and 194. The spec file is the source of truth for the strings and the control
// names of the Record page; this reads it, so a new key in the spec fails here until both
// languages have it.

const root = path.resolve(__dirname, '../../../../..');
const spec = fs.readFileSync(path.join(root, 'docs/port/specs/recording.md'), 'utf8');
// The page reads the converted keys and the hand-written `Ui_` keys from one merged catalog.
const catalogEn: Record<string, string> = { ...en, ...uiEn };
const catalogEs: Record<string, string> = { ...es, ...uiEs };

/** Section 2 of the spec, "User-facing features". */
function section2(): string {
  const start = spec.indexOf('## 2. User-facing features');
  const end = spec.indexOf('## 3. Domain rules');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return spec.slice(start, end);
}

/** The catalog keys named in backticks: a resource key has an underscore or a control suffix. */
function section2Keys(): string[] {
  const found = section2().match(/`[A-Za-z][A-Za-z0-9_.]*`/g) ?? [];
  const keys = found.map((entry) => entry.slice(1, -1));
  return [...new Set(keys)].filter(
    (key) => key.includes('_') || /\.(Text|Content|Header|Title|PlaceholderText)$/.test(key),
  );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\d+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('item 192: the strings of spec section 2', () => {
  const keys = section2Keys();

  it('finds the keys in the spec', () => {
    expect(keys.length).toBeGreaterThan(60);
  });

  it.each(keys)('%s exists in English and Spanish with the same placeholders', (key) => {
    expect(catalogEn[key], `${key} in en`).toBeDefined();
    expect(catalogEs[key], `${key} in es`).toBeDefined();
    expect(placeholders(catalogEs[key] ?? '')).toEqual(placeholders(catalogEn[key] ?? ''));
  });

  it('every key of the Record page shared by both catalogs has the same placeholders', () => {
    const shared = Object.keys(catalogEn).filter(
      (key) => key in catalogEs && /^(RecordPage_|Status_|Error_|Ui_Record)/.test(key),
    );
    for (const key of shared) {
      expect(placeholders(catalogEs[key] ?? ''), key).toEqual(placeholders(catalogEn[key] ?? ''));
    }
  });
});

/**
 * Item 194: each control the spec lists, with where the port keeps it. The WinUI automation id
 * became a `data-testid`; a few were renamed with the control (the toggle is two buttons, Record
 * and Stop). A name that is an accessible-name resource key is checked in the catalog instead.
 */
const controls: { spec: string; port: string; file: string; kind: 'testid' | 'key' }[] = [
  {
    spec: 'BtnToggleRecording',
    port: 'BtnRecord',
    file: 'features/record/RecordRoute.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnToggleRecording',
    port: 'BtnStop',
    file: 'features/record/RecordingBar.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnPauseRecording',
    port: 'BtnPause',
    file: 'features/record/RecordingBar.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnHighlightMoment',
    port: 'BtnHighlight',
    file: 'features/record/RecordingBar.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnCopyLiveTranscript',
    port: 'BtnCopy',
    file: 'features/record/RecordingBar.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnDiscardRecording',
    port: 'BtnDiscard',
    file: 'features/record/RecordingBar.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnImportAudio',
    port: 'BtnImportAudio',
    file: 'features/record/RecordRoute.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnCancelProcessing',
    port: 'BtnCancelProcessing',
    file: 'features/record/ProcessingBar.tsx',
    kind: 'testid',
  },
  {
    spec: 'BtnOpenSession',
    port: 'BtnOpenResult',
    file: 'features/record/ResultCard.tsx',
    kind: 'testid',
  },
  {
    spec: 'TxtMeetingTitle',
    port: 'TxtMeetingTitle',
    file: 'features/record/RecordIdle.tsx',
    kind: 'testid',
  },
  {
    spec: 'ComboRecordDestination',
    port: 'CmbDestination',
    file: 'features/record/RecordIdle.tsx',
    kind: 'testid',
  },
  {
    spec: 'ComboRecordMicrophone',
    port: 'ComboRecordMicrophone.AutomationProperties.Name',
    file: '',
    kind: 'key',
  },
  {
    spec: 'ListRecordAudioSource',
    port: 'ListRecordAudioSource.AutomationProperties.Name',
    file: '',
    kind: 'key',
  },
  {
    spec: 'TxtRecordingNotes',
    port: 'TxtRecordingNotes',
    file: 'features/record/notepad/Notepad.tsx',
    kind: 'testid',
  },
  {
    spec: 'TxtLiveAsk',
    port: 'TxtLiveAsk',
    file: 'features/record/LiveAskDock.tsx',
    kind: 'testid',
  },
  {
    spec: 'ToggleLiveWebSearch',
    port: 'ToggleLiveWebSearch',
    file: 'features/record/LiveAskDock.tsx',
    kind: 'testid',
  },
  {
    spec: 'TxtLiveTranscriptPreview',
    port: 'live-canvas',
    file: 'features/record/LiveCanvas.tsx',
    kind: 'testid',
  },
];

/** Controls of the armed live answer, which left with the owner decision of 2026-11-03. */
const dropped = ['BtnLiveAnswer', 'BtnLiveAnswerDismiss'];

describe('item 194: automation ids of the Record page', () => {
  const line = /^194\..*$/m.exec(spec)?.[0] ?? '';
  const listed = [...line.matchAll(/`[A-Za-z]+`/g)].map((found) => found[0]);
  const names = listed
    .map((entry) => entry.slice(1, -1))
    .filter((name) => /^(Btn|Txt|Combo|List|Toggle)/.test(name));

  it('covers every control the spec lists', () => {
    expect(names.length).toBe(18);
    for (const name of names) {
      expect(
        controls.some((control) => control.spec === name) || dropped.includes(name),
        `${name} is mapped or dropped`,
      ).toBe(true);
    }
  });

  it.each(controls)('$spec is $port in the port', (control) => {
    if (control.kind === 'key') {
      expect(catalogEn[control.port]).toBeDefined();
      expect(catalogEs[control.port]).toBeDefined();
      return;
    }
    const source = fs.readFileSync(path.resolve(__dirname, '..', control.file), 'utf8');
    expect(source).toMatch(
      new RegExp(`(data-testid|testId|id)["']?[=:]\\s*["{']+${control.port}["'}]`),
    );
  });
});
