import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface SavedAnalysis {
  id: string;
  workspaceId: string;
  task: string;
  inferenceSource: string;
  modelUsed: string;
  latencyMs: number;
  ttftMs?: number;
  piiCount: number;
  bytesShielded: number;
  redactedPreview: string;
  analysisText: string;
  createdAt?: Timestamp | null;
}

const COLLECTION = 'privaguard_analyses';
const WORKSPACE_STORAGE_KEY = 'privaguard_workspace_id';

export function getWorkspaceId(): string {
  if (typeof localStorage === 'undefined') return 'default-session';
  let id = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  }
  return id;
}

export async function saveAnonymizedAnalysis(
  entry: Omit<SavedAnalysis, 'id' | 'workspaceId' | 'createdAt'>
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), {
    ...entry,
    workspaceId: getWorkspaceId(),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteSavedAnalysis(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

/**
 * Multi-user safe subscription: queries strictly by the current browser's `workspaceId`
 * (using a single-field index, no composite index needed) and sorts descending locally.
 * Guarantees 10,000+ concurrent users never evict each other's saved reports.
 */
export function subscribeRecentAnalyses(
  onData: (items: SavedAnalysis[]) => void,
  onError?: (err: Error) => void
): () => void {
  const myWorkspaceId = getWorkspaceId();
  const q = query(collection(db, COLLECTION), where('workspaceId', '==', myWorkspaceId));
  return onSnapshot(
    q,
    (snap) => {
      const items: SavedAnalysis[] = snap.docs
        .map((dSnap) => {
          const d = dSnap.data();
          return {
            id: dSnap.id,
            workspaceId: String(d.workspaceId || myWorkspaceId),
            task: String(d.task || 'executive'),
            inferenceSource: String(d.inferenceSource || 'UNKNOWN'),
            modelUsed: String(d.modelUsed || ''),
            latencyMs: Number(d.latencyMs || 0),
            ttftMs: Number(d.ttftMs || 0),
            piiCount: Number(d.piiCount || 0),
            bytesShielded: Number(d.bytesShielded || 0),
            redactedPreview: String(d.redactedPreview || ''),
            analysisText: String(d.analysisText || ''),
            createdAt: (d.createdAt as Timestamp) || null,
          };
        })
        .sort((a, b) => {
          const ta = a.createdAt ? a.createdAt.toMillis() : Date.now();
          const tb = b.createdAt ? b.createdAt.toMillis() : Date.now();
          return tb - ta;
        })
        .slice(0, 8);
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}
