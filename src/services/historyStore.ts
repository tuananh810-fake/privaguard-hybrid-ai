import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { app } from '../firebase';

export interface SavedAnalysis {
  id: string;
  ownerUid: string;
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

const db = getFirestore(app);
const auth = getAuth(app);

let cachedUid: string | null = null;
let authPromise: Promise<string | null> | null = null;

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

/**
 * Ensures the browser has a Firebase Anonymous Auth UID for owner-scoped Firestore rules.
 * Gracefully falls back to null if Anonymous Auth is not yet enabled in Firebase Console.
 */
export async function ensureAnonymousUid(): Promise<string | null> {
  if (cachedUid) return cachedUid;
  if (auth.currentUser?.uid) {
    cachedUid = auth.currentUser.uid;
    return cachedUid;
  }
  if (!authPromise) {
    authPromise = (async () => {
      try {
        const existing = await new Promise<string | null>((resolve) => {
          const unsub = onAuthStateChanged(auth, (u) => {
            unsub();
            resolve(u?.uid ?? null);
          });
        });
        if (existing) {
          cachedUid = existing;
          return existing;
        }
        const cred = await signInAnonymously(auth);
        cachedUid = cred.user.uid;
        return cachedUid;
      } catch {
        return null;
      }
    })();
  }
  return authPromise;
}

export async function saveAnonymizedAnalysis(
  entry: Omit<SavedAnalysis, 'id' | 'ownerUid' | 'workspaceId' | 'createdAt'>
): Promise<string> {
  const uid = await ensureAnonymousUid();
  const workspaceId = getWorkspaceId();
  const ref = await addDoc(collection(db, COLLECTION), {
    ...entry,
    ownerUid: uid || workspaceId,
    workspaceId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteSavedAnalysis(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

/**
 * Owner-scoped Firestore subscription (using Anonymous Auth UID when available,
 * falling back to local workspaceId). Single-field query requires zero composite indexes.
 */
export function subscribeRecentAnalyses(
  onData: (items: SavedAnalysis[]) => void,
  onError?: (err: Error) => void
): () => void {
  let cancelled = false;
  let unsubSnap: (() => void) | null = null;

  ensureAnonymousUid().then((uid) => {
    if (cancelled) return;
    const workspaceId = getWorkspaceId();
    const q = uid
      ? query(collection(db, COLLECTION), where('ownerUid', '==', uid))
      : query(collection(db, COLLECTION), where('workspaceId', '==', workspaceId));

    unsubSnap = onSnapshot(
      q,
      (snap) => {
        const items: SavedAnalysis[] = snap.docs
          .map((dSnap) => {
            const d = dSnap.data();
            return {
              id: dSnap.id,
              ownerUid: String(d.ownerUid || uid || workspaceId),
              workspaceId: String(d.workspaceId || workspaceId),
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
  });

  return () => {
    cancelled = true;
    unsubSnap?.();
  };
}
