import fs from 'node:fs';
import path from 'node:path';

export interface SeedMeeting {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
  readonly summary?: string;
  readonly transcript?: string;
  /** Directory under the library root; Inbox by default. */
  readonly directory?: string;
  readonly folderId?: string;
}

/** Writes a meeting the way the app stores it, into a throwaway library root. */
export function writeMeeting(libraryRoot: string, meeting: SeedMeeting): string {
  const directory = path.join(libraryRoot, meeting.directory ?? 'Inbox');
  fs.mkdirSync(directory, { recursive: true });
  const lines = [
    '---',
    `id: ${meeting.id}`,
    `title: ${meeting.title}`,
    `recordedAt: ${meeting.recordedAt}`,
    'audioFilePath: ',
    ...(meeting.folderId ? [`folderId: ${meeting.folderId}`] : []),
    '---',
    '',
  ];
  if (meeting.transcript) lines.push('## Transcript', '', meeting.transcript, '');
  if (meeting.summary) lines.push('## Summary', '', meeting.summary, '');
  const stem = `${meeting.recordedAt.slice(0, 10)} ${meeting.title}`;
  const file = path.join(directory, `${stem}.md`);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}
