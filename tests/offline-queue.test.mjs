import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { IDBFactory } from 'fake-indexeddb';

const queueSource = ts.transpileModule(readFileSync(new URL('../lib/offline/queue.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
let tabNumber = 0;
async function newTab() {
  // Each browser tab evaluates its own module and must get an independent lease owner.
  return import(`data:text/javascript;base64,${Buffer.from(queueSource).toString('base64')}#tab-${++tabNumber}`);
}
const owner = 'person-a';
const video = (bytes = 32) => new File([new Uint8Array(bytes)], 'saha.mp4', { type: 'video/mp4' });
const ok = (body = {}) => Response.json({ ok: true, ...body });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  const events = new EventTarget();
  globalThis.window = {
    dispatchEvent: events.dispatchEvent.bind(events),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    setInterval, clearInterval,
  };
  globalThis.fetch = async () => { throw new Error('Unexpected unmocked network request'); };
});

async function storedItems(name = 'kagu-saha-offline-v11') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending-items', { keyPath: 'id' });
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('pending-items', 'readonly');
      const read = transaction.objectStore('pending-items').getAll();
      transaction.oncomplete = () => { database.close(); resolve(read.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}
async function addLegacy(item, name = 'kagu-saha-offline-v11') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending-items', { keyPath: 'id' });
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('pending-items', 'readwrite');
      transaction.objectStore('pending-items').add(item);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

test('request success followed by transaction abort never reports a safely saved event/media draft', async () => {
  const queue = await newTab();
  const factory = indexedDB;
  let abortNextWrite = true;
  globalThis.indexedDB = {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => {
        const database = request.result;
        const transaction = database.transaction.bind(database);
        database.transaction = (...transactionArgs) => {
          const tx = transaction(...transactionArgs);
          if (transactionArgs[1] === 'readwrite' && abortNextWrite) {
            abortNextWrite = false;
            const objectStore = tx.objectStore.bind(tx);
            tx.objectStore = (...storeArgs) => {
              const store = objectStore(...storeArgs);
              const add = store.add.bind(store);
              store.add = (...addArgs) => {
                const write = add(...addArgs);
                write.addEventListener('success', () => tx.abort(), { once: true });
                return write;
              };
              return store;
            };
          }
          return tx;
        };
      });
      return request;
    },
  };
  await assert.rejects(queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'İş tamamlandı', files: [video()] }));
  globalThis.indexedDB = factory;
  assert.deepEqual(await storedItems(), []);
});

test('owned records stay isolated and ownerless legacy records are preserved without automatic adoption', async () => {
  const queue = await newTab();
  await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'a-task', projectId: 'site', eventType: 'NOTE', note: 'A' });
  await queue.enqueuePersonnelEvent({ userId: 'person-b', taskId: 'b-task', projectId: 'site', eventType: 'NOTE', note: 'B' });
  const legacy = { id: 'old-record', type: 'NOTE', taskId: 'old-task', note: 'Legacy', createdAt: '2026-09-01T00:00:00Z' };
  await addLegacy(legacy);
  assert.equal((await queue.listOfflineItems(['PERSONNEL'], owner)).length, 1);
  assert.deepEqual(await queue.listOfflineItems(['PERSONNEL']), []);
  assert.equal(await queue.countLegacyOfflineItems(), 1);
  const sent = [];
  globalThis.fetch = async (url, options) => { assert.equal(url, '/api/offline/sync'); sent.push(JSON.parse(options.body)); return ok(); };
  const result = await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.equal(result.synced, 1);
  assert.deepEqual(sent.map((item) => item.taskId), ['a-task']);
  const remaining = await storedItems();
  assert.deepEqual(remaining.find((item) => item.id === legacy.id), legacy);
  assert.equal(remaining.filter((item) => item.userId === 'person-b').length, 1);
});

test('a permanently rejected file remains available locally instead of being removed', async () => {
  const queue = await newTab();
  const { media } = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Not', files: [video(128)] });
  await queue.replaceOfflineItemFiles(media[0].id, [video(128)], { userId: owner });
  globalThis.fetch = async (url) => url === '/api/offline/sync' ? ok() : Response.json({ ok: false, error: 'Dosya boyutu reddedildi.' }, { status: 413 });
  const result = await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.equal(result.synced, 1);
  assert.deepEqual(result.failedIds, [media[0].id]);
  const [failed] = await queue.listOfflineItems(['PERSONNEL'], owner);
  assert.equal(failed.id, media[0].id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.files[0].size, 128);
  assert.equal(failed.expectedFileCount, 1);
  assert.match(failed.lastError, /reddedildi/);
});

