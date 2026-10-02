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
const finalized = (uploadId = 'upload', sizeBytes = 32, extra = {}) => ok({ uploadId, sizeBytes, offsetBytes: sizeBytes, status: 'COMPLETED', projectFileId: `file-${uploadId}`, ...extra });
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
    const request = indexedDB.open(name);
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
    const request = indexedDB.open(name);
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
  assert.equal(retained.status, 'PENDING'); assert.equal(retained.files[0].size, 32); assert.ok(retained.uploadFileGenerations[0]);
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

test('a failed arrival retains its transition but still delivers the same task note and two photos', async () => {
  const queue = await newTab();
  const arrival = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'ARRIVED_SITE' });
  const photos = [1, 2].map((index) => new File([new Uint8Array(32)], `field-${index}.jpg`, { type: 'image/jpeg' }));
  const note = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Ha', files: photos });
  for (const item of note.media) await queue.replaceOfflineItemFiles(item.id, item.files, { userId: owner });
  const departure = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'LEFT_SITE' });
  let arrivalBroken = true;
  const events = [];
  const published = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/offline/sync') {
      const input = JSON.parse(options.body);
      events.push(input.type);
      return input.type === 'ARRIVED_SITE' && arrivalBroken ? Response.json({ error: 'Sunucu kaydı tamamlayamadı.' }, { status: 503 }) : ok();
    }
    if (url === '/api/uploads') {
      const input = JSON.parse(options.body);
      return ok({ uploadId: input.clientUploadId, offsetBytes: 0, sizeBytes: 32, status: 'OPEN' });
    }
    const uploadId = url.split('/')[3];
    if (options?.method === 'PATCH') return ok({ uploadId, offsetBytes: 32, sizeBytes: 32, status: 'OPEN' });
    if (url.endsWith('/finalize')) { published.push(uploadId); return finalized(uploadId); }
    throw new Error(`Unexpected URL ${url}`);
  };
  const result = await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.equal(result.synced, 3);
  assert.deepEqual(result.failedIds, [arrival.event.id]);
  assert.deepEqual(events, ['ARRIVED_SITE', 'NOTE']);
  assert.equal(published.length, 2);
  assert.deepEqual((await queue.listOfflineItems(['PERSONNEL'], owner)).map((item) => item.id), [arrival.event.id, departure.event.id]);
  assert.equal((await queue.listSuccessfulUploads(owner)).length, 2);
  arrivalBroken = false;
  const recovered = await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'], force: true });
  assert.equal(recovered.synced, 2);
  assert.equal(recovered.remaining, 0);
  assert.deepEqual(events, ['ARRIVED_SITE', 'NOTE', 'ARRIVED_SITE', 'LEFT_SITE']);
  assert.equal(published.length, 2, 'Recovered transitions must not upload accepted photos again');
});

test('arrival backoff lets a new note through and keeps departure waiting for arrival', async () => {
  const queue = await newTab();
  const arrival = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'ARRIVED_SITE' });
  globalThis.fetch = async () => Response.json({ error: 'Arrival temporarily unavailable' }, { status: 503 });
  await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Work note' });
  const departure = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'LEFT_SITE' });
  const sent = [];
  globalThis.fetch = async (url, options) => { sent.push(JSON.parse(options.body).type); return ok(); };
  const result = await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'], eventsOnly: true });
  assert.equal(result.synced, 1);
  assert.deepEqual(sent, ['NOTE']);
  assert.deepEqual((await queue.listOfflineItems(['PERSONNEL'], owner)).map((item) => item.id), [arrival.event.id, departure.event.id]);
});

