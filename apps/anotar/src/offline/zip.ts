const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export async function storedZip(entries: { name: string; blob: Blob }[]) {
  const parts: BlobPart[] = [],
    central: BlobPart[] = [];
  let offset = 0,
    centralBytes = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name),
      size = entry.blob.size;
    let crc = 0xffffffff;
    const reader = entry.blob.stream().getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    if (offset + size > 0xffffffff || entries.length > 65535)
      throw Error('내보낼 자료가 ZIP 한도를 넘었어요.');
    const header = new Uint8Array(30),
      view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(12, 0x21, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, name.length, true);
    const directory = new Uint8Array(46),
      d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, size, true);
    d.setUint32(24, size, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    parts.push(header, name, entry.blob);
    central.push(directory, name);
    offset += 30 + name.length + size;
    centralBytes += 46 + name.length;
  }
  const end = new Uint8Array(22),
    view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralBytes, true);
  view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
