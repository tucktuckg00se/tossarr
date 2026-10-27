/** Deterministic poster SVG generated from a title. Used as the fallback when a real poster is unavailable. */
export function posterSvg(title: string, subtitle = ''): string {
  const hue = hashString(title) % 360;
  const initials =
    title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => (w[0] ?? '').toUpperCase())
      .join('') || '?';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">',
    `<rect width="300" height="450" fill="hsl(${hue}, 45%, 26%)"/>`,
    `<text x="150" y="230" font-family="sans-serif" font-size="96" fill="#ffffff" text-anchor="middle">${escapeXml(
      initials,
    )}</text>`,
    subtitle
      ? `<text x="150" y="400" font-family="sans-serif" font-size="18" fill="rgba(255,255,255,0.75)" text-anchor="middle">${escapeXml(
          subtitle,
        )}</text>`
      : '',
    '</svg>',
  ].join('');
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
