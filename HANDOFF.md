# Project Handoff: SINES Architectural Music Visualizer

## 1. Project Overview & Architecture
This project is an audio-reactive WebGL web application that visualizes music on the facade of the SINES Department building ("School of Interdisciplinary Engineering & Sciences").

The visualizer uses high-resolution photographic textures:
- `scenes.png`: Base architectural photograph with lights **OFF**.
- `blinds.png`: Complementary photograph with warm interior window lights **ON**.
- `difference.png`: Isolated illumination difference mask.
- `song.mp3`: Local reference audio track bundled with the project.

The application uses a lightweight, GPU-accelerated shader-based pipeline with continuous Gaussian bloom bleed, Hermite easing, and mobile-friendly touch panning.

---

## 2. Core Features & Recent Enhancements

### 1. Minimal Barebones Preloader & Continuous Dynamic Progress
- **Clean Minimal Design**: Centered minimal layout with clean letterspaced `SINES`, a hairline progress track (`2px` height with blue `#0071e3` incandescent fill), and monospace percentage readout.
- **Continuous Progress Increment (Eliminated 80% Stall)**: Increments at a steady 5% each second until 80% (15 seconds), and if assets are still compiling over the network, continues advancing steadily (81%, 82%, 83%...) so the user never sees a frozen screen.
- **Seamless 100% Surge**: As soon as WebGL textures and multi-pass bloom canvases finish compiling (`renderer.isLoaded`), progress accelerates smoothly to 100% before triggering a 600ms fade-out transition.

### 2. Standardized Dual Action Buttons
- **Equal Dimensions**: Both the primary `#0071e3` "Play song" button and secondary frosted glass "Upload a song" button share the `.action-btn` class with identical dimensions (`width: 100%`, `height: 44px`, `border-radius: 999px`).
- **Harmonious Vector Icons**: Both buttons feature matching `18x18` SVG icons (solid play triangle and outline upload tray) with standardized typography (`14px`, `font-weight: 600`).
- **Preloaded Bundled Audio**: `song.mp3` is fetched and decoded in memory on startup (`audioEngine.preloadDefaultTrack`). Clicking "Play song" starts playback instantly with zero latency.
- **High-Contrast Readability**: Secondary button uses crisp translucent glass with white text, and the upload hint text is tuned to `rgba(255, 255, 255, 0.65)` for clear visibility against dark masonry.

### 3. Default Looping Mode & End-of-Song Behavior
- **Default Looping**: AudioEngine initializes with `isLooping: true` by default.
- **Single Track**: Seamlessly loops from the beginning without clicks, re-decoding, or audio glitches.
- **Multi-Track Playlist**: Automatically advances to the next track upon completion, wrapping around to the first track when reaching the end.

### 4. Mobile File Picker Safeguards & In-App Browser Handling
- **Specific MIME & Extension Prioritization**: Configured file input with `.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,audio/mpeg,audio/wav,audio/*` to prevent Android intent resolvers from hijacking requests with external sound recorders or media players.
- **Mobile Single-Select**: Dynamically removes `multiple` on mobile touch devices. This ensures Android OEM file managers treat a single tap as an immediate file selection rather than entering multi-select preview/playback mode.
- **In-App Browser Detection**: Detects WhatsApp, Instagram, Telegram, Messenger, and other in-app WebViews. Surfaces a helpful tip: *"Tip: For direct audio uploads, tap ⋮ and open in Chrome / Browser"*.
- **Safeguards & Floating Toast**: 100MB file size limit guard with clear feedback, safe input reset (`fileInput.value = ''`), and user-friendly toasts when audio decoding fails.
- **Event Guarding**: Window `touchstart` and `touchmove` listeners bypass interactive elements:
  `if (e.target.closest('button, input, select, textarea, a, [role="button"], .interactive, #upload-ui')) return;`

### 5. 2D Cinematic Camera Dynamism & Parallax Drift (`shader-renderer.js`)
- **Eliminated Rigid Stillness**: When nothing is happening (idle pointer, untouched mobile screen, or resting audio), the camera slowly and organically sways across the building on **both the X and Y axes** using a multi-octave harmonic Lissajous drift.
- **9% Overscan Buffer**: In `resize()`, applies a 9% overscan scale so that screens of any aspect ratio (widescreen desktop, mobile portrait, square) maintain comfortable parallax headroom on both axes without exposing canvas margins.
- **Interactive Blending**: Smoothly blends user drag input, cursor parallax, and audio-reactive focus with the organic drift via delta-time compensated Hermite easing.

### 6. WebGL Feathered Shader Engine (`shader-renderer.js`)
- **Zero Boxy Edges**: Continuous smoothstep blending between sharp window borders and multi-scale Gaussian blurred masks (`texDiffBlur` at 16px and `texDiffWideBlur` at 36px).
- **Incandescent Bloom Bleed**: Photon bleed additively spills over dark masonry and window sills.
- **Hermite S-Curve Easing**: All transitions (audio followers, mode crossfades, color palette crossfades, idle torch lamp) use cubic easing without binary snaps.

### 7. Audio DSP Engine (`audio-engine.js`)
- **FFT Analysis**: Hann-windowed 2048-bin spectral analysis spanning 7 frequency bands.
- **Rolling Normalization**: 5th–95th percentile dynamic range tracking over a 6-second window.
- **State Machine & Error Reporting**: Token-based async decoding with `onError` event notification hooks.

---

## 3. Repository File Map

```text
musicVisulizer/
├── .gitignore          # Excludes large binaries, temp files, and non-essential docs
├── GEMINI.md           # Visualizer and front-end architectural invariants
├── HANDOFF.md          # Project handoff and architectural documentation
├── README.md           # Concise project overview
├── index.html          # Main HTML5 entry point and glassmorphic UI layout
├── style.css           # Glassmorphic dark theme stylesheet and action buttons
├── app.js              # Application coordinator connecting AudioEngine, ShaderRenderer, and DOM
├── audio-engine.js     # Web Audio DSP engine, playlist state machine, and decoders
├── shader-renderer.js  # WebGL fragment shader, bloom bleed, camera pan, and modes
├── run_server.py       # Python local HTTP server with automatic port hunting & browser launch
├── run_visualizer.bat  # Windows 1-click execution batch script
├── scenes.png          # Base photographic texture (lights off)
├── blinds.png          # Highlight photographic texture (lights on)
├── difference.png      # Illumination difference mask texture
└── song.mp3            # Reference audio track
```

---

## 4. Verification & Testing
- **JS Syntax Verification**: Passed `node --check app.js audio-engine.js shader-renderer.js` with zero errors.
- **HTTP Serving**: Verified HTTP 200 responses for all HTML, JS, CSS, and audio files via local server.
- **Mobile Touch Verification**: Verified touch delegation guards against `e.preventDefault()` on interactive UI.
- **Cross-Branch Deployment**: Verified synchronized pushes to `main`, `master`, and `gh-pages`.

---

## 5. How to Run
```bash
python run_server.py
```
Or run `run_visualizer.bat`. The application launches at `http://localhost:8080/index.html`.

---

## 6. Git Remote & Deployment Status
- **Repository URL**: `https://github.com/NonStickFryingPan/musicVisulizer.git`
- **Synchronized Branches**: `master`, `main`, and `gh-pages` are fully synchronized.
- **GitHub Pages**: Deployed from branch `main` / `gh-pages`.
