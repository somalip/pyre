/**
 * pyre Firebase Sync — Firestore backend for `pyre sync`.
 *
 * Stores each machine's config and profiles as a single document in the
 * `pyre-sync` Firestore collection, keyed by hostname (or a user-defined ID).
 *
 * Data model:
 *   pyre-sync/{hostId}
 *     version:       number
 *     lastUpdated:   ISO string
 *     sourceHost:    string
 *     checksum:      string
 *     profilesCount: number
 *     config:        PyreConfig
 *     profiles:      { [name: string]: PyreConfig }
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
  Firestore,
} from 'firebase/firestore';
import type { PyreConfig } from './state/config.js';

// ─── Firebase project config ──────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAA86V_wRGJpzc27ZHZd1OBIt4Q-72ASdI',
  authDomain: 'dearborn-internal-tool.firebaseapp.com',
  projectId: 'dearborn-internal-tool',
  storageBucket: 'dearborn-internal-tool.firebasestorage.app',
  messagingSenderId: '77553447918',
  appId: '1:77553447918:web:5c9128660ceeb087c794ff',
};

const COLLECTION = 'pyre-sync';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FirebaseSyncDoc {
  version: number;
  lastUpdated: string;
  sourceHost: string;
  checksum: string;
  profilesCount: number;
  config: PyreConfig;
  profiles: Record<string, PyreConfig>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

let _db: Firestore | null = null;

/** Lazily initialise Firebase (idempotent). */
function getDb(): Firestore {
  if (_db) return _db;
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  _db = getFirestore(app);
  return _db;
}

function computeChecksum(config: PyreConfig, profiles: Record<string, PyreConfig>): string {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(config));
  hash.update(JSON.stringify(profiles));
  return hash.digest('hex').slice(0, 16);
}

function resolveHostId(hostId?: string): string {
  return (hostId || os.hostname()).replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Push local config + profiles to Firestore.
 */
export async function firebasePush(
  config: PyreConfig,
  profiles: Record<string, PyreConfig>,
  hostId?: string,
): Promise<{ hostId: string; checksum: string; lastUpdated: string }> {
  const db = getDb();
  const id = resolveHostId(hostId);
  const checksum = computeChecksum(config, profiles);
  const lastUpdated = new Date().toISOString();

  const payload: FirebaseSyncDoc = {
    version: 1,
    lastUpdated,
    sourceHost: os.hostname(),
    checksum,
    profilesCount: Object.keys(profiles).length,
    config,
    profiles,
  };

  await setDoc(doc(db, COLLECTION, id), payload);
  return { hostId: id, checksum, lastUpdated };
}

/**
 * Pull config + profiles from Firestore.
 * If hostId is provided, fetches that specific machine's document.
 * Otherwise fetches the most-recently-updated document across all hosts.
 */
export async function firebasePull(hostId?: string): Promise<{
  doc: FirebaseSyncDoc;
  hostId: string;
} | null> {
  const db = getDb();

  if (hostId) {
    const id = resolveHostId(hostId);
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return null;
    return { doc: snap.data() as FirebaseSyncDoc, hostId: id };
  }

  // No hostId — grab the most-recently-updated doc across all hosts
  const q = query(collection(db, COLLECTION), orderBy('lastUpdated', 'desc'), limit(1));
  const snaps = await getDocs(q);
  if (snaps.empty) return null;
  const first = snaps.docs[0];
  return { doc: first.data() as FirebaseSyncDoc, hostId: first.id };
}

/**
 * List all sync documents (one per machine) sorted newest-first.
 */
export async function firebaseStatus(): Promise<
  Array<{ hostId: string; sourceHost: string; lastUpdated: string; profilesCount: number; checksum: string }>
> {
  const db = getDb();
  const q = query(collection(db, COLLECTION), orderBy('lastUpdated', 'desc'));
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => {
    const data = d.data() as FirebaseSyncDoc;
    return {
      hostId: d.id,
      sourceHost: data.sourceHost,
      lastUpdated: data.lastUpdated,
      profilesCount: data.profilesCount,
      checksum: data.checksum,
    };
  });
}