test('a server error on one note does not freeze later notes, and its own photo stays retained', async () => {
  const queue = await newTab();
  const first = await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Unaccepted note', files: [video()] });
  await queue.enqueuePersonnelEvent({ userId: owner, taskId: 'task', projectId: 'site', eventType: 'NOTE', note: 'Independent note' });
  const sent = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/offline/sync', 'An unaccepted note must retain its photo dependency');
    const input = JSON.parse(options.body); sent.push(input.note);
    return input.clientItemId === first.event.id ? Response.json({ error: 'Temporary write failure' }, { status: 503 }) : ok();
  };
  const result = await queue.syncOfflineItems({ userId: owner, kinds: ['PERSONNEL'] });
  assert.equal(result.synced, 1);
  assert.deepEqual(sent, ['Unaccepted note', 'Independent note']);
  const remaining = await queue.listOfflineItems(['PERSONNEL'], owner);
  assert.deepEqual(remaining.map((item) => item.id), [first.event.id, first.media[0].id]);
  assert.equal(remaining[1].files[0].size, 32);
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
    if (url.endsWith('/finalize')) return finalized();
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
  globalThis.fetch = async (url) => {
    if (url === '/api/uploads') { uploadInitializations++; started.resolve(); await release.promise; return ok({ uploadId: 'upload', offsetBytes: 32, sizeBytes: 32, status: 'OPEN' }); }
    assert.equal(url, '/api/uploads/upload/finalize');
    return finalized();
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
  const sentSizes = [];
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
      sentSizes.push(options.body.size);
      offset += options.body.size;
      if (loseResponse && sentOffsets.length === 2) { loseResponse = false; committedBeforeResume = offset; throw new TypeError('Network lost after commit'); }
      return ok({ uploadId: 'upload', offsetBytes: offset, sizeBytes: bytes, status: 'OPEN' });
    }
    assert.equal(url, '/api/uploads/upload/finalize');
    return finalized('upload', bytes);
  };
  const interrupted = await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  assert.equal(interrupted.synced, 0);
  const [retained] = await queue.listOfflineItems(['VISIT_UPLOAD'], owner);
  assert.equal(retained.chunkState.chunkBytes, 64 * 1024, 'the smaller retry size is durable');
  const restartedTab = await newTab();
  const resumed = await restartedTab.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true });
  assert.equal(resumed.synced, 1);
  assert.equal(sentOffsets[2], committedBeforeResume);
  assert.equal(sentSizes[2], 64 * 1024, 'a new page retains the reduced size while resuming at the server ACK');
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
    return finalized('replacement', 64);
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
    return finalized('second-file', 64);
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
    return finalized();
  };
  const firstSync = queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], onProgress: (progress) => firstProgress.push(progress.progress) });
  await started.promise;
  const secondSync = queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], onProgress: (progress) => secondProgress.push(progress.progress) });
  release.resolve();
  await Promise.all([firstSync, secondSync]);
  assert.equal(firstProgress.includes(100), true);
  assert.equal(secondProgress.includes(100), true);
});

test('adaptive measurements include ACK body time, not just fast response headers', async () => {
  const queue = await newTab();
  const bytes = 3 * 128 * 1024;
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video(bytes)] });
  await queue.replaceOfflineItemFiles(item.id, [video(bytes)], { userId: owner });
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let clock = 0;
  let offset = 0;
  const chunks = [];
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') return ok({ uploadId: 'body-timing', sizeBytes: bytes, offsetBytes: offset, status: 'OPEN' });
    if (options?.method === 'PATCH') {
      chunks.push(options.body.size);
      offset += options.body.size;
      return { ok: true, status: 200, redirected: false, async json() {
        clock += 40_000;
        return { ok: true, uploadId: 'body-timing', sizeBytes: bytes, offsetBytes: offset, status: 'OPEN' };
      } };
    }
    assert.equal(url, '/api/uploads/body-timing/finalize');
    return finalized('body-timing', bytes);
  };
  try {
    assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] })).synced, 1);
    assert.deepEqual(chunks, [128, 64, 64, 64, 64].map((value) => value * 1024));
  } finally { Object.defineProperty(globalThis, 'performance', performanceDescriptor); }
});

test('an expired session at PATCH retains confirmed bytes and resumes after login with the same upload identity', async () => {
  const queue = await newTab();
  const bytes = 3 * 128 * 1024;
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video(bytes)] });
  await queue.replaceOfflineItemFiles(item.id, [video(bytes)], { userId: owner });
  let offset = 0;
  let expired = true;
  const identities = [];
  const sentOffsets = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') {
      identities.push(JSON.parse(options.body).clientUploadId);
      return ok({ uploadId: 'auth-retry', sizeBytes: bytes, offsetBytes: offset, status: 'OPEN' });
    }
    if (options?.method === 'PATCH') {
      sentOffsets.push(Number(options.headers['Upload-Offset']));
      if (expired && offset > 0) return Response.json({ ok: false }, { status: 401 });
      offset += options.body.size;
      return ok({ uploadId: 'auth-retry', sizeBytes: bytes, offsetBytes: offset, status: 'OPEN' });
    }
    return finalized('auth-retry', bytes);
  };
  await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  const confirmed = offset;
  const [pending] = await queue.listOfflineItems(['VISIT_UPLOAD'], owner);
  assert.equal(pending.status, 'PENDING'); assert.equal(pending.files[0].size, bytes);
  assert.equal((await queue.listSuccessfulUploads(owner)).length, 0);
  expired = false;
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true })).synced, 1);
  assert.equal(sentOffsets[2], confirmed);
  assert.equal(new Set(identities).size, 1);
  assert.equal((await queue.listSuccessfulUploads(owner)).length, 1);
});

