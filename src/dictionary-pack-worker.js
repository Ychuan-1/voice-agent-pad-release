const { parentPort, workerData } = require('node:worker_threads');
const { buildTerms } = require('./dictionary-packs');

try { parentPort.postMessage({ terms: buildTerms(workerData.pack, workerData.texts) }); }
catch (error) { parentPort.postMessage({ error: error.message }); }
