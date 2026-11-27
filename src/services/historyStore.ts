import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
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

export function subscribeRecentAnalyses(
  onData: (items: SavedAnalysis[]) => void,
  onError?: (err: Error) => void,
  onlyMyWorkspace = true
): () => void {
  const myWorkspaceId = getWorkspaceId();
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'), limit(24));
  return onSnapshot(
    q,
    (snap) => {
      const all: SavedAnalysis[] = snap.docs.map((dSnap) => {
        const d = dSnap.data();
        return {
          id: dSnap.id,
          workspaceId: String(d.workspaceId || 'legacy'),
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
      });
      const filtered = onlyMyWorkspace
        ? all.filter((item) => item.workspaceId === myWorkspaceId)
        : all;
      onData(filtered.slice(0, 8));
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}
