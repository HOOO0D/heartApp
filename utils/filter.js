export function designNotchFilter(fs, f0, Q) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * Q);

  const b0 = 1;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;

  return {
      b: [b0 / a0, b1 / a0, b2 / a0],
      a: [1, a1 / a0, a2 / a0]
  };
}

export function applyIIRFilter(input, b, a) {
  const output = [];
  for (let i = 0; i < input.length; i++) {
      output[i] = (
          b[0] * input[i] +
          (b[1] * (input[i - 1] || 0)) +
          (b[2] * (input[i - 2] || 0)) -
          (a[1] * (output[i - 1] || 0)) -
          (a[2] * (output[i - 2] || 0))
      );
  }
  return output;
}

export function generateSignal(length, fs) {
  const signal = [];
  for (let i = 0; i < length; i++) {
      const t = i / fs;
      const s = Math.sin(2 * Math.PI * 10 * t) + 0.5 * Math.sin(2 * Math.PI * 50 * t);
      signal.push(s);
  }
  return signal;
}