import { createReactBlockSpec } from '@blocknote/react';

// Kept only to read legacy schemas. PageEditor excludes these blocks before
// mounting, and retains their raw records when saving user edits.
export const createCaptureRefBlockSpec = createReactBlockSpec(
  { type: 'captureRef', propSchema: { captureId: { default: '' } }, content: 'none' },
  { render: () => <></>, toExternalHTML: () => <></> },
);