test('an incomplete or malformed finalize ACK retains the Blob and creates no delivery receipt', async () => {
  for (const badAck of [{ ok: true }, { ok: true, uploadId: 'bad-final', status: 'OPEN', sizeBytes: 32, offsetBytes: 32, projectFileId: 'file' }]) {
    const queue = await newTab();
    const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
    await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
    globalThis.fetch = async (url) => url === '/api/uploads'
      ? ok({ uploadId: 'bad-final', sizeBytes: 32, offsetBytes: 32, status: 'OPEN' }) : Response.json(badAck);
    assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true })).synced, 0);
    assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner)).find((row) => row.id === item.id).files[0].size, 32);
    assert.deepEqual(await queue.listSuccessfulUploads(owner), []);
    await queue.deleteOfflineItem(item.id, owner);
  }
});

test('a receipt transaction abort after successful finalize preserves the Blob; retry stores one owner-scoped receipt', async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', note: 'Private note must not enter receipt', files: [video()] });
  await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  globalThis.fetch = async (url) => url === '/api/uploads'
    ? ok({ uploadId: 'receipt-retry', sizeBytes: 32, offsetBytes: 32, status: 'COMPLETED' }) : finalized('receipt-retry', 32);
  const factory = indexedDB;
  let abortNextReceipt = true;
  globalThis.indexedDB = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const database = request.result;
      const transaction = database.transaction.bind(database);
      database.transaction = (...transactionArgs) => {
        const tx = transaction(...transactionArgs);
        if (transactionArgs[0] === 'successful-uploads' && transactionArgs[1] === 'readwrite' && abortNextReceipt) {
          abortNextReceipt = false;
          const store = tx.objectStore('successful-uploads');
          const put = store.put.bind(store);
          store.put = (...putArgs) => { const write = put(...putArgs); write.addEventListener('success', () => tx.abort(), { once: true }); return write; };
        }
        return tx;
      };
    });
    return request;
  } };
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] })).synced, 0);
  globalThis.indexedDB = factory;
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner))[0].files[0].size, 32);
  assert.deepEqual(await queue.listSuccessfulUploads(owner), []);
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true })).synced, 1);
  const [receipt] = await (await newTab()).listSuccessfulUploads(owner);
  assert.deepEqual(Object.keys(receipt).sort(), ['completedAt', 'id', 'originalName', 'projectFileId', 'uploadId', 'uploadedByUserId'].sort());
  assert.equal(receipt.originalName, 'saha.mp4'); assert.equal(receipt.projectFileId, 'file-receipt-retry');
  assert.deepEqual(await queue.listSuccessfulUploads('person-b'), []);
  assert.deepEqual(await queue.listOfflineItems(['VISIT_UPLOAD'], owner), []);
});

test('HEIC accepted transfers retain a receipt until the owner-scoped status resolves its eventual file', async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
  await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  const completedAt = '2026-09-30T10:00:00.000Z';
  globalThis.fetch = async (url) => url === '/api/uploads'
    ? ok({ uploadId: 'heic-transfer', sizeBytes: 32, offsetBytes: 32, status: 'OPEN' })
    : finalized('heic-transfer', 32, { projectFileId: null, processing: true, completedAt });
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] })).synced, 1);
  assert.equal((await queue.listSuccessfulUploads(owner))[0].projectFileId, null);
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/uploads/heic-transfer');
    return finalized('heic-transfer', 32, { projectFileId: 'canonical-jpeg' });
  };
  const [receipt] = await queue.refreshSuccessfulUploads(owner);
  assert.equal(receipt.projectFileId, 'canonical-jpeg'); assert.equal(receipt.completedAt, completedAt);
});

