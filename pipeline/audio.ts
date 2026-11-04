/**
 * Pure-TypeScript audio processing for the story track — no ffmpeg, so the
 * pipeline runs anywhere Node runs (locally and in Vercel Functions).
 *
 * Radio clips arrive as short PCM WAVs (16 kHz mono from Enhanced Radar).
 * We decode to mono float, band-pass to the radio range, normalize loudness,
 * resample, and concatenate with gaps of quiet static.
 */
import fs from "node:fs";
import path from "node:path";

/** Mono audio as floats in [-1, 1]. */
export type Pcm = { rate: number; samples: Float32Array };

// ---------- WAV I/O ----------

/** Decodes a PCM (8/16/24/32-bit int or 32-bit float) WAV of any channel count to mono. */
export function readWav(file: string): Pcm {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not a WAV file: ${file}`);
  }
  let offset = 12;
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === "data") {
      if (!channels || !rate) throw new Error(`WAV has no fmt chunk before data: ${file}`);
      // Only linear PCM and 32-bit float; anything else (e.g. µ-law) would decode to noise.
      if (!(format === 1 && [8, 16, 24, 32].includes(bits)) && !(format === 3 && bits === 32)) {
        throw new Error(`Unsupported WAV encoding (format ${format}, ${bits}-bit): ${file}`);
      }
      const available = buf.length - body;
      const dataSize = size === 0 || size === 0xffffffff ? available : Math.min(size, available);
      const bytesPer = bits / 8;
      const frames = Math.floor(dataSize / (bytesPer * channels));
      const out = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (f * channels + c) * bytesPer;
          sum += sampleAt(buf, p, format, bits);
        }
        out[f] = sum / channels;
      }
      return { rate, samples: out };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`WAV has no data chunk: ${file}`);
}

function sampleAt(buf: Buffer, p: number, format: number, bits: number): number {
  if (format === 3 && bits === 32) return buf.readFloatLE(p);
  switch (bits) {
    case 8:
      return (buf.readUInt8(p) - 128) / 128;
    case 16:
      return buf.readInt16LE(p) / 32768;
    case 24:
      return buf.readIntLE(p, 3) / 8388608;
    case 32:
      return buf.readInt32LE(p) / 2147483648;
    default:
      throw new Error(`Unsupported WAV bit depth: ${bits}`);
  }
}

/** Encodes mono float audio as a 16-bit PCM WAV. */
export function encodeWav(pcm: Pcm): Buffer {
  const n = pcm.samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(pcm.rate, 24);
  buf.writeUInt32LE(pcm.rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm.samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2);
  }
  return buf;
}

export function writeWav(file: string, pcm: Pcm) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodeWav(pcm));
}

export const durationSec = (pcm: Pcm) => pcm.samples.length / pcm.rate;

// ---------- processing ----------

/** Linear-interpolation resampler (fine for speech band-limited to ~4 kHz). */
export function resample(pcm: Pcm, rate: number): Pcm {
  if (pcm.rate === rate) return pcm;
  const ratio = pcm.rate / rate;
  const n = Math.floor(pcm.samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, pcm.samples.length - 1);
    const t = x - i0;
    out[i] = pcm.samples[i0] * (1 - t) + pcm.samples[i1] * t;
  }
  return { rate, samples: out };
}

/** RBJ-cookbook biquad, applied in place. */
function biquad(samples: Float32Array, rate: number, type: "highpass" | "lowpass", freq: number, q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * freq) / rate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = type === "lowpass" ? 1 - cos : -(1 + cos);
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    samples[i] = y0;
  }
}

/** Keeps the radio voice band (removes rumble and hiss). */
export function radioBand(pcm: Pcm, lowHz = 200, highHz = 3800): Pcm {
  const samples = Float32Array.from(pcm.samples);
  const nyquistSafeHigh = Math.min(highHz, pcm.rate * 0.45);
  biquad(samples, pcm.rate, "highpass", lowHz);
  biquad(samples, pcm.rate, "lowpass", nyquistSafeHigh);
  return { rate: pcm.rate, samples };
}

/**
 * Loudness normalization: measures RMS over the voiced parts (50 ms windows
 * above a −50 dBFS gate), applies gain to reach `targetDb` RMS, and soft-limits
 * peaks so nothing clips. Roughly equivalent to −16 LUFS for radio speech.
 */
export function normalizeLoudness(pcm: Pcm, targetDb = -16, ceiling = 0.89): Pcm {
  const win = Math.max(1, Math.round(pcm.rate * 0.05));
  const gate = 10 ** (-50 / 20);
  let power = 0;
  let count = 0;
  for (let start = 0; start < pcm.samples.length; start += win) {
    let sum = 0;
    const end = Math.min(start + win, pcm.samples.length);
    for (let i = start; i < end; i++) sum += pcm.samples[i] ** 2;
    const rms = Math.sqrt(sum / (end - start));
    if (rms > gate) {
      power += sum;
      count += end - start;
    }
  }
  if (count === 0) return pcm; // silent clip
  const rms = Math.sqrt(power / count);
  const gain = Math.min(10 ** (targetDb / 20) / rms, 30); // cap boost at ~+30 dB
  const out = new Float32Array(pcm.samples.length);
  for (let i = 0; i < out.length; i++) out[i] = ceiling * Math.tanh((pcm.samples[i] * gain) / ceiling);
  return { rate: pcm.rate, samples: out };
}

/** Quiet pink-ish radio static (Paul Kellet's economy filter), or silence when amplitude is 0. */
export function gap(rate: number, seconds: number, amplitude = 0.012, seed = 1): Pcm {
  const n = Math.max(0, Math.round(rate * seconds));
  const out = new Float32Array(n);
  if (amplitude > 0) {
    let s = seed >>> 0 || 1;
    const rand = () => {
      // xorshift32: deterministic so re-runs produce identical files
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296 - 0.5;
    };
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const white = rand() * 2;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      out[i] = (b0 + b1 + b2 + white * 0.1848) * amplitude * 0.25;
    }
  }
  return { rate, samples: out };
}

export function concat(parts: Pcm[]): Pcm {
  if (parts.length === 0) throw new Error("Nothing to concatenate");
  const rate = parts[0].rate;
  if (parts.some((p) => p.rate !== rate)) throw new Error("All parts must share a sample rate");
  const total = parts.reduce((n, p) => n + p.samples.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p.samples, offset);
    offset += p.samples.length;
  }
  return { rate, samples: out };
}

/** Band-pass, normalize and resample one radio clip. */
export function prepareClip(file: string, rate: number): Pcm {
  return resample(normalizeLoudness(radioBand(readWav(file))), rate);
}
