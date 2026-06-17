'use strict';

// Format seconds → "HH:MM:SS,mmm"
function formatSRTTime(sec) {
  const h   = Math.floor(sec / 3600);
  const m   = Math.floor((sec % 3600) / 60);
  const s   = Math.floor(sec % 60);
  const ms  = Math.round((sec - Math.floor(sec)) * 1000);
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':') + ',' + String(ms).padStart(3, '0');
}

// Split Korean/English script into natural sentences
function splitSentences(text) {
  if (!text) return [];
  // Split on sentence-ending punctuation (Korean + English), keep delimiter with preceding text
  return text
    .replace(/([.!?！？。\n])\s*/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Build SRT entries for a single segment.
 * If splitIntoSentences is true, the text is split and each sentence
 * gets time proportional to its character length (글자수 비례).
 */
function buildSegmentEntries(text, startSec, durationSec, splitIntoSentences = false) {
  if (!text || !text.trim() || durationSec <= 0) return [];

  if (!splitIntoSentences) {
    return [{ start: startSec, end: startSec + durationSec, text: text.trim() }];
  }

  const sentences = splitSentences(text).filter(s => s.length >= 2);
  if (sentences.length === 0) return [];
  if (sentences.length === 1) {
    return [{ start: startSec, end: startSec + durationSec, text: sentences[0] }];
  }

  const totalChars = sentences.reduce((sum, s) => sum + s.replace(/\s/g, '').length, 0);
  const entries = [];
  let t = startSec;

  for (const sentence of sentences) {
    const chars    = sentence.replace(/\s/g, '').length;
    const segDur   = (chars / totalChars) * durationSec;
    entries.push({ start: t, end: t + segDur, text: sentence });
    t += segDur;
  }

  return entries;
}

/**
 * generateSRT(segments, audioDuration)
 *
 * segments: array of { text, duration, splitIntoSentences? }
 *   Text segments in playback order. Durations must sum to audioDuration.
 *
 * Returns: SRT string
 */
function generateSRT(segments) {
  const allEntries = [];
  let t = 0;
  for (const seg of segments) {
    if (seg.duration <= 0 || !seg.text?.trim()) { t += seg.duration || 0; continue; }
    const entries = buildSegmentEntries(seg.text, t, seg.duration, seg.splitIntoSentences ?? false);
    allEntries.push(...entries);
    t += seg.duration;
  }

  return allEntries
    .map((e, i) => `${i + 1}\n${formatSRTTime(e.start)} --> ${formatSRTTime(e.end)}\n${e.text}`)
    .join('\n\n') + '\n';
}

module.exports = { generateSRT, splitSentences, formatSRTTime };
