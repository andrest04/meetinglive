import { describe, expect, it } from 'vitest';
import {
  libraryCreateFolder,
  libraryLoad,
  librarySetLocation,
  requestChannels,
  settingsUpdate,
  workspaceDispatch,
  workspaceActionSchema,
} from './index';

describe('library contracts', () => {
  it('registers every library request by name', () => {
    for (const name of [
      'library.load',
      'library.getMeeting',
      'library.createFolder',
      'library.renameFolder',
      'library.updateFolderPersonality',
      'library.setFolderNote',
      'library.deleteFolder',
      'library.moveMeeting',
      'library.deleteMeeting',
      'library.isMeetingBusy',
      'library.getLocation',
      'library.openFolder',
      'library.chooseLocation',
      'library.setLocation',
      'settings.get',
      'settings.update',
      'workspace.getState',
      'workspace.dispatch',
    ]) {
      expect(Object.keys(requestChannels)).toContain(name);
    }
  });

  it('takes failures as values, not exceptions', () => {
    const failure = { ok: false, reason: 'name-taken' };
    expect(libraryCreateFolder.output.safeParse(failure).success).toBe(true);
    expect(
      libraryLoad.output.safeParse({ ok: false, reason: 'corrupt', message: 'x' }).success,
    ).toBe(true);
    expect(libraryCreateFolder.output.safeParse({ ok: false, reason: 'made-up' }).success).toBe(
      false,
    );
  });

  it('rejects a settings patch with an unknown key', () => {
    expect(settingsUpdate.input.safeParse({ patch: { uiLanguage: 'en' } }).success).toBe(true);
    expect(settingsUpdate.input.safeParse({ patch: { nope: 1 } }).success).toBe(false);
    expect(settingsUpdate.input.safeParse({ patch: { typeSafeEnabled: 'yes' } }).success).toBe(
      false,
    );
  });

  it('validates workspace actions', () => {
    expect(workspaceActionSchema.safeParse({ type: 'navigateTo', tag: 'History' }).success).toBe(
      true,
    );
    expect(workspaceActionSchema.safeParse({ type: 'navigateTo', tag: 'Transcript' }).success).toBe(
      false,
    );
    expect(
      workspaceActionSchema.safeParse({ type: 'setSessionTab', tab: 'Settings' }).success,
    ).toBe(false);
    expect(workspaceDispatch.input.safeParse({ action: { type: 'bogus' } }).success).toBe(false);
  });

  it('set location takes a path or null', () => {
    expect(librarySetLocation.input.safeParse({ path: null }).success).toBe(true);
    expect(librarySetLocation.input.safeParse({}).success).toBe(false);
  });
});
