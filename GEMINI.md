# SINES Audio Visualizer & Front-End Invariants

## 1. Motion Continuity and Easing (Zero Binary Toggles)
- Fluid Ease-In, Ease-Out: Visual, lighting, and camera properties must never snap abruptly (for example, binary toggles based on playback state, single-frame click impulses, or linear increment bounds).
- Hermite S-Curves: Use Hermite cubic easing (t * t * (3.0 - 2.0 * t) or smoothstep(0.0, 1.0, t)) for optical dimming, mode crossfades, and radius expansions.
- Asymmetric Envelope Followers: Drive audio and reactive effects with fast attack for responsiveness and slow exponential decay for silky release.
- Delta-Time Compensation: Scale all interpolation rates by dt * 60.0 so animations remain identical across 60Hz, 120Hz, and 144Hz displays.

## 2. Mobile Touch Event Delegation
- Preserve Button and Input Taps: When capturing global touchstart or touchmove listeners for canvas panning or camera tracking, never call e.preventDefault() globally.
- Target Guard: Always bypass interactive targets:
  if (e.target.closest('button, input, select, textarea, a, [role="button"], .interactive')) {
    return;
  }
  Calling e.preventDefault() on interactive targets cancels browser-synthesized click events, breaking file uploads and buttons on mobile.

## 3. WebGL Asset Pipeline and Zero-Blackout Loading
- Never Show Blank Canvas: In applications loading multi-megabyte textures or computing multi-pass canvas blurs, never render an empty canvas during network fetch.
- Preloader Invariant: Provide a dedicated glass preloader with smooth progress and status indicators.
- Guaranteed Completion: Ensure the preloader transition out is gated by renderer.isLoaded === true so textures are fully uploaded to GPU before revealing the stage.

## 4. Audio Gain and Parameter Smoothing
- AudioParam Ramping: Never use setValueAtTime() during playback on active audio nodes, as it causes audible clicks.
- Exponential Lag: Always use setTargetAtTime(target, audioCtx.currentTime, timeConstant) (for example, 0.02s) for volume and gain changes to ensure click-free acoustic transitions.

## 5. GitHub Pages Deployment Invariants
- Branch Synchronization: GitHub's github-pages environment protection rules frequently reject deployments from master by default, requiring main.
- Dual-Branch Push: When pushing repository updates intended for GitHub Pages, synchronize both master and main (git push origin master:main), and support both branches in workflow configurations.
