// Browser audio mechanics shared by both apps. The host supplies the authenticated
// job runner; this module has no network or account access.
export const TRANSCRIPTION_JOB = 'transcribe.yeshivish.v1';
export const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
const SAMPLE_RATE = 16000;

export function recorderOptions(Recorder = globalThis.MediaRecorder) {
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
    .find(type => Recorder?.isTypeSupported?.(type));
  return mimeType ? { mimeType } : {};
}

// Return a stop/abort handle immediately, including while permission is pending.
// onBlob runs only after the final dataavailable event and before onEnd.
export function startAudioCapture({ onBlob, onError, onEnd, maxMs = 600000 }, env = globalThis) {
  let recorder, stream, timer, canceled = false, stopping = false, ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop());
    onEnd?.();
  };
  const stop = () => {
    stopping = true;
    if (recorder?.state === 'recording') recorder.stop();
  };
  const session = { stop, abort() { canceled = true; stop(); finish(); } };
  (async () => {
    try {
      stream = await env.navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (canceled || stopping) { stream.getTracks().forEach(track => track.stop()); finish(); return; }
      recorder = new env.MediaRecorder(stream, recorderOptions(env.MediaRecorder));
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = event => {
        if (!canceled) onError?.(event.error?.message || 'Recording failed.');
        canceled = true; stop(); finish();
      };
      recorder.onstop = async () => {
        clearTimeout(timer);
        stream.getTracks().forEach(track => track.stop());
        try {
          if (!canceled) {
            const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
            if (!blob.size) throw new Error('No audio was recorded.');
            await onBlob(blob);
          }
        } catch (error) { if (!canceled) onError?.(error.message || 'Transcription failed.'); }
        finally { finish(); }
      };
      recorder.start(1000);
      timer = setTimeout(stop, maxMs);
    } catch (error) {
      if (!canceled) onError?.(error.message || 'Could not start recording.');
      finish();
    }
  })();
  return session;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Audio read failed.'));
    reader.readAsDataURL(blob);
  });
}
export async function decodeToPcm16k(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const context = new Context();
  let decoded;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  finally { await context.close(); }
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded; source.connect(offline.destination); source.start(0);
  return (await offline.startRendering()).getChannelData(0);
}
export function pcmSliceToWavBlob(pcm, start = 0, end = pcm.length) {
  const length = end - start;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[start + i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
export async function wavChunks(blob, chunkSeconds = 240) {
  const pcm = await decodeToPcm16k(blob);
  const frames = Math.max(1, Math.floor(chunkSeconds * SAMPLE_RATE));
  const chunks = [];
  for (let start = 0; start < pcm.length; start += frames) chunks.push(await blobToBase64(pcmSliceToWavBlob(pcm, start, Math.min(pcm.length, start + frames))));
  return chunks;
}
export async function prepareAudioParts(blob) {
  try { return (await wavChunks(blob)).map(base64 => ({ base64, mimeType: 'audio/wav' })); }
  catch {
    if (blob.size > 14 * 1024 * 1024) throw new Error('This recording could not be converted and is too large to upload whole.');
    return [{ base64: await blobToBase64(blob), mimeType: blob.type || 'audio/webm' }];
  }
}
export function transcriptText(result) {
  const output = result?.output ?? result?.text ?? result;
  return String(typeof output === 'string' ? output : output?.transcript || '').trim();
}
export async function transcribeAudioBlob(blob, runJob, { parts = prepareAudioParts, onProgress } = {}) {
  const chunks = await parts(blob);
  const transcripts = [];
  for (let index = 0; index < chunks.length; index++) {
    onProgress?.(index + 1, chunks.length);
    const result = await runJob(TRANSCRIPTION_JOB, { ...chunks[index], part: index + 1, totalParts: chunks.length });
    const text = transcriptText(result);
    if (!text) throw new Error('No transcript was returned. Please retry the recording.');
    transcripts.push(text);
  }
  if (!transcripts.length) throw new Error('No audio was recorded.');
  return transcripts.join('\n');
}

export function mergeDictation(current, base, preview, final) {
  const prefix = current === preview ? base : current;
  return [prefix.trim(), final.trim()].filter(Boolean).join(' ');
}