test('V1 open tabs cannot see V1.1 jobs and legacy drafts stay in their original database', async () => {
  const queue = await newTab();
  const legacy = { id: 'original-v1-draft', type: 'VISIT_FILE', projectId: 'site', files: [video()], createdAt: '2026-09-29T10:00:00Z' };
  await addLegacy(legacy, 'kagu-saha-offline');
  await queue.enqueueVisitUploads({ userId: owner, projectId: 'site', files: [video()] });
  const original = await storedItems('kagu-saha-offline');
  assert.equal(original.length, 1); assert.equal(original[0].id, legacy.id);
  assert.equal(await queue.countLegacyOfflineItems(), 1);
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner)).length, 1);
  globalThis.fetch = async () => Response.json({ error: 'Yetkisiz' }, { status: 403 });
  await assert.rejects(() => queue.readLegacyOfflineItemsForRecovery());
  globalThis.fetch = async () => ok();
  const recovery = await queue.readLegacyOfflineItemsForRecovery();
  assert.equal(recovery.length, 1); assert.equal(recovery[0].id, legacy.id);
  assert.equal(recovery[0].files[0].size, legacy.files[0].size);
  assert.equal((await storedItems('kagu-saha-offline')).length, 1);
});

test('a blocked pass does not repeatedly wake sync; a cancelled server session retains files and renews identity', async () => {
  const queue = await newTab();
  const first = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Hata' });
  globalThis.fetch = async () => Response.json({ ok: false, error: 'Geçersiz not.' }, { status: 422 });
  await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.equal(await queue.hasPendingPersonnelNote(owner, 'task'), false);
  let wakeups = 0;
  window.addEventListener('kagu-queue-changed', () => wakeups++);
  await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.equal(wakeups, 0);
  await queue.deleteOfflineItem(first.event.id, owner);
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
  await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  globalThis.fetch = async () => ok({ uploadId: 'expired', status: 'CANCELLED', sizeBytes: 32, offsetBytes: 0 });
  await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  const [retained] = await queue.listOfflineItems(['VISIT_UPLOAD'], owner);
  assert.equal(retained.status, 'PENDING'); assert.equal(retained.files[0].size, 32); assert.ok(retained.uploadGeneration);
});

test('file dependency waits for its note; another task note is not blocked by that failed note', async () => {
  const queue = await newTab();
  const first = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'first-task', projectId: 'site', eventType: 'NOTE', note: 'Not', files: [video()] });
  await queue.replaceOfflineItemFiles(first.media[0].id, [video()], { userId: owner });
  await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'second-task', projectId: 'site', eventType: 'NOTE', note: 'Diğer not' });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, JSON.parse(options.body)]);
    if (url === '/api/offline/sync' && calls.at(-1)[1].taskId === 'first-task') return Response.json({ ok: false, error: 'Not doğrulanamadı.' }, { status: 422 });
    assert.equal(url, '/api/offline/sync', 'Media must not begin before its failed note is accepted');
    return ok();
  };
  await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.deepEqual(calls.map(([, item]) => item.taskId).sort(), ['first-task', 'second-task']);
  const records = await queue.listOfflineItems(['PERSONNEL'], owner);
  assert.equal(records.find((item) => item.id === first.event.id).status, 'FAILED');
  assert.equal(records.find((item) => item.id === first.media[0].id).files[0].size, 32);
});

test('a newly saved note can sync while a previous video transfer is still waiting', { timeout: 5000 }, async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
  await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  const started = deferred();
  const release = deferred();
  const notes = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/offline/sync') { notes.push(JSON.parse(options.body)); return ok(); }
    if (url === '/api/uploads') return ok({ uploadId: 'upload', offsetBytes: 0, sizeBytes: 32, status: 'OPEN' });
    if (options?.method === 'PATCH') { started.resolve(); await release.promise; return ok({ uploadId: 'upload', offsetBytes: 32, sizeBytes: 32, status: 'OPEN' }); }
    if (url.endsWith('/finalize')) return ok();
    throw new Error(`Unexpected URL ${url}`);
  };
  const mediaSync = queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD', 'PERSONNEL'] });
  await started.promise;
  const next = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Video beklemeden kaydedilen not', files: [video()] });
  try {
    const noteResult = await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'], eventsOnly: true });
    assert.equal(noteResult.synced, 1);
    assert.equal(notes[0].clientItemId, next.event.id);
    assert.equal((await queue.listOfflineItems(['PERSONNEL'], owner)).some((pending) => pending.id === next.media[0].id), true);
  } finally { release.resolve(); await mediaSync; }
});

