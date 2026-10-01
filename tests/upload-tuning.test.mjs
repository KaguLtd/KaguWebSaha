import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { requestJson, JsonRequestError } from '../lib/client/json-request.ts';
import {
  acknowledgeUploadChunk, shrinkUploadChunk, uploadChunkState,
  INITIAL_UPLOAD_CHUNK_BYTES, MIN_UPLOAD_CHUNK_BYTES, MAX_UPLOAD_CHUNK_BYTES,
} from '../lib/client/adaptive-upload-chunks.ts';

beforeEach(() => { globalThis.fetch = async () => { throw new Error('Unexpected real network request'); }; });

test('bounded JSON requests time out before headers even when a mocked fetch ignores abort', async () => {
  let signal;
  globalThis.fetch = async (_url, options) => { signal = options.signal; return new Promise(() => {}); };
  await assert.rejects(requestJson('/no-headers', {}, 20), (error) => error instanceof JsonRequestError && error.code === 'TIMEOUT' && error.status === 0);
  assert.equal(signal.aborted, true);
});

test('the same timeout covers JSON body decoding after headers and aborts hanging mocked bodies', async () => {
  let signal;
  let decoding = false;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, status: 200, redirected: false, json: () => { decoding = true; return new Promise(() => {}); } };
  };
  await assert.rejects(requestJson('/hanging-body', {}, 20), (error) => error.code === 'TIMEOUT');
  assert.equal(decoding, true);
  assert.equal(signal.aborted, true);
});

test('authentication failure and redirected login HTML are rejected before decoding the body', async () => {
  for (const response of [{ status: 401, redirected: false }, { status: 200, redirected: true }]) {
    globalThis.fetch = async () => ({ ...response, ok: true, json() { throw new Error('Authentication body must not be decoded'); } });
    await assert.rejects(requestJson('/protected'), (error) => error instanceof JsonRequestError && error.status === 401 && error.code === 'AUTH');
  }
});

test('only explicit successful JSON ACKs pass; malformed HTML and false/missing ACKs remain failures', async () => {
  for (const payload of [{}, { ok: false }, { ok: 1 }, { ok: 'true' }, [], null, 'ok']) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(requestJson('/ack'), (error) => error.code === 'INVALID_RESPONSE' && error.status === 503);
  }
  globalThis.fetch = async () => new Response('<html>login</html>', { status: 200 });
  await assert.rejects(requestJson('/ack'), (error) => error.code === 'INVALID_RESPONSE');
  globalThis.fetch = async () => Response.json({ ok: false, error: 'Atama kaldırıldı.' }, { status: 403 });
  await assert.rejects(requestJson('/ack'), (error) => error.code === 'HTTP' && error.status === 403 && error.message === 'Atama kaldırıldı.');
  globalThis.fetch = async () => Response.json({ ok: true, visitId: 'visit-1' });
  assert.deepEqual(await requestJson('/ack'), { ok: true, visitId: 'visit-1' });
});

test('adaptive chunks settle safely at 64–256 kbps and 0.25–0.5 Mbps with one second request overhead', () => {
  for (const bandwidth of [64_000, 128_000, 256_000, 250_000, 500_000]) {
    let state = uploadChunkState();
    assert.equal(state.chunkBytes, INITIAL_UPLOAD_CHUNK_BYTES);
    for (let index = 0; index < 30; index++) {
      const previousBytes = state.chunkBytes;
      const elapsedMs = previousBytes * 8 / bandwidth * 1000 + 1000;
      assert.ok(elapsedMs < 120_000, `no deterministic timeout at ${bandwidth} bps`);
      state = acknowledgeUploadChunk(state, previousBytes, elapsedMs);
      assert.ok(state.chunkBytes >= MIN_UPLOAD_CHUNK_BYTES && state.chunkBytes <= MAX_UPLOAD_CHUNK_BYTES);
      assert.ok(state.chunkBytes <= previousBytes * 2, 'growth is bounded to twice the prior size');
    }
    const settledMs = state.chunkBytes * 8 / bandwidth * 1000 + 1000;
    assert.ok(settledMs >= 15_000 && settledMs <= 20_000, `${bandwidth} settles near the target: ${settledMs}ms`);
  }
});

test('growth needs two full ACKs; tiny tails do not grow chunks; retries forget unsafe speed samples', () => {
  let state = uploadChunkState();
  state = acknowledgeUploadChunk(state, state.chunkBytes, 1000);
  assert.equal(state.chunkBytes, INITIAL_UPLOAD_CHUNK_BYTES);
  state = acknowledgeUploadChunk(state, state.chunkBytes, 1000);
  assert.equal(state.chunkBytes, INITIAL_UPLOAD_CHUNK_BYTES * 2);
  const tail = acknowledgeUploadChunk(state, 8, 1);
  assert.equal(tail.chunkBytes, state.chunkBytes);
  const shrunk = shrinkUploadChunk(state);
  assert.equal(shrunk.chunkBytes, INITIAL_UPLOAD_CHUNK_BYTES);
  assert.equal(shrunk.bytesPerSecond, undefined);
  assert.equal(shrunk.stableAcks, 0);
  assert.equal(shrinkUploadChunk(shrinkUploadChunk(shrunk)).chunkBytes, MIN_UPLOAD_CHUNK_BYTES);
  const slowed = acknowledgeUploadChunk({ chunkBytes: MAX_UPLOAD_CHUNK_BYTES, bytesPerSecond: 2_000_000, stableAcks: 1 }, MAX_UPLOAD_CHUNK_BYTES, 140_000);
  assert.ok(slowed.chunkBytes <= INITIAL_UPLOAD_CHUNK_BYTES, 'a sudden low-bandwidth ACK overrides old fast measurements');
});
