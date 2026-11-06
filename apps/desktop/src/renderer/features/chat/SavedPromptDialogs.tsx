import { DeletePromptDialog, PromptDialog } from './PromptDialog';
import type { PromptLibrary } from './use-prompt-library';

/** After a dialog closes the flyout button that opened it is gone: the caret goes home. */
const focusComposer = (): void => {
  setTimeout(() => {
    document.getElementById('TxtMeetingChat')?.focus();
  }, 0);
};

/** The saved prompt editor and the delete question, when one is open. */
export function SavedPromptDialogs({ library }: { readonly library: PromptLibrary }) {
  const { editor, deleting } = library;
  return (
    <>
      {editor ? (
        <PromptDialog
          request={editor}
          onSave={library.save}
          onClose={() => {
            library.closeEditor();
            focusComposer();
          }}
        />
      ) : null}
      {deleting ? (
        <DeletePromptDialog
          name={deleting.name}
          onClose={() => {
            library.closeDelete();
            focusComposer();
          }}
          onConfirm={() => {
            library.confirmDelete();
            focusComposer();
          }}
        />
      ) : null}
    </>
  );
}
