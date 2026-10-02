import assert from 'node:assert/strict';
import test from 'node:test';
import { uniqueUploadName } from '../lib/files/upload-name.ts';

test('generic legacy names get stable unique download names with correct extensions', () => {
  assert.equal(uniqueUploadName('image', 'image/png', 'file-1'), 'dosya-image-file-1.png');
  assert.equal(uniqueUploadName('image.jpg', 'image/jpeg', 'file-1'), 'dosya-image-file-1.jpg');
  assert.notEqual(uniqueUploadName('image.jpg', 'image/jpeg', 'file-1'), uniqueUploadName('image.jpg', 'image/jpeg', 'file-2'));
  assert.equal(uniqueUploadName('IMG_5374.jpeg', 'image/jpeg', 'file-1'), 'IMG_5374.jpeg');
  assert.equal(uniqueUploadName('image.heic', 'image/heic', 'file-1'), 'dosya-image-file-1.heic');
});
