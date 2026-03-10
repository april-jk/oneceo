import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filenameFromContentDisposition,
  inferFilenameFromResponse,
  resolveRemoteAttachmentTarget,
} from '../src/services/remote-attachment-service';

test('resolveRemoteAttachmentTarget keeps website URLs and infers filename from path', () => {
  const result = resolveRemoteAttachmentTarget('website', 'https://example.com/files/spec.pdf');

  assert.equal(result.fetchUrl, 'https://example.com/files/spec.pdf');
  assert.equal(result.suggestedName, 'spec.pdf');
});

test('resolveRemoteAttachmentTarget converts google drive share links', () => {
  const result = resolveRemoteAttachmentTarget(
    'google-drive',
    'https://drive.google.com/file/d/abc123/view?usp=sharing'
  );

  assert.equal(result.fetchUrl, 'https://drive.google.com/uc?export=download&id=abc123');
  assert.equal(result.suggestedName, 'google-drive-abc123');
});

test('resolveRemoteAttachmentTarget converts onedrive share links', () => {
  const result = resolveRemoteAttachmentTarget(
    'onedrive',
    'https://1drv.ms/u/s!exampleShareToken'
  );

  assert.match(result.fetchUrl, /^https:\/\/api\.onedrive\.com\/v1\.0\/shares\/u![A-Za-z0-9_-]+\/root\/content$/);
  assert.equal(result.suggestedName, 'onedrive-file');
});

test('resolveRemoteAttachmentTarget rejects localhost when private hosts are disabled', () => {
  assert.throws(
    () => resolveRemoteAttachmentTarget('website', 'http://localhost:5173/logo.png'),
    /当前环境不允许从本地地址导入文件/
  );
});

test('resolveRemoteAttachmentTarget allows localhost in development-style mode', () => {
  const result = resolveRemoteAttachmentTarget('website', 'http://localhost:5173/logo.png', {
    allowPrivateHosts: true,
  });

  assert.equal(result.fetchUrl, 'http://localhost:5173/logo.png');
  assert.equal(result.suggestedName, 'logo.png');
});

test('filenameFromContentDisposition prefers utf8 filenames', () => {
  const filename = filenameFromContentDisposition(
    "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.md"
  );

  assert.equal(filename, 'attachment.md');
});

test('inferFilenameFromResponse falls back to mime-based extension', () => {
  const filename = inferFilenameFromResponse({
    fallbackName: 'website-file',
    mimeType: 'text/html; charset=utf-8',
  });

  assert.equal(filename, 'website-file.html');
});
