// Renders the Clew icon set into assets/: a card-catalog drawer front
// in oxblood leather with a brass label holder and cup pull, on banker's-lamp
// green. Needs Playwright's Chromium: `node scripts/make-icons.js [outDir]`.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const font = fs.readFileSync(`${ROOT}/node_modules/@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf`).toString('base64');
const OUT = process.argv[2] || `${ROOT}/assets`;

const defs = `
  <radialGradient id="glow" cx="50%" cy="36%" r="75%">
    <stop offset="0" stop-color="#4A7359"/><stop offset="0.55" stop-color="#2E4B3B"/><stop offset="1" stop-color="#18291F"/>
  </radialGradient>
  <linearGradient id="leather" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8A3329"/><stop offset="1" stop-color="#4F1915"/>
  </linearGradient>
  <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F0DBA8"/><stop offset="0.45" stop-color="#C59C5A"/><stop offset="1" stop-color="#7C5D2C"/>
  </linearGradient>
  <linearGradient id="brassH" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#7C5D2C"/><stop offset="0.3" stop-color="#E2C58E"/><stop offset="0.7" stop-color="#C59C5A"/><stop offset="1" stop-color="#7C5D2C"/>
  </linearGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.10 0"/>
    <feComposite in2="SourceGraphic" operator="in"/>
  </filter>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0B130E" flood-opacity="0.55"/>
  </filter>
  <filter id="soft" x="-10%" y="-10%" width="120%" height="130%">
    <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#2A0E0B" flood-opacity="0.6"/>
  </filter>`;

// The drawer front, drawn around (512, 512) at 640 x 480.
const drawer = `
  <g filter="url(#shadow)">
    <rect x="192" y="272" width="640" height="480" rx="30" fill="url(#leather)"/>
    <rect x="192" y="272" width="640" height="480" rx="30" fill="#000" filter="url(#grain)"/>
  </g>
  <rect x="214" y="294" width="596" height="436" rx="18" fill="none" stroke="#2A0E0B" stroke-opacity="0.35" stroke-width="6"/>
  <rect x="198" y="276" width="628" height="472" rx="27" fill="none" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="3"/>
  <rect x="232" y="312" width="560" height="400" rx="12" fill="none" stroke="#E2C58E" stroke-opacity="0.55" stroke-width="5" stroke-dasharray="20 13"/>
  <g filter="url(#soft)">
    <rect x="342" y="356" width="340" height="168" rx="12" fill="url(#brass)"/>
    <rect x="368" y="380" width="288" height="120" rx="4" fill="#FBF6EA"/>
    <line x1="368" y1="404" x2="656" y2="404" stroke="#B04A40" stroke-width="3"/>
    <line x1="368" y1="470" x2="656" y2="470" stroke="#5680AA" stroke-opacity="0.3" stroke-width="2"/>
    <text x="512" y="483" text-anchor="middle" font-family="Fraunces" font-weight="700" font-size="92" fill="#2A1F17">W</text>
    <circle cx="355" cy="440" r="7" fill="#7C5D2C"/><circle cx="669" cy="440" r="7" fill="#7C5D2C"/>
  </g>
  <g filter="url(#soft)">
    <rect x="384" y="580" width="40" height="34" rx="6" fill="url(#brass)"/>
    <rect x="600" y="580" width="40" height="34" rx="6" fill="url(#brass)"/>
    <path d="M404 588 H620 A108 84 0 0 1 404 588 Z" fill="url(#brassH)"/>
    <path d="M430 590 H594 A82 56 0 0 1 430 590 Z" fill="#4A3418" fill-opacity="0.55"/>
  </g>`;

// One-colour silhouette with the label window and pull hollow cut out.
const silhouette = (color) => `
  <mask id="cut"><rect width="1024" height="1024" fill="#fff"/>
    <rect x="232" y="312" width="560" height="400" rx="12" fill="none" stroke="#000" stroke-width="12" stroke-dasharray="20 13"/>
    <rect x="342" y="356" width="340" height="168" rx="12" fill="#000"/>
    <path d="M404 588 H620 A108 84 0 0 1 404 588 Z" fill="#000"/>
  </mask>
  <g mask="url(#cut)"><rect x="192" y="272" width="640" height="480" rx="30" fill="${color}"/></g>
  <rect x="372" y="384" width="280" height="112" rx="4" fill="${color}"/>
  <path d="M436 594 H588 A76 50 0 0 1 436 594 Z" fill="${color}"/>`;

const svg = (body, { bg = null, scale = 1 } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${defs}</defs>
  ${bg ?? ''}
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${body}</g>
</svg>`;

const BG = `<rect width="1024" height="1024" fill="url(#glow)"/><rect width="1024" height="1024" fill="#000" filter="url(#grain)"/>`;

const jobs = [
  ['icon.png', 1024, svg(drawer, { bg: BG, scale: 1.22 }), false],
  ['android-icon-background.png', 1024, svg('', { bg: BG }), false],
  ['android-icon-foreground.png', 1024, svg(drawer, { scale: 0.76 }), true],
  ['android-icon-monochrome.png', 1024, svg(silhouette('#FFFFFF'), { scale: 0.76 }), true],
  ['splash-icon.png', 1024, svg(drawer, { scale: 1.3 }), true],
  ['notification-icon.png', 96, svg(silhouette('#FFFFFF'), { scale: 1.45 }), true],
  ['favicon.png', 48, svg(drawer, { bg: BG, scale: 1.45 }), false],
];

(async () => {
  const b = await chromium.launch();
  for (const [name, size, markup, transparent] of jobs) {
    const page = await b.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><head><style>
      @font-face { font-family: Fraunces; font-weight: 700; src: url(data:font/ttf;base64,${font}); }
      html, body { margin: 0; background: transparent; }
      svg { width: ${size}px; height: ${size}px; display: block; }
    </style></head><body>${markup}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${OUT}/${name}`, omitBackground: transparent });
    await page.close();
  }
  await b.close();
})();
