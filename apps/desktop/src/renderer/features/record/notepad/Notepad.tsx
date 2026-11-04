import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { notepadExtensions } from './notepad-extensions';
import './notepad.css';

export interface NotepadProps {
  /** The text main holds. Re-seeded into the editor only while the editor is not focused. */
  readonly value: string;
  /** Called with the Markdown, debounced while typing and at once on blur and unmount. */
  readonly onChange: (markdown: string) => void;
  readonly label: string;
  readonly placeholder: string;
  readonly debounceMs?: number;
}

const compact = (markdown: string): string => markdown.trim();

/**
 * The session notes: a TipTap editor whose value is Markdown text. It never fights typing: the
 * editor is the truth while it has focus, and main's copy only replaces it when focus is
 * elsewhere (a new take clears the notes).
 */
export function Notepad({ value, onChange, label, placeholder, debounceMs = 250 }: NotepadProps) {
  const extensions = useMemo(() => notepadExtensions(placeholder), [placeholder]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const editor = useEditor({
    extensions,
    content: value === '' ? '' : value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        id: 'TxtRecordingNotes',
        'data-testid': 'TxtRecordingNotes',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        spellcheck: 'true',
      },
    },
    onUpdate: () => {
      dirty.current = true;
      schedule();
    },
    onBlur: () => {
      flush();
    },
  });

  const read = (): string => (editor.isEmpty ? '' : compact(editor.getMarkdown()));

  function flush(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    const text = read();
    onChangeRef.current(text);
  }

  function schedule(): void {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, debounceMs);
  }

  // Keep the latest flush reachable from the unmount cleanup.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      flushRef.current();
    },
    [],
  );

  useEffect(() => {
    if (editor.isFocused || dirty.current) return;
    const next = compact(value);
    if (next === read()) return;
    editor.commands.setContent(next, { contentType: 'markdown', emitUpdate: false });
  }, [value, editor]);

  return (
    <div className="notepad" data-testid="notepad">
      <EditorContent editor={editor} />
    </div>
  );
}
