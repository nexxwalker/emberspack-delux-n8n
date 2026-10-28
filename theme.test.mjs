import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme } from './src/theme.js';
const lum = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
test('custom colors keep primary, muted and accent text readable on every surface', () => {
  const values = {};
  const original = globalThis.document;
  globalThis.document = { documentElement: { style: { setProperty: (key, value) => (values[key] = value) } } };
  try {
    for (const background of [
      '#111411',
      '#f5f1e8',
      '#000000',
      '#ffffff',
      '#777777',
      '#747474',
      '#808080',
      '#bfffff',
      '#ff00ff',
      '#0040ff',
    ]) {
      for (const accent of ['#c5a572', '#ffffff', '#000000', '#777777', '#ff0000']) {
        applyTheme({ background, accent });
        for (const fg of ['--fg', '--muted', '--highlight'])
          for (const bg of ['--bg', '--panel', '--raised'])
            assert.ok(ratio(values[fg], values[bg]) >= 4.5, `${fg} on ${bg}: ${background} / ${accent}`);
        assert.ok(ratio(values['--on-accent'], accent) >= 4.5);
      }
    }
    const previous = { ...values };
    applyTheme({ background: 'invalid', accent: '#ffffff' });
    assert.deepEqual(values, previous);
  } finally {
    globalThis.document = original;
  }
});
