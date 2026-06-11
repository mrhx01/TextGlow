'use strict';
const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

/* ═══════════════════════════════════════════════════════════
   FONT CACHE
═══════════════════════════════════════════════════════════ */
const fontCache = new Map();

async function getFont(name) {
  const key = name.toLowerCase().trim();
  if (fontCache.has(key)) return fontCache.get(key);
  try {
    const slug = encodeURIComponent(name.trim()).replace(/%20/g, '+');
    // Request with a modern Chrome UA to get woff2
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${slug}:ital,wght@0,400;0,700;1,400&display=swap`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      }
    ).then(r => (r.ok ? r.text() : null));

    if (!css) return null;

    // Prefer latin subset, fall back to first match
    const latinBlock = css.match(/\/\*\s*latin\s*\*\/[\s\S]*?src:\s*url\(([^)]+)\)/);
    const anyBlock   = css.match(/src:\s*url\(([^)]+)\)/);
    const fontUrl    = (latinBlock || anyBlock)?.[1]?.replace(/['"]/g, '');
    if (!fontUrl) return null;

    const buf = await fetch(fontUrl, { signal: AbortSignal.timeout(6000) })
      .then(r => (r.ok ? r.arrayBuffer() : null));
    if (!buf) return null;

    const b64 = Buffer.from(buf).toString('base64');
    const fmt = fontUrl.includes('.woff2') ? 'woff2' : 'woff';
    fontCache.set(key, { b64, fmt });
    return fontCache.get(key);
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
const esc = s =>
  String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hx = c => {
  const v = String(c ?? '').replace(/^#/, '');
  return /^[0-9a-fA-F]{3,8}$/.test(v) ? '#' + v : '#000000';
};

const clamp = (raw, lo, hi, def) => {
  const n = parseFloat(raw);
  return isNaN(n) ? def : Math.min(hi, Math.max(lo, n));
};

/* ═══════════════════════════════════════════════════════════
   PATTERNS  →  returns { def, rect }
═══════════════════════════════════════════════════════════ */
function makePattern(type, color, opacity) {
  if (!type || type === 'none') return { def: '', rect: '' };
  const c  = hx(color || 'ffffff');
  const op = (clamp(opacity, 0, 100, 10) / 100).toFixed(3);

  const defs = {
    dots:       `<pattern id="pat" width="20" height="20" patternUnits="userSpaceOnUse">
                   <circle cx="2" cy="2" r="1.4" fill="${c}" fill-opacity="${op}"/>
                 </pattern>`,
    grid:       `<pattern id="pat" width="24" height="24" patternUnits="userSpaceOnUse">
                   <path d="M24 0H0V24" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width=".6"/>
                 </pattern>`,
    diagonal:   `<pattern id="pat" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                   <line x1="0" y1="0" x2="0" y2="10" stroke="${c}" stroke-opacity="${op}" stroke-width="2"/>
                 </pattern>`,
    crosshatch: `<pattern id="pat" width="12" height="12" patternUnits="userSpaceOnUse">
                   <path d="M0 0L12 12M12 0L0 12" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width=".7"/>
                 </pattern>`,
    circles:    `<pattern id="pat" width="32" height="32" patternUnits="userSpaceOnUse">
                   <circle cx="16" cy="16" r="13" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width=".9"/>
                 </pattern>`,
    hex:        `<pattern id="pat" width="28" height="16" patternUnits="userSpaceOnUse">
                   <polygon points="14,.5 27.5,8 27.5,16 14,23.5 .5,16 .5,8" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width=".8"/>
                 </pattern>`,
    zigzag:     `<pattern id="pat" width="20" height="10" patternUnits="userSpaceOnUse">
                   <polyline points="0,10 5,0 10,10 15,0 20,10" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width=".9"/>
                 </pattern>`,
    waves:      `<pattern id="pat" width="40" height="12" patternUnits="userSpaceOnUse">
                   <path d="M0,6 Q5,0 10,6 Q15,12 20,6 Q25,0 30,6 Q35,12 40,6" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width=".9"/>
                 </pattern>`,
    plus:       `<pattern id="pat" width="16" height="16" patternUnits="userSpaceOnUse">
                   <path d="M8,3 V13 M3,8 H13" stroke="${c}" stroke-opacity="${op}" stroke-width=".8" stroke-linecap="round"/>
                 </pattern>`,
    triangles:  `<pattern id="pat" width="20" height="18" patternUnits="userSpaceOnUse">
                   <polygon points="10,1 19,17 1,17" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width=".8"/>
                 </pattern>`,
  };

  const def = defs[type];
  if (!def) return { def: '', rect: '' };
  return { def, rect: `<rect width="100%" height="100%" fill="url(#pat)"/>` };
}

/* ═══════════════════════════════════════════════════════════
   SHADOW FILTER
═══════════════════════════════════════════════════════════ */
function makeShadow(color, blur, dx, dy) {
  if (!color || color === 'none') return '';
  return `<filter id="sh" x="-40%" y="-40%" width="180%" height="180%">
  <feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur}"
    flood-color="${hx(color)}" flood-opacity=".8"/>
</filter>`;
}

/* ═══════════════════════════════════════════════════════════
   ANIMATION CSS
═══════════════════════════════════════════════════════════ */
function makeAnimCSS(type, t1, t2) {
  const c1 = hx(t1), c2 = hx(t2);
  const map = {
    fadein:
      '@keyframes fi{from{opacity:0}to{opacity:1}}' +
      '#gm{animation:fi .9s ease both}#gs{animation:fi .9s .35s ease both}',
    slidein:
      '@keyframes si{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}}' +
      '#gm{animation:si .75s cubic-bezier(.16,1,.3,1) both}' +
      '#gs{animation:si .75s .28s cubic-bezier(.16,1,.3,1) both}',
    slideup:
      '@keyframes su{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}' +
      '#gm{animation:su .75s cubic-bezier(.16,1,.3,1) both}' +
      '#gs{animation:su .75s .28s cubic-bezier(.16,1,.3,1) both}',
    glow:
      `@keyframes gl{0%,100%{filter:drop-shadow(0 0 4px ${c1}99)}50%{filter:drop-shadow(0 0 24px ${c2}dd)}}` +
      '#gm,#gs{animation:gl 2.4s ease-in-out infinite}',
    bounce:
      '@keyframes bo{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}' +
      '#gm{animation:bo 2s ease-in-out infinite}' +
      '#gs{animation:bo 2s .12s ease-in-out infinite}',
    pulse:
      '@keyframes pu{0%,100%{opacity:1}50%{opacity:.35}}' +
      '#gm{animation:pu 2s ease-in-out infinite}' +
      '#gs{animation:pu 2s .2s ease-in-out infinite}',
    shake:
      '@keyframes sk{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}' +
      '40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}' +
      '#gm{animation:sk .7s ease-in-out infinite}',
    rotate:
      '@keyframes ro{from{transform:rotate(-2deg)}to{transform:rotate(2deg)}}' +
      '#gm,#gs{animation:ro 3s ease-in-out infinite alternate;transform-origin:center}',
  };
  return map[type] || '';
}

/* ═══════════════════════════════════════════════════════════
   MAIN SVG BUILDER
═══════════════════════════════════════════════════════════ */
async function makeSVG(p) {
  // ── Text
  const text    = String(p.get('text')   ?? 'Hello World').slice(0, 200);
  const sub     = String(p.get('sub')    ?? '').slice(0, 200);
  // ── Font
  const font    = String(p.get('font')   ?? 'Caveat')
                    .replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 80) || 'Caveat';
  // ── Colors
  const bg1     = p.get('bg1')   ?? '0d0d0d';
  const bg2     = p.get('bg2')   ?? '1a1a2e';
  const t1      = p.get('t1')    ?? 'ff6b9d';
  const t2      = p.get('t2')    ?? 'a855f7';
  const sc      = p.get('sc')    ?? 'a78bfa';
  // ── Dimensions
  const size    = clamp(p.get('size'),     12, 100,  52);
  const subsize = p.get('subsize')
                    ? clamp(p.get('subsize'), 8, 80, Math.round(size * .44))
                    : Math.round(size * .44);
  const width   = clamp(p.get('width'),  300, 1600, 860);
  const defH    = Math.round(size * 3.2);
  const height  = p.get('height')
                    ? clamp(p.get('height'), 50, 500, defH)
                    : defH;
  const align   = ['left','center','right'].includes(p.get('align'))
                    ? p.get('align') : 'center';
  // ── Background
  const transparent = p.get('transparent') === '1' || p.get('transparent') === 'true';
  const pattern     = makePattern(
    p.get('pattern')  ?? 'none',
    p.get('patcolor') ?? 'ffffff',
    p.get('patop')    ?? '10'
  );
  // ── Shadow
  const shadowColor = p.get('shadow') ?? '';
  const shadowBlur  = clamp(p.get('shadowblur'),  0,  40, 8);
  const shadowX     = clamp(p.get('shadowx'),    -30, 30, 0);
  const shadowY     = clamp(p.get('shadowy'),    -30, 30, 3);
  // ── Animation
  const animate = p.get('animate') ?? 'none';

  // ── Layout
  const cx     = align === 'left' ? 40 : align === 'right' ? width - 40 : Math.round(width / 2);
  const anchor = { left: 'start', right: 'end', center: 'middle' }[align];
  const mainY  = sub ? Math.round(height * .41) : Math.round(height * .5);
  const subY   = Math.round(height * .76);

  // ── Font embed
  const fd = await getFont(font);
  const fontFaceCSS = fd
    ? `@font-face{font-family:'${font}';` +
      `src:url('data:font/${fd.fmt};base64,${fd.b64}')format('${fd.fmt}');` +
      `font-weight:100 900;}`
    : '';

  // ── Animation CSS
  const animCSS = makeAnimCSS(animate, t1, t2);

  // ── Combined style block
  const styleBlock = [fontFaceCSS, animCSS].filter(Boolean).join('\n');

  // ── Shadow filter
  const shadowFilter = makeShadow(shadowColor, shadowBlur, shadowX, shadowY);
  const filterAttr   = shadowColor ? ' filter="url(#sh)"' : '';

  // ── Typewriter SMIL
  const isTW     = animate === 'typewriter';
  const twOpen   = isTW
    ? `<clipPath id="tw"><rect x="0" y="0" height="${height}" width="0">` +
      `<animate attributeName="width" from="0" to="${width}" dur="1.8s" fill="freeze"/></rect></clipPath>` +
      `<g clip-path="url(#tw)">`
    : '';
  const twClose  = isTW ? '</g>' : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs>
${styleBlock ? `<style>${styleBlock}</style>` : ''}
${shadowFilter}
${!transparent
  ? `<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
<stop offset="0%" stop-color="${hx(bg1)}"/>
<stop offset="100%" stop-color="${hx(bg2)}"/>
</linearGradient>`
  : ''}
<linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="0%">
<stop offset="0%" stop-color="${hx(t1)}"/>
<stop offset="100%" stop-color="${hx(t2)}"/>
</linearGradient>
${pattern.def}
</defs>
${!transparent ? `<rect width="${width}" height="${height}" fill="url(#bg)"/>` : ''}
${pattern.rect}
${twOpen}
<g id="gm">
<text x="${cx}" y="${mainY}" text-anchor="${anchor}" dominant-baseline="middle"
  font-size="${size}" font-weight="700"
  font-family="'${font}', cursive, sans-serif"
  fill="url(#tg)"${filterAttr}>${esc(text)}</text>
</g>
${sub
  ? `<g id="gs">
<text x="${cx}" y="${subY}" text-anchor="${anchor}" dominant-baseline="middle"
  font-size="${subsize}" font-family="'${font}', cursive, sans-serif"
  fill="${hx(sc)}"${filterAttr}>${esc(sub)}</text>
</g>`
  : ''}
${twClose}
</svg>`;
}

/* ═══════════════════════════════════════════════════════════
   HTTP SERVER
═══════════════════════════════════════════════════════════ */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/banner') {
    try {
      const svg = await makeSVG(url.searchParams);
      res.writeHead(200, {
        'Content-Type':           'image/svg+xml; charset=utf-8',
        'Cache-Control':          'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(svg);
    } catch (e) {
      res.writeHead(500);
      res.end('SVG generation error');
    }

  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);

  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () =>
  console.log(`✦ TextGlow  →  http://localhost:${PORT}`)
);
