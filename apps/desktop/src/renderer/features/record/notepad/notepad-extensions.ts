import type { AnyExtension } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';

/**
 * The notepad's schema: paragraphs, headings 1 to 3, bold, italic, strike, code, code blocks,
 * bullet, ordered and task lists, blockquote, horizontal rule and links. Markdown is the only
 * stored form, so nothing is enabled that Markdown cannot say (no underline, no colors).
 */
export function notepadExtensions(placeholder = ''): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      underline: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown,
    Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
  ];
}
