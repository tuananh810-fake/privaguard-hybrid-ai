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

export async function saveAnonymizedAnalysis(
  entry: Omit<SavedAnalysis, 'id' | 'createdAt'>
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), {
    ...entry,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteSavedAnalysis(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

export function subscribeRecentAnalyses(
  onData: (items: SavedAnalysis[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'), limit(8));
  return onSnapshot(
    q,
    (snap) => {
      const items: SavedAnalysis[] = snap.docs.map((dSnap) => {
        const d = dSnap.data();
        return {
          id: dSnap.id,
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
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}
