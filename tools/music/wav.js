// A 32-bit float WAV, and base64 to hand it to puppeteer in one string.
export function floatWav(channels, sampleRate) {
  const frames = channels[0].length;
  const bytes = frames * channels.length * 4;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 4, true);
  view.setUint16(32, channels.length * 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const data of channels) {
      view.setFloat32(at, data[i], true);
      at += 4;
    }
  }
  return new Uint8Array(view.buffer);
}

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
