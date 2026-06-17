'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { execFile } = require('child_process');

const ffmpegPath = require('ffmpeg-static');
const ffmpeg     = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const db       = require('../database/db');
const tts      = require('./tts');
const { generateSRT } = require('./subtitle');
const persona  = require('../config/persona.json');

const OUTPUT_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'AINewsTrendStudio', 'renders')
  : path.join(os.tmpdir(), 'AINewsTrendStudio');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────

// Escape a file path for use inside ffmpeg filter graph (Windows-safe)
function escapeFfmpegPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/i, '$1\\:').replace(/'/g, "\\'");
}

// Concatenate WAV files into one via ffmpeg concat demuxer
function concatAudio(wavPaths, outPath) {
  return new Promise((resolve, reject) => {
    const listFile = outPath + '.lst';
    const content  = wavPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
    fs.writeFileSync(listFile, content, 'utf8');

    execFile(ffmpegPath, [
      '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y', outPath,
    ], (err) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      if (err) return reject(new Error('[render] concat audio: ' + err.message));
      resolve(outPath);
    });
  });
}

// Download a single image URL to a local file; returns local path or null
async function downloadImage(url, destPath) {
  try {
    const axios = require('axios');
    const resp  = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    fs.writeFileSync(destPath, Buffer.from(resp.data));
    return destPath;
  } catch {
    return null;
  }
}

// Build a single-image video clip (1080x1920, given duration)
function makeImageClip(imgPath, duration, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(imgPath)
      .inputOptions(['-loop 1', `-t ${duration}`])
      .videoFilters([
        'scale=1080:1920:force_original_aspect_ratio=decrease',
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#0f0f13',
        'setsar=1',
        'fps=30',
      ])
      .videoCodec('libx264')
      .addOutputOptions(['-preset ultrafast', '-tune stillimage', '-crf 28'])
      .noAudio()
      .output(outPath)
      .outputOptions(['-y'])
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Build a color-fill video clip (1080x1920, given duration)
function makeColorClip(duration, color, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`color=c=${color}:s=1080x1920:r=30:d=${duration}`)
      .inputOptions(['-f lavfi'])
      .videoCodec('libx264')
      .addOutputOptions(['-preset ultrafast', '-crf 28'])
      .noAudio()
      .output(outPath)
      .outputOptions(['-y'])
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Concatenate video clips using concat demuxer (same codec required)
function concatVideoClips(clipPaths, outPath) {
  return new Promise((resolve, reject) => {
    const listFile = outPath + '.lst';
    const content  = clipPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
    fs.writeFileSync(listFile, content, 'utf8');

    execFile(ffmpegPath, [
      '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y', outPath,
    ], (err) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      if (err) return reject(new Error('[render] concat video: ' + err.message));
      resolve(outPath);
    });
  });
}

// Mux video + audio + burn subtitles → final MP4
function muxAndSubtitle({ videoPath, audioPath, srtPath, outputPath, totalDuration }) {
  return new Promise((resolve, reject) => {
    const srtEsc = escapeFfmpegPath(srtPath);
    const style  = [
      'FontName=Malgun Gothic',
      'FontSize=22',
      'PrimaryColour=&Hffffff',
      'BackColour=&H99000000',
      'BorderStyle=1',
      'Outline=1',
      'MarginV=60',
      'Alignment=2',
    ].join(',');

    const args = [
      '-i', videoPath,
      '-i', audioPath,
      '-vf', `subtitles='${srtEsc}':force_style='${style}'`,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k',
      '-t', String(Math.ceil(totalDuration)),
      '-y',
      outputPath,
    ];

    console.log('[render] mux cmd:', ffmpegPath, args.join(' '));

    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        return reject(new Error('[render] mux: ' + (stderr || err.message)));
      }
      resolve();
    });
  });
}

// ── Main render pipeline ───────────────────────────────────────────────────

/**
 * renderShort(scriptId, voiceId, onProgress)
 *
 * Full pipeline:
 *   1. TTS for intro / commentary / narration / outro
 *   2. Concat audio
 *   3. Build SRT
 *   4. Download images (if any)
 *   5. Build video segments (image slideshow or color bg)
 *   6. Concat video
 *   7. Mux + burn subtitles
 *   8. Update DB
 */
