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

/**
 * The popup page finished starting and listens to the events. Main answers whether the popup is
 * showing now, so a show sent before the page was listening is not lost.
 */
export const meetingPromptReady = defineRequest('meetingPrompt.ready', {
  input: empty,
  output: z.object({ shown: z.boolean() }),
});

/**
 * The pointer entered (`inside` true) or left the popup card. Main owns the auto-hide timer, so
 * it pauses while the pointer is over the card and restarts when it leaves.
 */
export const meetingPromptHover = defineRequest('meetingPrompt.hover', {
  input: z.object({ inside: z.boolean() }),
  output: done,
});

/** A call was detected: the main window may show its in-app call bar. */
export const workspaceCallPromptOffered = defineEvent('workspace.callPromptOffered', {
  payload: empty,
});

/**
 * The call that raised the in-app bar is over, or a recording started: the bar has nothing left
 * to offer and closes (parity 38). Sent whether or not the floating popup was showing.
 */
export const workspaceCallPromptClosed = defineEvent('workspace.callPromptClosed', {
  payload: z.object({ reason: z.enum(['callEnded', 'recordingStarted']) }),
});

/** The call popup setting changed outside the Settings page (Never again). */
export const settingsMeetingPopupChanged = defineEvent('settings.meetingPopupChanged', {
  payload: z.object({ enabled: z.boolean() }),
});