test('two independent tabs use the durable claim so only one uploads the same queued file', { timeout: 5000 }, async () => {
  const first = await newTab();
  const second = await newTab();
  const item = await first.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
  await first.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  const started = deferred();
  const release = deferred();
  let uploadInitializations = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') { uploadInitializations++; started.resolve(); await release.promise; return ok({ uploadId: 'upload', offsetBytes: 32, sizeBytes: 32, status: 'OPEN' }); }
    assert.equal(url, '/api/uploads/upload/finalize');
    return ok();
  };
  const firstSync = first.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  await started.promise;
  try {
    const secondResult = await second.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
    assert.equal(secondResult.synced, 0);
    assert.equal(uploadInitializations, 1);
    assert.equal((await first.listOfflineItems(['VISIT_UPLOAD'], owner)).length, 1);
  } finally { release.resolve(); await firstSync; }
});

test('a lost response after a committed chunk resumes from the server offset without resending prior bytes', async () => {
  const queue = await newTab();
  const bytes = 3 * 512 * 1024;
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video(bytes)] });
  await queue.replaceOfflineItemFiles(item.id, [video(bytes)], { userId: owner });
  let offset = 0;
  let loseResponse = true;
  let committedBeforeResume = 0;
  const sentOffsets = [];
  const clientIds = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') {
      clientIds.push(JSON.parse(options.body).clientUploadId);
      return ok({ uploadId: 'upload', offsetBytes: offset, sizeBytes: bytes, status: 'OPEN' });
    }
    if (options?.method === 'PATCH') {
      const sent = Number(options.headers['Upload-Offset']);
      assert.equal(sent, offset);
      sentOffsets.push(sent);
      offset += options.body.size;
      if (loseResponse && sentOffsets.length === 2) { loseResponse = false; committedBeforeResume = offset; throw new TypeError('Network lost after commit'); }
      return ok({ uploadId: 'upload', offsetBytes: offset, sizeBytes: bytes, status: 'OPEN' });
    }
    assert.equal(url, '/api/uploads/upload/finalize');
    return ok();
  };
  const interrupted = await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  assert.equal(interrupted.synced, 0);
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner)).length, 1);
  const resumed = await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true });
  assert.equal(resumed.synced, 1);
  assert.equal(sentOffsets[2], committedBeforeResume);
  assert.equal(new Set(sentOffsets).size, sentOffsets.length);
  assert.equal(offset, bytes);
  assert.equal(new Set(clientIds).size, 1);
  assert.deepEqual(await queue.listOfflineItems(['VISIT_UPLOAD'], owner), []);
});

test('a live event claim is not sent a second time by a simultaneous eventsOnly sync in the same tab', { timeout: 5000 }, async () => {
  const queue = await newTab();
  await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Tek kayıt' });
  const started = deferred();
  const release = deferred();
  let sends = 0;
  globalThis.fetch = async () => { sends++; started.resolve(); await release.promise; return ok(); };
  const firstSync = queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  await started.promise;
  const secondSync = queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'], eventsOnly: true });
  try {
    // Let the second IndexedDB transaction either see the lease or attempt its request.
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(sends, 1);
  } finally { release.resolve(); await Promise.all([firstSync, secondSync]); }
});

test('account mismatch responses preserve the draft and every new request declares the original owner', async () => {
  const queue = await newTab();
  const draft = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'A kullanıcısının notu' });
  let request;
  globalThis.fetch = async (url, options) => {
    request = JSON.parse(options.body);
    return Response.json({ ok: false, error: 'Hesap değişti.' }, { status: 401 });
  };
  await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.equal(request.ownerUserId, owner);
  const [retained] = await queue.listOfflineItems(['PERSONNEL'], owner);
  assert.equal(retained.id, draft.event.id);
  assert.equal(retained.note, 'A kullanıcısının notu');
  assert.equal(retained.status, 'PENDING');
  assert.deepEqual(await queue.listOfflineItems(['PERSONNEL'], 'person-b'), []);
});

