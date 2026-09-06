const OpenCC = require('opencc-js');
const nzh = require('nzh/cn');
const { diffChars } = require('diff');
const simplify = OpenCC.Converter({ from: 't', to: 'cn' });

const featureDefaults = {
  expressionMode: 'original',
  cleanupPreview: true,
  formatNumbers: true,
  formatPunctuation: true,
  standbyMode: 'fast',
  idleMinutes: 5,
  historyRetentionDays: 0,
  saveDraft: true,
  liveExternalInput: true
};

function normalizeFeatures(settings) {
  const value = { ...featureDefaults, ...settings };
  value.expressionMode = ['original', 'daily', 'organized'].includes(value.expressionMode) ? value.expressionMode : 'original';
  value.standbyMode = value.standbyMode === 'eco' ? 'eco' : 'fast';
  value.idleMinutes = Math.max(1, Math.min(60, Number(value.idleMinutes) || 5));
  value.historyRetentionDays = [0, 7, 30, 90].includes(Number(value.historyRetentionDays)) ? Number(value.historyRetentionDays) : 30;
  for (const key of ['cleanupPreview', 'formatNumbers', 'formatPunctuation', 'saveDraft', 'liveExternalInput']) value[key] = value[key] !== false;
  // Old profiles may contain personal substitutions. They are no longer active.
  delete value.dictionary;
  return value;
}

function escapeRegex(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function applyDictionary(text, dictionary) {
  const rows = dictionary.filter((row) => row.enabled !== false).sort((a, b) => b.from.length - a.from.length);
  if (!rows.length) return text;
  const lookup = new Map(rows.map((row) => [row.from.toLowerCase(), row]));
  return text.replace(new RegExp(rows.map((row) => escapeRegex(row.from)).join('|'), 'gi'), (match, offset, all) => {
    if (/[a-z0-9]/i.test(match[0]) && /[a-z0-9_]/i.test(all[offset - 1] || '')) return match;
    if (/[a-z0-9]/i.test(match.at(-1)) && /[a-z0-9_]/i.test(all[offset + match.length] || '')) return match;
    return lookup.get(match.toLowerCase()).to;
  });
}

const numberChars = '零〇一二两三四五六七八九十百千万亿点';
function numberValue(text) {
  if (/一两|一二|两三|二三|三四|四五|五六|六七|七八|八九/.test(text)) return null;
  if (/[百千万亿][一二两三四五六七八九]$/.test(text)) return null;
  const normalized = text.replace(/两/g, '二').replace(/〇/g, '零');
  try {
    const value = nzh.decodeS(normalized, { outputString: true });
    return /^\d+(\.\d+)?$/.test(String(value)) ? String(value) : null;
  } catch { return null; }
}

function formatNumbers(text) {
  return text
    .replace(/([零〇一二三四五六七八九]{4})年/g, (all, year) => `${[...year].map((char) => '零一二三四五六七八九'.indexOf(char.replace('〇', '零'))).join('')}年`)
    .replace(new RegExp(`百分之([${numberChars}]+)`, 'g'), (all, number) => numberValue(number) === null ? all : `${numberValue(number)}%`)
    .replace(/([零〇一二两三四五六七八九十]{1,3})点半/g, (all, hour) => {
      const number = numberValue(hour);
      return number !== null && Number(number) <= 23 ? `${number}:30` : all;
    })
    .replace(new RegExp(`([${numberChars}]+)(元|块钱|万元|公斤|千克|厘米|毫米|公里|毫升|毫秒|分钟|小时|个月|月|日|号|点|秒|米|个|岁)(?![多余几])`, 'g'), (all, number, unit) => {
      const value = numberValue(number);
      return value === null ? all : `${value}${unit}`;
    });
}

function formatText(text, settings, packReplacements = []) {
  let output = simplify(String(text || '')).replace(/[ \t]+/g, ' ').trim();
  output = applyDictionary(output, packReplacements);
  if (settings.formatNumbers) output = formatNumbers(output);
  if (settings.formatPunctuation && output && /[\u3400-\u9fff]/.test(output) && !/[。！？.!?:：;；\n]$/.test(output)) {
    output += /[吗么呢]$/.test(output) ? '？' : '。';
  }
  return output;
}

function inspectRewrite(original, output) {
  const warnings = [];
  if (!output || output.length > Math.max(100, original.length * 2) || output.length < original.length * 0.35) warnings.push('整理幅度较大');
  const numbers = (text) => (formatNumbers(text).replace(/^\s*\d+[.)、]\s+/gm, '').match(/\d+(?:[.:]\d+)?%?/g) || []).sort().join('|');
  if (numbers(original) !== numbers(output)) warnings.push('数字或时间有变化');
  for (const word of ['不要', '别', '不', '没', '不能', '可能', '不确定', '暂时', '先', 'not', 'never']) {
    if (original.includes(word) && !output.includes(word)) { warnings.push('否定或限制条件有变化'); break; }
  }
  if (/<\/?think>|```|作为.*助手|以下是.*整理/.test(output)) warnings.push('结果包含额外说明');
  return warnings;
}

function prepareDailyText(text) {
  return text
    .replace(/^那个[，,\s]*(?=我|你|咱们|我们|麻烦|请)/, '')
    .replace(/\d{1,2}(?::\d{2}|点(?:半)?)[，,\s]*(?:不对|说错了)[，,\s]*(\d{1,2}(?::\d{2}|点(?:半)?))/g, '$1')
    .replace(/周[一二三四五六日天][，,\s]*(?:不对|说错了)[，,\s]*(周[一二三四五六日天])/g, '$1');
}

function inspectTranslation(original, output) {
  const warnings = [];
  const numbers = (text) => (formatNumbers(text).replace(/(?<=\d),(?=\d{3}\b)/g, '').match(/\d+(?:[.:]\d+)?%?/g) || []).sort().join('|');
  if (numbers(original) !== numbers(output)) warnings.push('请核对译文中的数字或时间');
  if (/不要|别|不能|没有|不想|不需要|不可以|没法|无法/.test(original)
    && !/\b(?:not|no|never|cannot|without|avoid|unable|don't|can't|won't|isn't|haven't|doesn't|didn't)\b/i.test(output.replace(/’/g, "'"))) warnings.push('请核对译文中的否定条件');
  if (/可能|也许|不确定/.test(original) && !/\b(?:may|might|maybe|perhaps|possibly|possible|sure|uncertain)\b/i.test(output)) warnings.push('请核对译文是否保留不确定语气');
  if (/<\/?think>|```|^(?:here (?:is|are)|translation:|english translation:)/i.test(output)) warnings.push('译文可能包含额外说明');
  return warnings;
}

function textDifference(original, text) {
  if (original.length + text.length > 16000) return [];
  return diffChars(original, text).map(({ added, removed, value }) => ({ added: !!added, removed: !!removed, value }));
}

module.exports = { featureDefaults, normalizeFeatures, applyDictionary, formatNumbers, formatText, prepareDailyText, inspectRewrite, inspectTranslation, textDifference, simplify };
