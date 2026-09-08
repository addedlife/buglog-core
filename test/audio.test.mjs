import test from 'node:test';
import assert from 'node:assert/strict';
import { recorderOptions, startAudioCapture, pcmSliceToWavBlob, transcribeAudioBlob, mergeDictation } from '../src/audio.js';

test('format fallback works without SpeechRecognition or WebM', () => {
  assert.deepEqual(recorderOptions({ isTypeSupported: type => type === 'audio/mp4' }), { mimeType: 'audio/mp4' });
  assert.deepEqual(recorderOptions({ isTypeSupported: () => false }), {});
});
test('stop includes the last audio chunk and preserves the actual format', async () => {
  let instance, stopped = 0;
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor() { instance = this; this.mimeType = 'audio/mp4'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['last']) }); this.onstop(); }
  }
  let resolveEnd;
  const ended = new Promise(resolve => { resolveEnd = resolve; });
  let value;
  const session = startAudioCapture({ onBlob: async blob => { value = [await blob.text(), blob.type]; }, onEnd: resolveEnd }, {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) } }, MediaRecorder: Recorder,
  });
  await Promise.resolve();
  assert.equal(instance.state, 'recording');
  session.stop(); await ended;
  assert.deepEqual(value, ['last', 'audio/mp4']); assert.ok(stopped > 0);
});
test('cancel while permission is pending closes the eventual stream', async () => {
  let permit, stopped = 0, blobCalled = false;
  const session = startAudioCapture({ onBlob: () => { blobCalled = true; } }, {
    navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { permit = resolve; }) } },
  });
  session.abort(); permit({ getTracks: () => [{ stop() { stopped++; } }] }); await Promise.resolve();
  assert.equal(stopped, 1); assert.equal(blobCalled, false);
});
test('WAV encoding is mono 16 kHz with correct length and clipping', async () => {
  const view = new DataView(await pcmSliceToWavBlob(new Float32Array([-2, 0, 2])).arrayBuffer());
  assert.equal(view.byteLength, 50); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(48, true), 32767);
});
test('every part uses the same job and preserves finished words exactly', async () => {
  const inputs = [];
  const expected = ['Rashi discussed the pressure.', 'I am sure the rash improved.'];
  const text = await transcribeAudioBlob(null, async (job, input) => { inputs.push([job, input]); return { output: expected[input.part - 1] }; }, {
    parts: async () => [{ base64: 'first', mimeType: 'audio/wav' }, { base64: 'last', mimeType: 'audio/wav' }],
  });
  assert.equal(text, expected.join('\n'));
  assert.deepEqual(inputs.map(([job, input]) => [job, input.part, input.totalParts]), [['transcribe.yeshivish.v1', 1, 2], ['transcribe.yeshivish.v1', 2, 2]]);
  await assert.rejects(transcribeAudioBlob(null, async () => '', { parts: async () => [{ base64: 'x' }] }), /No transcript/);
});
test('typing during transcription survives the final result', () => {
  assert.equal(mergeDictation('Typed while waiting', 'Base', 'Base', 'Spoken'), 'Typed while waiting Spoken');
  assert.equal(mergeDictation('Base provisional', 'Base', 'Base provisional', 'Final'), 'Base Final');
});