test('reselecting a failed file keeps the draft identity but uses a fresh upload generation', async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video(32)] });
  await queue.replaceOfflineItemFiles(item.id, [video(32)], { userId: owner });
  const clientIds = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') {
      const input = JSON.parse(options.body);
      assert.equal(input.ownerUserId, owner);
      clientIds.push(input.clientUploadId);
      if (input.sizeBytes === 32) return Response.json({ ok: false, error: 'Dosya reddedildi.' }, { status: 422 });
      return ok({ uploadId: 'replacement', offsetBytes: input.sizeBytes, sizeBytes: input.sizeBytes, status: 'OPEN' });
    }
    assert.equal(url, '/api/uploads/replacement/finalize');
    return ok();
  };
  await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  await assert.rejects(() => queue.replaceOfflineItemFiles(item.id, [video(64)], { userId: 'person-b', resetUpload: true }));
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner))[0].files[0].size, 32);
  await queue.replaceOfflineItemFiles(item.id, [video(64)], { userId: owner, resetUpload: true });
  const [updated] = await queue.listOfflineItems(['VISIT_UPLOAD'], owner);
  assert.equal(updated.id, item.id);
  assert.equal(updated.status, 'PENDING');
  const result = await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true });
  assert.equal(result.synced, 1);
  assert.equal(clientIds.length, 2);
  assert.notEqual(clientIds[0], clientIds[1]);
});

test('one rejected visit file does not block a second independently queued visit file', async () => {
  const queue = await newTab();
  const items = await queue.enqueueVisitUploads({ userId: owner, projectId: 'site', files: [video(32), video(64)] });
  for (const [index, item] of items.entries()) await queue.replaceOfflineItemFiles(item.id, [video(index === 0 ? 32 : 64)], { userId: owner });
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') {
      const input = JSON.parse(options.body);
      if (input.sizeBytes === 32) return Response.json({ ok: false, error: 'İlk dosya reddedildi.' }, { status: 422 });
      return ok({ uploadId: 'second-file', offsetBytes: 64, sizeBytes: 64, status: 'OPEN' });
    }
    assert.equal(url, '/api/uploads/second-file/finalize');
    return ok();
  };
  const result = await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  assert.equal(result.synced, 1);
  const [failed] = await queue.listOfflineItems(['VISIT_UPLOAD'], owner);
  assert.equal(failed.id, items[0].id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.files[0].size, 32);
});

test('a second tab waits for a claimed arrival before sending later events for that same task', { timeout: 5000 }, async () => {
  const first = await newTab();
  const second = await newTab();
  await first.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'ARRIVED_SITE' });
  await first.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Çalışma notu' });
  await first.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'LEFT_SITE' });
  const started = deferred();
  const release = deferred();
  const sent = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/offline/sync');
    const input = JSON.parse(options.body);
    sent.push(input.type);
    if (input.type === 'ARRIVED_SITE') { started.resolve(); await release.promise; }
    return ok();
  };
  const firstSync = first.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'], eventsOnly: true });
  await started.promise;
  try {
    await second.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'], eventsOnly: true });
    assert.deepEqual(sent, ['ARRIVED_SITE']);
  } finally { release.resolve(); await firstSync; }
  assert.deepEqual(sent, ['ARRIVED_SITE', 'NOTE', 'LEFT_SITE']);
});

test('a second caller joining an active transfer receives subsequent upload progress', { timeout: 5000 }, async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
  await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  const started = deferred();
  const release = deferred();
  const firstProgress = [];
  const secondProgress = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') return ok({ uploadId: 'upload', offsetBytes: 0, sizeBytes: 32, status: 'OPEN' });
    if (options?.method === 'PATCH') { started.resolve(); await release.promise; return ok({ uploadId: 'upload', offsetBytes: 32, sizeBytes: 32, status: 'OPEN' }); }
    assert.equal(url, '/api/uploads/upload/finalize');
    return ok();
  };
  const firstSync = queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], onProgress: (progress) => firstProgress.push(progress.progress) });
  await started.promise;
  const secondSync = queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], onProgress: (progress) => secondProgress.push(progress.progress) });
  release.resolve();
  await Promise.all([firstSync, secondSync]);
  assert.equal(firstProgress.includes(100), true);
  assert.equal(secondProgress.includes(100), true);
});
