import test from 'node:test';
import assert from 'node:assert/strict';
import { inferCaptureUrl, validateShare, mergeReviewedShare, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from '../public/capture-store.js';

test('URL inference accepts an entire HTTP(S) URL and never executable protocols or mixed prose', () => {
  assert.equal(inferCaptureUrl(' https://example.com/한글?q=a#b '), 'https://example.com/한글?q=a#b');
  for (const text of ['javascript:alert(1)', 'data:text/html,hello', 'https://', 'see https://example.com', 'https://example.com\nhello'])
    assert.equal(inferCaptureUrl(text), null);
});

test('shared content handles Android text URLs, keeps original text, and rejects malformed fields', () => {
  const value = validateShare({ title: '원본 제목', text: 'https://example.com/path', files: [] });
  assert.equal(value.url, 'https://example.com/path');
  assert.equal(value.text, '원본 제목');
  const html = validateShare({ text: '<script>window.leaked=true</script>', files: [] });
  assert.equal(html.text, '<script>window.leaked=true</script>');
  assert.throws(() => validateShare({ url: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => validateShare({ text: 'a'.repeat(10001) }), /10,000/);
  assert.equal(validateShare({ text: 'a'.repeat(10000) }).text.length, 10000);
  assert.throws(() => validateShare({ text: 'a'.repeat(10000), title: 'extra' }), /10,000/);
  assert.throws(() => validateShare({ text: {} }), /문자/);
  assert.throws(() => validateShare({}), /내용/);
});

test('share files have enforced count, individual size, combined size and allowed MIME/extension', () => {
  const file = (name, type, size = 1) => ({ name, type, size, arrayBuffer() {} });
  assert.equal(validateShare({ files: [file('한글.pdf', 'application/pdf')] }).files.length, 1);
  assert.equal(validateShare({ files: [file('camera.heic', '')] }).files.length, 1);
  assert.throws(() => validateShare({ files: Array(9).fill(file('x.png', 'image/png')) }), /8개/);
  assert.throws(() => validateShare({ files: [file('x.pdf', 'application/pdf', MAX_FILE_BYTES + 1)] }), /25MB/);
  assert.throws(() => validateShare({ files: Array(5).fill(file('x.pdf', 'application/pdf', MAX_FILE_BYTES)) }), /100MB/);
  assert.equal(MAX_TOTAL_BYTES, 100 * 1024 * 1024);
  for (const bad of [file('page.html', 'text/html'), file('x.svg', 'image/svg+xml'), file('x.exe', 'application/x-msdownload'), file('../x.png', 'image/png')])
    assert.throws(() => validateShare({ files: [bad] }), /파일/);
});

test('reviewed import appends without replacing the existing draft and is idempotent by import ID', () => {
  const existingFile = new File(['x'], 'old.txt', { type: 'text/plain' });
  const sharedFile = new File(['y'], 'new.png', { type: 'image/png' });
  const input = { kind: 'link', text: '기존 초안', url: 'https://old.example', aiEnabled: false, aiAdditional: '기존 설정' };
  const original = structuredClone(input);
  const merged = mergeReviewedShare({ input, files: [existingFile] }, { id: 'one', text: '공유 원문', url: 'https://new.example', files: [sharedFile] });
  assert.deepEqual(input, original);
  assert.equal(merged.input.url, input.url);
  assert.equal(merged.input.text, '기존 초안\n\n공유 원문\n\nhttps://new.example');
  assert.deepEqual(merged.files, [existingFile, sharedFile]);
  assert.deepEqual(mergeReviewedShare(merged, { id: 'one', text: '공유 원문', files: [sharedFile] }), merged);
  assert.throws(() => mergeReviewedShare({ input: { ...input, aiEnabled: true }, files: [] }, { id: 'two', text: 'share' }), /AI/);
  assert.throws(() => mergeReviewedShare({ input, files: Array(8).fill(existingFile) }, { id: 'two', files: [sharedFile] }), /8개/);
  assert.throws(() => mergeReviewedShare({ input: { ...input, text: 'a'.repeat(9999) }, files: [] }, { id: 'overflow', text: 'new' }), /10,000/);
  const note = mergeReviewedShare({ input: { ...input, kind: 'note', url: '' }, files: [] }, { id: 'note-link', url: 'https://new.example/article' });
  assert.equal(note.input.kind, 'note');
  assert.equal(note.input.url, '');
  assert.equal(note.input.text, '기존 초안\n\nhttps://new.example/article');
});
