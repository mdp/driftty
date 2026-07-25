# ttyd Web Client with Overlay Keyboard

[![MIT license](http://img.shields.io/badge/license-MIT-brightgreen.svg)](http://opensource.org/licenses/MIT)
![Built with vibe coding](https://img.shields.io/badge/built%20with-vibe%20coding-ff69b4)


Customized ttyd web client with on-screen keyboard overlay support.

Forked from [tsl0922/ttyd](https://github.com/tsl0922/ttyd)

## Demo
![ttyd Overlay Keyboard Demo](https://raw.githubusercontent.com/ar90n/ttyd-overlay-keys-html/assets/demo.gif)

### Usage Example
```bash
# Download the latest index.html from releases, then:
ttyd --index index.html claude
```
Access your terminal at http://localhost:7681 with mobile-optimized overlay keyboard!

## Features
- Single HTML file output for embedding in ttyd binary
- Compact, safe-area-aware overlay keyboard for mobile devices
- Agent, navigation, Ctrl, and tmux control sections
- One-shot Ctrl and Shift modifiers for the native mobile keyboard
- Dedicated tmux scroll mode with PgUp, PgDn, arrows, and Exit
- VisualViewport-aware terminal resizing when the iOS keyboard opens
- Persistent font-size controls
- Built with Preact, TypeScript, Vite, and `vite-plugin-singlefile`
- Unit-tested with Vitest

## Build
```bash
npm ci
npm test
npm run build
```

## Download
Get the latest release from [GitHub Releases](https://github.com/ar90n/ttyd-overlay-keys-html/releases)
