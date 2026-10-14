// Run only in the intended Preview environment. Initializes the dedicated Notes
// History worksheet/header if absent, but never creates or changes note records.
import { readNotes, spreadsheetId } from '../app/lib/command-center/store.ts';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview environment required.');
spreadsheetId();
try {
  await readNotes();
  console.log('COMMAND_CENTER_CHECK: configured spreadsheet accessible; Notes History schema verified. No note records written.');
} catch (error) {
  console.error('COMMAND_CENTER_CHECK:', error instanceof Error ? error.message : 'Storage verification failed.');
  process.exitCode = 1;
}
