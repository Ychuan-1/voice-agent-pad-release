const path = require('node:path');
const { app } = require('electron');

if (!process.env.VOICE_PAD_TEST_DATA) throw new Error('Missing isolated test directory');
app.setPath('userData', path.resolve(process.env.VOICE_PAD_TEST_DATA));
globalThis.voicePadTestEditor = require('../src/local-editor').LocalEditor;
require('../src/main');
