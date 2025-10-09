// Простая обёртка над IndexedDB для очереди офлайн-операций

const DB_NAME = 'gotamilk_offline';
const DB_VERSION = 1;
const STORE_OPS = 'ops';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OPS)) {
        const store = db.createObjectStore(STORE_OPS, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putOp(op) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OPS, 'readwrite');
    tx.objectStore(STORE_OPS).put(op);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOpsByStatus(status = 'pending') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OPS, 'readonly');
    const index = tx.objectStore(STORE_OPS).index('status');
    const req = index.getAll(status);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function updateOpStatus(id, status, extra = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OPS, 'readwrite');
    const store = tx.objectStore(STORE_OPS);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const op = getReq.result;
      if (!op) return resolve();
      store.put({ ...op, status, ...extra });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function countPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OPS, 'readonly');
    const index = tx.objectStore(STORE_OPS).index('status');
    const req = index.getAllKeys('pending');
    req.onsuccess = () => resolve((req.result || []).length);
    req.onerror = () => reject(req.error);
  });
}


