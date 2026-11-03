import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';

const empty = z.object({}).strict();
const done = z.object({ done: z.literal(true) });

/** Main tells the popup page to appear. The window is already shown (inactive). */
export const meetingPromptShow = defineEvent('meetingPrompt.show', { payload: empty });

/**
 * Main tells the popup page to leave. `animated` is false after Start, where the window goes
 * away at once, and true for a dismiss, the auto-hide and a recording start.
 */
export const meetingPromptHide = defineEvent('meetingPrompt.hide', {
  payload: z.object({ animated: z.boolean() }),
});

/** Start taking notes: brings the main window forward and opens a blank take. */
export const meetingPromptStart = defineRequest('meetingPrompt.start', {
  input: empty,
  output: done,
});

/** Close the popup with its exit animation. */
export const meetingPromptDismiss = defineRequest('meetingPrompt.dismiss', {
  input: empty,
  output: done,
});

/** Close the popup and turn the call popup setting off. */
export const meetingPromptNeverAgain = defineRequest('meetingPrompt.neverAgain', {
  input: empty,
  output: done,
});

/** A call was detected: the main window may show its in-app call bar. */
export const workspaceCallPromptOffered = defineEvent('workspace.callPromptOffered', {
  payload: empty,
});

/** The call popup setting changed outside the Settings page (Never again). */
export const settingsMeetingPopupChanged = defineEvent('settings.meetingPopupChanged', {
  payload: z.object({ enabled: z.boolean() }),
});
