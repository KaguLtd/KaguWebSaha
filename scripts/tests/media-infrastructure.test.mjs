import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { finishMediaPublication, getMediaJobFailureState } from '../../lib/files/job-policy.ts';
import { parseByteRange } from '../../lib/files/http-range.ts';
import { MAX_UPLOAD_CHUNK_BYTES, parseUploadOffset, readUploadChunk, validateChunkPosition } from '../../lib/uploads/protocol.ts';
import { writeUploadChunk } from '../../lib/uploads/chunk-storage.ts';
import sharp from 'sharp';
import { prepareStoredProjectUpload } from '../../lib/files/storage.ts';

test('published file stays successful when cleanup and refresh both fail', async () => {
  const calls = [];
  const file = { id: 'published-file', status: 'COMPLETED' };
  const result = await finishMediaPublication({
    commit: async () => { calls.push('commit'); return file; },
    cleanup: async () => { calls.push('cleanup'); throw new Error('disk cleanup fault'); },
    notify: () => { calls.push('notify'); throw new Error('cache context fault'); },
    onPostCommitError: (stage) => calls.push(`isolated:${stage}`),
  });
  assert.equal(result, file);
  assert.deepEqual(calls, ['commit', 'cleanup', 'isolated:cleanup', 'notify', 'isolated:notify']);
});

test('updated native image runtime preserves EXIF rotation and creates a bounded preview', async () => {
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#2277aa' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const preview = await sharp(original).rotate().resize({ fit: 'inside', width: 400, height: 400 }).webp().toBuffer();
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.width, 200); assert.equal(metadata.height, 400);
  assert.equal(metadata.format, 'webp'); assert.ok(preview.length < original.length);
});

test('a publication retry keeps its source and reuses a single video destination', async () => {
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'kagu-publication-retry-'));
  const previous = process.env.UPLOAD_DIR; process.env.UPLOAD_DIR = directory;
  try {
    await writeFile(path.join(directory, 'staging.bin'), 'video-bytes');
    const metadata = { name: 'video.mp4', type: 'video/mp4', size: 11 };
    const first = await prepareStoredProjectUpload(metadata, 'project', 'staging.bin', 'session-id');
    const retried = await prepareStoredProjectUpload(metadata, 'project', 'staging.bin', 'session-id');
    assert.equal(first.storagePath, retried.storagePath);
    assert.equal((await readdir(path.join(directory, 'projects', 'project'))).length, 1);
    assert.equal(await readFile(path.join(directory, 'staging.bin'), 'utf8'), 'video-bytes');
    assert.equal(await readFile(path.join(directory, retried.storagePath), 'utf8'), 'video-bytes');
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previous;
    assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed DB publication does not run post-commit cleanup', async () => {
  let cleanup = false;
  await assert.rejects(finishMediaPublication({ commit: async () => { throw new Error('DB rollback'); }, cleanup: async () => { cleanup = true; } }), /DB rollback/);
  assert.equal(cleanup, false);
});

test('media retry is delayed, bounded, and releases its lease', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const first = getMediaJobFailureState(1, now);
  assert.equal(first.status, 'PENDING');
  assert.equal(first.nextAttemptAt.getTime() - now.getTime(), 15_000);
  assert.equal(first.lockedBy, null);
  assert.equal(first.lockedUntil, null);
  assert.equal(getMediaJobFailureState(5, now).status, 'FAILED');
});

test('range parsing supports seeking, suffix, open end, and unsatisfiable ranges', () => {
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=0-999', 100), { start: 0, end: 99 });
  assert.equal(parseByteRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=10-9', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=-0', 100), 'unsatisfiable');
  assert.equal(parseByteRange('bytes=0-0', 0), 'unsatisfiable');
});

test('chunk boundaries reject gaps, partial replay, and oversized content', async () => {
  assert.equal(parseUploadOffset('123'), 123);
  assert.throws(() => parseUploadOffset('-1'));
  assert.throws(() => validateChunkPosition(4, 1, 3, 10), (error) => error.status === 409 && error.offsetBytes === 3);
  assert.throws(() => validateChunkPosition(2, 2, 3, 10), (error) => error.status === 409);
  assert.throws(() => validateChunkPosition(0, MAX_UPLOAD_CHUNK_BYTES + 1, 0, MAX_UPLOAD_CHUNK_BYTES + 2), (error) => error.status === 413);
  const request = new Request('http://test/upload', { method: 'PATCH', body: new Uint8Array(MAX_UPLOAD_CHUNK_BYTES + 1) });
  await assert.rejects(readUploadChunk(request), (error) => error.status === 413);
});

test('lost chunk response replays safely; uncommitted disk tail is overwritten', async () => {
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'kagu-media-test-'));
  assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
  const file = path.join(directory, 'upload.bin');
  try {
    assert.equal(await writeUploadChunk(file, 0, Buffer.from('abc'), 0), 3);
    assert.equal(await writeUploadChunk(file, 0, Buffer.from('abc'), 3), 3);
    await assert.rejects(writeUploadChunk(file, 0, Buffer.from('abd'), 3), (error) => error.status === 409);
    await writeFile(file, 'abc-uncommitted-extra-tail');
    assert.equal(await writeUploadChunk(file, 3, Buffer.from('def'), 3), 6);
    assert.equal((await readFile(file)).toString(), 'abcdef');
    await assert.rejects(writeUploadChunk(path.join(directory, 'missing.bin'), 3, Buffer.from('def'), 3), (error) => error.status === 410);
  } finally {
    assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