test('an expired sibling gets a fresh session without duplicating already completed files in a multi-file draft', async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video(32), video(64)] });
  await queue.replaceOfflineItemFiles(item.id, [video(32), video(64)], { userId: owner });
  const ids = [];
  let expired = true;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') {
      const input = JSON.parse(options.body);
      ids.push([input.sizeBytes, input.clientUploadId]);
      return ok({ uploadId: `file-${input.sizeBytes}`, sizeBytes: input.sizeBytes, offsetBytes: expired && input.sizeBytes === 64 ? 0 : input.sizeBytes,
        status: expired && input.sizeBytes === 64 ? 'CANCELLED' : 'COMPLETED' });
    }
    return finalized(url.includes('file-64') ? 'file-64' : 'file-32', url.includes('file-64') ? 64 : 32);
  };
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] })).synced, 0);
  expired = false;
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true })).synced, 1);
  assert.equal(ids[0][1], ids[2][1]);
  assert.notEqual(ids[1][1], ids[3][1]);
  assert.equal((await queue.listSuccessfulUploads(owner)).length, 2);
});

test('conflict recovery rejects an ACK from a different upload session before finalize or Blob deletion', async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
  await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') return ok({ uploadId: 'correct-upload', sizeBytes: 32, offsetBytes: 0, status: 'OPEN' });
    if (options?.method === 'PATCH') return Response.json({ ok: false }, { status: 409 });
    assert.equal(url, '/api/uploads/correct-upload');
    return ok({ uploadId: 'different-upload', sizeBytes: 32, offsetBytes: 32, status: 'COMPLETED', projectFileId: 'other-file' });
  };
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] })).synced, 0);
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner))[0].files[0].size, 32);
  assert.deepEqual(await queue.listSuccessfulUploads(owner), []);
});

test('receipt history is physically bounded per account and does not prune another account', async () => {
  const queue = await newTab();
  const item = await queue.enqueueVisitUpload({ userId: owner, projectId: 'site', files: [video()] });
  await queue.replaceOfflineItemFiles(item.id, [video()], { userId: owner });
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('kagu-saha-offline-v11');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('successful-uploads', 'readwrite');
      const store = tx.objectStore('successful-uploads');
      for (const userId of [owner, 'person-b']) for (let index = 0; index < 100; index++) {
        store.put({ id: `${userId}:old-${index}`, uploadId: `old-${index}`, uploadedByUserId: userId,
          originalName: 'old.mp4', projectFileId: `old-file-${index}`, completedAt: new Date(Date.now() - (101 - index) * 1000).toISOString() });
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  globalThis.fetch = async (url) => url === '/api/uploads'
    ? ok({ uploadId: 'new-delivery', sizeBytes: 32, offsetBytes: 32, status: 'OPEN' }) : finalized('new-delivery');
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] })).synced, 1);
  const recent = await queue.listSuccessfulUploads(owner);
  assert.equal(recent.length, 100); assert.equal(recent[0].uploadId, 'new-delivery');
  assert.equal(recent.some((row) => row.uploadId === 'old-0'), false);
  const stored = await new Promise((resolve, reject) => {
    const request = indexedDB.open('kagu-saha-offline-v11');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('successful-uploads', 'readonly');
      const read = tx.objectStore('successful-uploads').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  assert.equal(stored.filter((row) => row.uploadedByUserId === owner).length, 100);
  assert.equal(stored.filter((row) => row.uploadedByUserId === 'person-b').length, 100);
});

test('receipt store upgrade preserves V1.1 pending data and original legacy databases', async () => {
  const pending = { id: 'v11-pending-before-receipts', userId: owner, schemaVersion: 2, type: 'VISIT_FILE', projectId: 'site',
    createdAt: '2026-09-30T00:00:00Z', status: 'PENDING', prepared: true, files: [video()], expectedFileCount: 1 };
  await addLegacy(pending);
  await addLegacy({ id: 'v1-legacy', type: 'VISIT_FILE', files: [video()] }, 'kagu-saha-offline');
  const queue = await newTab();
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner))[0].id, pending.id);
  assert.deepEqual(await queue.listSuccessfulUploads(owner), []);
  assert.equal((await storedItems('kagu-saha-offline'))[0].id, 'v1-legacy');
});

