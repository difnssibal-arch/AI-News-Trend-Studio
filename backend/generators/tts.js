require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const OUTPUT_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'AINewsTrendStudio', 'renders')
  : path.join(os.tmpdir(), 'AINewsTrendStudio');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Korean-first voice list (as of Gemini 2.5)
const KOREAN_VOICES = [
  { id: 'Kore',   name: '코레 (여성, 한국어 최적화)' },
  { id: 'Charon', name: '샤론 (남성, 한국어 최적화)' },
  { id: 'Aoede',  name: '아오에데 (여성, 다국어)' },
  { id: 'Puck',   name: '퍽 (남성, 다국어)' },
];

// Build WAV header for raw PCM (L16) data
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const dataLen = pcmBuffer.length;
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + dataLen, 4);
  hdr.write('WAVE', 8);
  hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(channels, 22);
  hdr.writeUInt32LE(sampleRate, 24);
  hdr.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  hdr.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  hdr.writeUInt16LE(bitsPerSample, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(dataLen, 40);
  return Buffer.concat([hdr, pcmBuffer]);
}

// Parse sample rate from L16 MIME type: "audio/L16;rate=24000;channels=1"
function parseSampleRate(mimeType) {
  const m = (mimeType || '').match(/rate[=\s]?(\d+)/i);
  return m ? parseInt(m[1]) : 24000;
}

// Read WAV duration from header
function wavDuration(buf) {
  if (buf.length < 44) return 0;
  // Find "data" chunk
  for (let i = 12; i < Math.min(buf.length - 8, 512); i++) {
    if (buf.slice(i, i + 4).toString('ascii') === 'data') {
      const dataSize = buf.readUInt32LE(i + 4);
      const byteRate = buf.readUInt32LE(28);
      return byteRate > 0 ? dataSize / byteRate : 0;
    }
  }
  return 0;
}

// Estimate duration for Korean text (fallback when API fails)
function estimateDuration(text) {
  // ~3.5 chars/sec Korean TTS average
  return Math.max(1, text.replace(/\s+/g, '').length / 3.5);
}

// Generate a silent WAV file of given duration
function silentWav(durationSec, sampleRate = 24000) {
  const numSamples = Math.ceil(durationSec * sampleRate);
  return pcmToWav(Buffer.alloc(numSamples * 2, 0), sampleRate);
}

async function generateNarration(text, voiceId = 'Kore') {
  if (!text || !text.trim()) {
    // Return 0.5s silence for empty text
    const silPath = path.join(OUTPUT_DIR, `silence_${Date.now()}.wav`);
    fs.writeFileSync(silPath, silentWav(0.5));
    return { audioPath: silPath, duration: 0.5, silent: true };
  }

  let model;
  // Try gemini-2.5-flash-preview-tts first, fall back to gemini-2.0-flash-exp
  for (const modelName of ['gemini-2.5-flash-preview-tts', 'gemini-2.0-flash-exp']) {
    try {
      model = client.getGenerativeModel({ model: modelName });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceId },
            },
          },
        },
      });

      const part = result.response.candidates?.[0]?.content?.parts?.[0];
      if (!part?.inlineData?.data) throw new Error('No audio data in response');

      const rawBuf   = Buffer.from(part.inlineData.data, 'base64');
      const mimeType = part.inlineData.mimeType || '';

      let wavBuf;
      if (mimeType.toLowerCase().includes('l16') || mimeType.toLowerCase().includes('pcm')) {
        const sr = parseSampleRate(mimeType);
        wavBuf = pcmToWav(rawBuf, sr);
      } else {
        // Assume it's already WAV
        wavBuf = rawBuf;
      }

      const audioPath = path.join(OUTPUT_DIR, `narr_${Date.now()}.wav`);
      fs.writeFileSync(audioPath, wavBuf);
      const duration = wavDuration(wavBuf) || estimateDuration(text);

      console.log(`[tts] "${text.slice(0, 30)}..." → ${duration.toFixed(1)}s (${modelName})`);
      return { audioPath, duration };
    } catch (err) {
      console.warn(`[tts] ${modelName} failed: ${err.message}`);
    }
  }

  // All models failed → use silence + estimated duration
  console.warn('[tts] TTS failed, using silence');
  const duration  = estimateDuration(text);
  const audioPath = path.join(OUTPUT_DIR, `silent_${Date.now()}.wav`);
  fs.writeFileSync(audioPath, silentWav(duration));
  return { audioPath, duration, silent: true };
}

module.exports = { generateNarration, KOREAN_VOICES };
