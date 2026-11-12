# LineBoard logo

Read this before you place, resize or recolour the LineBoard logo. Use the files in this folder. Never redraw the logo, never retype the wordmark in a font, and never generate a new icon.

![LineBoard logo, light and dark](lineboard-logo.png)

## What it is

An open clapper slate reduced to two shapes:

- **Board:** a rounded rectangle in ink. Black in light theme, white in dark theme.
- **Stick:** a rounded bar in red, lifted 13 degrees from its left end, sitting just above the board.

The stick is the only red in the logo. The wordmark "LineBoard" sits to the right of the mark, set in Inter Display SemiBold with -0.02em tracking. In the SVG files the wordmark is already converted to outlines. There is no full stop after the word.

## Files

| File | Use it for |
|---|---|
| `logo/lineboard-logo-light.svg` | Full logo (mark and word) on light backgrounds: top bar, sign-in, emails, PDFs |
| `logo/lineboard-logo-dark.svg` | Full logo on dark backgrounds |
| `logo/lineboard-mark-light.svg` / `-dark.svg` | Mark alone, where space is tight |
| `logo/lineboard-mark-currentcolor.svg` | Mark that follows the theme: the board uses `currentColor`, the stick uses `var(--lb-red, #c81e1e)` |
| `logo/*.png` | Raster copies (logo 1200px wide, mark 480px) for places that can't take SVG |
| `icons/favicon.svg` | Browser favicon that switches to dark by itself through `prefers-color-scheme` |
| `icons/favicon.ico`, `favicon-16.png`, `favicon-32.png` | Fallback favicons |
| `icons/apple-touch-icon.png` | iOS home screen, 180px |
| `icons/icon-192.png`, `icon-512.png` (+ `-dark`) | PWA manifest icons |
| `icons/icon-maskable-512.png` | PWA maskable icon, with the mark inside the safe zone |
| `icons/app-icon-*.svg` | Source files for the app icons |

## Colours

These match the LineBoard design system tokens.

| Token | Light | Dark |
|---|---|---|
| `ink` (board, wordmark) | `#000000` | `#ffffff` |
| `red` (stick) | `#c81e1e` | `#ff5c5c` |
| App icon background | `#ffffff` | `#000000` |

## Geometry

Drawn on a 64-unit grid. Mark viewBox: `7 1 48 56`.

- Board: `x=10 y=25 width=44 height=31 rx=5`
- Stick: `x=10 y=12 width=44 height=8 rx=3`, `rotate(-13 10 20)`
- App icon: the mark at 78% of the tile, centred. Maskable icon: 60%.

## Rules

- Minimum size: the mark at 16px tall, the full logo at 20px tall. Below 120px wide, use the mark alone.
- Clear space: leave at least the stick's height (one seventh of the mark's height) empty on every side.
- In the app top bar (owner decision, Nov 2026, to match the Slate design): the supplied mark at 38px tall, then the word LINEBOARD set as text in Barlow Condensed SemiBold capitals, 32px, letter-spacing .06em. The bar is black in light mode (white mark and word) and white in dark mode (black mark and word). Everywhere else the full supplied logo is used as before.
- (Older rule, no longer used in the top bar:) use the full logo at 20px tall, top left. Use the mark alone on phone widths under 360px.
- Don't change the 13 degree angle, add clapper stripes, outline the mark, add shadows or gradients, put the logo in a box, or use any red other than the `red` token.
- Always give the logo an accessible name: `role="img" aria-label="LineBoard"` on inline SVG, `alt="LineBoard"` on `<img>`. Once the logo has its accessible name, mark any repeated mark as `aria-hidden="true"`.

## Code

### Head tags

```html
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#f3f3f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
```

### Web app manifest

```json
"icons": [
  { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

### Inline mark that follows the theme

Paste this when the mark must switch with light and dark mode. It works in plain HTML and in any framework's template.

```html
<svg class="lb-mark" viewBox="7 1 48 56" role="img" aria-label="LineBoard">
  <rect x="10" y="25" width="44" height="31" rx="5" fill="currentColor"/>
  <rect x="10" y="12" width="44" height="8" rx="3" fill="var(--lb-red, #c81e1e)" transform="rotate(-13 10 20)"/>
</svg>
```

```css
:root { --lb-red: #c81e1e; }
@media (prefers-color-scheme: dark) { :root { --lb-red: #ff5c5c; } }
.lb-mark { height: 20px; width: auto; color: var(--ink, #000); }
```

### Full logo in the top bar

Swap the light and dark files with `<picture>` rather than recolouring the SVG.

```html
<picture>
  <source srcset="/logo/lineboard-logo-dark.svg" media="(prefers-color-scheme: dark)">
  <img src="/logo/lineboard-logo-light.svg" alt="LineBoard" height="20">
</picture>
```