test('stopping a hung upload releases its claim, retains its Blob and resumes the same session', { timeout: 5000 }, async () => {
  const queue = await newTab();
  const [item] = await queue.enqueueVisitUploads({ userId: owner, projectId: 'site', files: [video()] });
  const started = deferred(); const hung = deferred(); const identities = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') { identities.push(JSON.parse(options.body).clientUploadId); return ok({ uploadId: 'recover', sizeBytes: 32, offsetBytes: 0, status: 'OPEN' }); }
    if (options?.method === 'PATCH') { started.resolve(); return hung.promise; }
    throw new Error('Cancelled upload must not finalize');
  };
  const first = queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] });
  await started.promise;
  await queue.stopOfflineSync(owner, 'VISIT_UPLOAD');
  assert.equal((await first).remaining, 1);
  const retained = (await queue.listOfflineItems(['VISIT_UPLOAD'], owner))[0];
  assert.equal(retained.id, item.id); assert.equal(retained.files[0].size, 32);
  assert.equal(retained.sendingUntil, undefined); assert.equal(retained.status, 'PENDING');
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'] })).synced, 0);
  assert.equal(identities.length, 1, 'automatic sync does not restart a user-stopped upload');
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') { identities.push(JSON.parse(options.body).clientUploadId); return ok({ uploadId: 'recover', sizeBytes: 32, offsetBytes: 32, status: 'OPEN' }); }
    return finalized('recover');
  };
  await queue.retryOfflineItem(item.id, owner);
  assert.equal((await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], force: true })).synced, 1);
  assert.equal(new Set(identities).size, 1);
  hung.resolve(ok({ uploadId: 'recover', sizeBytes: 32, offsetBytes: 32, status: 'OPEN' }));
  await tick(); assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner)).length, 0);
});

test('explicit legacy cleanup removes both ownerless stores and preserves all owned accounts', async () => {
  const queue = await newTab();
  await queue.enqueueVisitUploads({ userId: owner, projectId: 'site', files: [video()] });
  await queue.enqueueVisitUploads({ userId: 'other', projectId: 'site', files: [video()] });
  await addLegacy({ id: 'old-v1', type: 'NOTE' }, 'kagu-saha-offline');
  await addLegacy({ id: 'old-v11', type: 'NOTE' });
  assert.equal(await queue.countLegacyOfflineItems(), 2);
  await queue.clearLegacyOfflineItems();
  assert.equal(await queue.countLegacyOfflineItems(), 0);
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], owner)).length, 1);
  assert.equal((await queue.listOfflineItems(['VISIT_UPLOAD'], 'other')).length, 1);
});

test('visit camera images receive unique stable names and keep their bytes and MIME types', async () => {
  const queue = await newTab();
  const items = await queue.enqueueVisitUploads({ userId: owner, projectId: 'site', files: [new File(['one'], 'image', { type: 'image/jpeg' }), new File(['two'], 'image', { type: 'image/jpeg' })] });
  assert.notEqual(items[0].files[0].name, items[1].files[0].name);
  assert.match(items[0].files[0].name, /^ziyaret-image-.*\.jpg$/);
  assert.equal(await items[0].files[0].text(), 'one'); assert.equal(items[0].files[0].type, 'image/jpeg');
  assert.deepEqual((await queue.listOfflineItems(['VISIT_UPLOAD'], owner)).map((item) => item.files[0].name), items.map((item) => item.files[0].name));
});

test('batch progress is weighted by bytes and does not show 100 after only the small file', async () => {
  const queue = await newTab();
  await queue.enqueueVisitUploads({ userId: owner, projectId: 'site', files: [video(1), video(99)] });
  let size; const reports = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/uploads') { size = JSON.parse(options.body).sizeBytes; return ok({ uploadId: `upload-${size}`, sizeBytes: size, offsetBytes: size, status: 'OPEN' }); }
    return finalized(`upload-${size}`, size);
  };
  await queue.syncOfflineItems({ userId: owner, kinds: ['VISIT_UPLOAD'], onProgress: (progress) => reports.push(progress) });
  assert.equal(reports.find((row) => row.current === 1 && row.progress === 100).overallProgress, 1);
  assert.equal(reports.at(-1).overallProgress, 100);
});
