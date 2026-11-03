import { Editor } from '@tiptap/core';
import { notepadExtensions } from './notepad-extensions';

let engine: Editor | null = null;

/** One headless editor converts every string; it is created on first use. */
function headless(): Editor {
  engine ??= new Editor({ extensions: notepadExtensions(), content: '' });
  return engine;
}

/** Windows line ends and lone CRs become LF; the editor and the file format both use LF. */
export function normalizeNotes(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Markdown text -> Markdown text, as the editor would store it after loading the text. */
export function canonicalNotes(markdown: string): string {
  const editor = headless();
  editor.commands.setContent(normalizeNotes(markdown), { contentType: 'markdown' });
  return editor.getMarkdown();
}

/** What is saved: the canonical text, or null when nothing but whitespace is there. */
export function notesForSave(markdown: string): string | null {
  if (markdown.trim() === '') return null;
  const text = canonicalNotes(markdown).trim();
  return text === '' ? null : text;
}
