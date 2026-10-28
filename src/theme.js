export const defaultTheme = { accent: '#c5a572', background: '#111411' };
const rgb = (hex) => hex.match(/[a-f\d]{2}/gi).map((x) => parseInt(x, 16));
const luminance = (hex) =>
  rgb(hex)
    .map((x) => {
      x /= 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
export function applyTheme(colors = defaultTheme, office = false) {
  if (![colors.accent, colors.background].every((c) => /^#[a-f\d]{6}$/i.test(c))) return;
  const dark = luminance(colors.background) < 0.18;
  let fg = dark ? '#f6f4ed' : '#171b18';
  if (contrast(fg, colors.background) < 4.5)
    fg = contrast('#000000', colors.background) >= contrast('#ffffff', colors.background) ? '#000000' : '#ffffff';
  const mix = (hex, target, amount) =>
    '#' +
    rgb(hex)
      .map((v, i) =>
        Math.round(v * (1 - amount) + rgb(target)[i] * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  const onAccent = contrast(colors.accent, '#000000') >= contrast(colors.accent, '#ffffff') ? '#000000' : '#ffffff';
  const surface = (amount) => {
    const color = mix(colors.background, fg, amount);
    return contrast(color, fg) >= 4.5 ? color : colors.background;
  };
  const panel = surface(0.055),
    raised = surface(0.095);
  const readable = (color) => [colors.background, panel, raised].every((bg) => contrast(color, bg) >= 4.5);
  let muted = mix(colors.background, fg, 0.68);
  for (let amount = 0.72; !readable(muted) && amount <= 1.01; amount += 0.04)
    muted = mix(colors.background, fg, Math.min(amount, 1));
  const vars = {
    bg: colors.background,
    panel,
    raised,
    fg,
    muted,
    line: mix(colors.background, fg, 0.2),
    accent: colors.accent,
    'on-accent': onAccent,
    highlight: readable(colors.accent) ? colors.accent : fg,
  };
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) root.style.setProperty('--' + key, value);
  root.style.colorScheme = dark ? 'dark' : 'light';
  if (office) {
    for (const [key, value] of Object.entries({
      cream: vars.bg,
      ink: fg,
      grey: vars.muted,
      hairline: vars.line,
      red: vars.highlight,
    }))
      document.body.style.setProperty('--' + key, value);
  }
}