async function renderShort(scriptId, voiceId = 'Kore', onProgress = () => {}) {
  const row = db.prepare(`
    SELECT s.*, a.title as article_title, a.imageUrls
    FROM scripts s
    JOIN articles a ON s.article_id = a.id
    WHERE s.id = ?
  `).get([scriptId]);

  if (!row) throw new Error(`Script ${scriptId} not found`);
  if (!(row.myCommentary || '').trim()) {
    throw new Error('myCommentary가 비어있습니다. 코멘트를 입력한 후 렌더링하세요.');
  }

  const tmpFiles = [];
  const tag = `${scriptId}_${Date.now()}`;

  function tmp(name) {
    const p = path.join(OUTPUT_DIR, `${tag}_${name}`);
    tmpFiles.push(p);
    return p;
  }

  try {
    // ── 1. TTS ──────────────────────────────────────────────────────────
    onProgress(5, '인트로 나레이션 생성 중...');
    const introAudio = await tts.generateNarration(persona.introTemplate, voiceId);

    onProgress(18, '코멘터리 나레이션 생성 중...');
    const commentaryAudio = await tts.generateNarration(row.myCommentary, voiceId);

    onProgress(35, '본문 나레이션 생성 중...');
    const narrationAudio = await tts.generateNarration(row.content, voiceId);

    onProgress(52, '아웃트로 나레이션 생성 중...');
    const outroAudio = await tts.generateNarration(persona.outroTemplate, voiceId);

    tmpFiles.push(introAudio.audioPath, commentaryAudio.audioPath, narrationAudio.audioPath, outroAudio.audioPath);

    const introDur       = introAudio.duration;
    const commentaryDur  = commentaryAudio.duration;
    const narrationDur   = narrationAudio.duration;
    const outroDur       = outroAudio.duration;
    const totalDuration  = introDur + commentaryDur + narrationDur + outroDur;

    // ── 2. Concat audio ──────────────────────────────────────────────────
    onProgress(55, '오디오 합산 중...');
    const combinedAudio = tmp('audio.wav');
    await concatAudio(
      [introAudio.audioPath, commentaryAudio.audioPath, narrationAudio.audioPath, outroAudio.audioPath],
      combinedAudio,
    );

    // ── 3. SRT ───────────────────────────────────────────────────────────
    onProgress(57, '자막 생성 중...');
    const srtContent = generateSRT([
      { text: persona.introTemplate,  duration: introDur },
      { text: row.myCommentary,       duration: commentaryDur },
      { text: row.content,            duration: narrationDur,   splitIntoSentences: true },
      { text: persona.outroTemplate,  duration: outroDur },
    ]);
    const srtPath = path.join(OUTPUT_DIR, `${scriptId}.srt`);
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    tmpFiles.push(srtPath);

    // ── 4. Images ─────────────────────────────────────────────────────────
    onProgress(59, '이미지 준비 중...');
    let imgUrls = [];
    try { imgUrls = JSON.parse(row.imageUrls || '[]'); } catch (_) {}

    const localImages = [];
    for (let i = 0; i < imgUrls.length; i++) {
      const dest = tmp(`img${i}.jpg`);
      const p    = await downloadImage(imgUrls[i], dest);
      if (p) localImages.push(p);
    }

    // ── 5. Build video segments ───────────────────────────────────────────
    onProgress(62, '영상 슬라이드 합성 중...');
    const segVideos = [];

    // Intro: dark background
    const introClip = tmp('seg_intro.mp4');
    await makeColorClip(introDur, '#0f0f13', introClip);
    segVideos.push(introClip);

    // Commentary: slightly lighter background
    const commentaryClip = tmp('seg_commentary.mp4');
    await makeColorClip(commentaryDur, '#1a1a2e', commentaryClip);
    segVideos.push(commentaryClip);

    // Narration: image slideshow or dark background
    if (localImages.length > 0) {
      const perImg = narrationDur / localImages.length;
      for (let i = 0; i < localImages.length; i++) {
        const imgClip = tmp(`seg_img${i}.mp4`);
        await makeImageClip(localImages[i], perImg, imgClip);
        segVideos.push(imgClip);
      }
    } else {
      const narrClip = tmp('seg_narr.mp4');
      await makeColorClip(narrationDur, '#0f0f13', narrClip);
      segVideos.push(narrClip);
    }

    // Outro: dark background
    const outroClip = tmp('seg_outro.mp4');
    await makeColorClip(outroDur, '#0f0f13', outroClip);
    segVideos.push(outroClip);

    // ── 6. Concat video ───────────────────────────────────────────────────
    onProgress(80, '영상 클립 연결 중...');
    const rawVideo = tmp('raw.mp4');
    await concatVideoClips(segVideos, rawVideo);

    // ── 7. Mux + subtitle burn-in ─────────────────────────────────────────
    onProgress(85, '자막 합성 및 최종 인코딩 중...');
    const outputPath = path.join(OUTPUT_DIR, `${scriptId}.mp4`);
    await muxAndSubtitle({ videoPath: rawVideo, audioPath: combinedAudio, srtPath, outputPath, totalDuration });

    // ── 8. Update DB ──────────────────────────────────────────────────────
    db.prepare('UPDATE scripts SET renderStatus=?, renderPath=?, renderProgress=100 WHERE id=?')
      .run(['done', outputPath, scriptId]);

    onProgress(100, '완료');
    return outputPath;
  } finally {
    // Cleanup intermediates (keep final MP4 and SRT)
    for (const f of tmpFiles) {
      if (f !== path.join(OUTPUT_DIR, `${scriptId}.srt`)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  }
}

module.exports = { renderShort };
