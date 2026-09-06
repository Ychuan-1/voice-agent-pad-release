const { randomUUID } = require('node:crypto');
async function withTemporaryClipboard(clipboard, text, action, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const formats = clipboard.availableFormats();
  const supported = new Set(['text/plain', 'text/html', 'text/rtf', 'image/png']);
  if (formats.some((format) => !supported.has(format))) return { unsupportedClipboard: true };
  const snapshot = {};
  if (formats.includes('text/plain')) snapshot.text = clipboard.readText();
  if (formats.includes('text/html')) snapshot.html = clipboard.readHTML();
  if (formats.includes('text/rtf')) snapshot.rtf = clipboard.readRTF();
  if (formats.includes('image/png')) snapshot.image = clipboard.readImage();
  const marker = randomUUID();
  const htmlText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
  clipboard.write({ text, html: `<span data-voice-pad="${marker}">${htmlText}</span>` });
  try {
    await wait(120);
    return await action();
  } finally {
    await wait(450);
    if (clipboard.readHTML().includes(marker) && clipboard.readText() === text) {
      if (formats.length) clipboard.write(snapshot);
      else clipboard.clear();
    }
  }
}

module.exports = { withTemporaryClipboard };
