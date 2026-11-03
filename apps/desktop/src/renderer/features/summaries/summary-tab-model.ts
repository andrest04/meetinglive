import type { SummaryTabStateDto } from '@vozella/contracts';

export type ActionItemDto = SummaryTabStateDto['actionItems'][number];
export type NotesMode = 'notes' | 'enhanced';
