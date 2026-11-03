const BROWSERS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi']);
const MEET_CODE = /\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i;
// Word boundaries (B8): "Calls | Microsoft Teams" is not a call, "Call with Ana" is.
const TEAMS_CALL = /\b(?:meeting|call)\b/i;

/** Pure port of MeetingCallDetector.IsMeeting (spec 3.15). */
export function isMeeting(processName: string, windowTitle: string): boolean {
  const proc = processName.trim().toLowerCase();
  if (proc === '') return false;
  const title = windowTitle;
  const lower = title.toLowerCase();
  if (proc === 'cpthost') return true;
  if (proc === 'zoom') return lower.includes('zoom meeting') || lower.includes('zoom webinar');
  if (proc === 'teams' || proc === 'ms-teams') return TEAMS_CALL.test(title);
  if (BROWSERS.has(proc)) return MEET_CODE.test(title) && lower.includes('meet');
  return false;
}
