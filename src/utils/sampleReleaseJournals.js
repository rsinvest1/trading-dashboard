// Bundled sample release-journal packages, so "Import Auto Journal" works with
// one click (no filesystem picker needed for Phase 1). These are the SAME JSON
// files the separate worker emits — imported straight from the worker's samples
// folder so there's a single source of truth.
//
// They are seed/sample data, not production data: importing one just adds a
// reviewable journal to the store; it touches nothing else.

import rtyNq from '../../release-journal-worker/samples/sample-rty-nq-relative-strength.json';
import ism from '../../release-journal-worker/samples/sample-us-ism-manufacturing-pmi.json';
import euPmis from '../../release-journal-worker/samples/sample-eu-pmis.json';
import { normalizeReleaseJournal } from './releaseJournalSchema';

export const SAMPLE_RELEASE_JOURNALS = [rtyNq, ism, euPmis].map(normalizeReleaseJournal);
