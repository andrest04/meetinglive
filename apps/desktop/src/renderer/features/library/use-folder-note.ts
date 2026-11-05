import type { FolderDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { folderIdOfView, registerFolderNote, useLibraryStore } from './library-store';

/** Idle time after the last keystroke before the folder note is stored. */
export const NOTE_AUTOSAVE_MS = 400;

function noteOf(folder: FolderDto | undefined): string {
  return folder?.note ?? '';
}

export interface FolderNote {
  readonly noteText: string;
  readonly setNoteText: (value: string) => void;
  readonly saveNote: () => Promise<void>;
}

/**
 * The note of the selected folder, while the route is open. It keeps its own copy of what is stored
 * because it must outlive a render: unload handlers and async callbacks read live values (B16).
 */
export function useFolderNote(): FolderNote {
  const [initial] = useState(() => {
    const { folders, view } = useLibraryStore.getState();
    const id = folderIdOfView(view);
    return { folders, id, text: noteOf(folders.find((f) => f.id === id)) };
  });
  const [noteText, setNoteTextState] = useState(initial.text);
  const foldersRef = useRef<readonly FolderDto[]>(initial.folders);
  const ownerRef = useRef<string | null>(initial.id);
  const noteRef = useRef(initial.text);
  const typedAtLoadStart = useRef(initial.text);

  const setNoteText = useCallback((value: string) => {
    noteRef.current = value;
    setNoteTextState(value);
  }, []);

  /** Spec 3.13 PersistSelectedFolderNote: trimmed, blank is null, unchanged is a no-op. */
  const saveNote = useCallback(async (): Promise<void> => {
    const id = ownerRef.current;
    if (id === null) return;
    const folder = foldersRef.current.find((f) => f.id === id);
    if (!folder) return;
    const text = noteRef.current.trim();
    const next = text === '' ? null : text;
    if (next === folder.note) return;
    // Remember what was stored right away: the change event that follows reloads, and that reload
    // must not find the note still "unsaved" and save it again.
    foldersRef.current = foldersRef.current.map((f) => (f.id === id ? { ...f, note: next } : f));
    const result = await window.vozella.invoke('library.setFolderNote', { id, note: next });
    if (!result.ok) {
      foldersRef.current = foldersRef.current.map((f) =>
        f.id === id ? { ...f, note: folder.note } : f,
      );
    }
  }, []);

  useEffect(
    () =>
      registerFolderNote({
        beforeLoad: async () => {
          await saveNote();
          // What the user had typed when the load began: a character typed while the load is in
          // flight must survive the reply (B16).
          typedAtLoadStart.current = noteRef.current;
        },
        afterLoad: (folders, selected) => {
          foldersRef.current = folders;
          ownerRef.current = selected?.id ?? null;
          // The save above made the stored note match the text box, so only a different folder or
          // an outside edit changes it; never rewrite what the user is typing.
          if (
            noteRef.current === typedAtLoadStart.current &&
            noteRef.current.trim() !== noteOf(selected).trim()
          ) {
            setNoteText(noteOf(selected));
          }
        },
        leave: saveNote,
        entered: (selected) => {
          ownerRef.current = selected?.id ?? null;
          setNoteText(noteOf(selected));
        },
      }),
    [saveNote, setNoteText],
  );

  // Autosave while typing (B16): a window closed from the last-window path destroys the renderer
  // before a page-hide invoke can reach main, so the note must already be stored by then.
  useEffect(() => {
    const timer = setTimeout(() => {
      void saveNote();
    }, NOTE_AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [noteText, saveNote]);

  // The save of the note when the page goes away (B16).
  useEffect(() => {
    const flush = (): void => {
      void saveNote();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [saveNote]);

  return { noteText, setNoteText, saveNote };
}
