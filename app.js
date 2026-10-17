import { AudioEngine } from './audio-engine.js';
import { ShaderRenderer } from './shader-renderer.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas-main');
  const audioEngine = new AudioEngine();
  const renderer = new ShaderRenderer(canvas);

  window.audioEngine = audioEngine;
  window.renderer = renderer;

  // Eager background preload during preloader for zero-latency instant playback
  const audioPreloadPromise = audioEngine.preloadDefaultTracks([
    { url: 'song.mp3', name: 'SINES Theme 1' },
    { url: 'song2.mp3', name: 'SINES Theme 2' }
  ]);

  const btnPlayDefault = document.getElementById('btn-play-default');
  const btnUpload = document.getElementById('btn-upload');
  const fileInput = document.getElementById('file-input');
  const uploadUI = document.getElementById('upload-ui');
  const toast = document.getElementById('toast');

  // Floating Pill Mobile Bottom Dock elements
  const mobileDock = document.getElementById('mobile-dock');
  const dockBtnPlay = document.getElementById('dock-btn-play');
  const dockBtnBack = document.getElementById('dock-btn-back');
  const dockBtnNext = document.getElementById('dock-btn-next');
  const dockBtnUpload = document.getElementById('dock-btn-upload');
  const dockScrubber = document.getElementById('dock-scrubber');
  const dockTrackFill = document.getElementById('dock-track-fill');
  const dockTimeElapsed = document.getElementById('dock-time-elapsed');
  const dockTimeTotal = document.getElementById('dock-time-total');

  function formatTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  let toastTimer = null;
  function showToast(msg, duration = 4200) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }

  const ua = navigator.userAgent || '';
  const isInAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line|Twitter|Snapchat|MicroMessenger|musical_ly/i.test(ua);

  // Preloader (Desktop: Photonic Impacts, Mobile: Minimal Bar)
  const preloader = document.getElementById('preloader');
  const preloaderCanvas = document.getElementById('preloader-canvas');
  const desktopPercent = document.getElementById('desktop-percent');
  const loaderBar = document.getElementById('loader-bar');
  const loaderPercent = document.getElementById('loader-percent');
  const mainStage = document.getElementById('main-stage');

  function isMobileDevice() {
    return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  }

  const pCtx = preloaderCanvas ? preloaderCanvas.getContext('2d') : null;

  function resizePreloaderCanvas() {
    if (preloaderCanvas && !isMobileDevice()) {
      preloaderCanvas.width = window.innerWidth;
      preloaderCanvas.height = window.innerHeight;
    }
  }
  resizePreloaderCanvas();
  window.addEventListener('resize', resizePreloaderCanvas);

  const TOTAL_BULLETS = 75;
  let bulletPool = [];

  function generateBulletPool() {
    bulletPool = [];
    let seed = 88;
    function random() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }
    for (let i = 0; i < TOTAL_BULLETS; i++) {
      const threshold = (i / TOTAL_BULLETS) * 78;
      const nx = 0.04 + random() * 0.92;
      const ny = 0.04 + random() * 0.92;
      const minRadius = 50 + random() * 80;
      const maxRadius = minRadius * (2.4 + random() * 2.0);
      bulletPool.push({
        threshold,
        nx,
        ny,
        minRadius,
        maxRadius,
        struck: false,
        strikeTime: 0
      });
    }
  }
  generateBulletPool();

  let currentPct = 0.0;
  let preloaderFinished = false;
  let isRevealing = false;
  const loadStartTime = performance.now();
  let lastLoaderTime = performance.now();

  function renderImpactFrame(pct, now) {
    if (!pCtx || !preloaderCanvas) return;
    const w = preloaderCanvas.width;
    const h = preloaderCanvas.height;

    // Pristine white backdrop
    pCtx.fillStyle = '#ffffff';
    pCtx.fillRect(0, 0, w, h);

    // Subtle ambient darkening wash that softly builds with progress
    const norm = pct / 100;
    if (norm > 0.02) {
      pCtx.fillStyle = `rgba(0, 0, 0, ${norm * 0.20})`;
      pCtx.fillRect(0, 0, w, h);
    }

    // Black photon impacts
    for (let i = 0; i < bulletPool.length; i++) {
      const b = bulletPool[i];
      if (pct >= b.threshold) {
        if (!b.struck) {
          b.struck = true;
          b.strikeTime = now;
        }

        const timeSinceStrike = (now - b.strikeTime) / 1000;
        const strikeFlash = Math.max(0, 1.0 - timeSinceStrike * 3.2);

        const growthT = Math.min(1.0, (pct - b.threshold) / 22);
        const sGrowth = growthT * growthT * (3.0 - 2.0 * growthT);
        const currentRadius = b.minRadius + (b.maxRadius - b.minRadius) * sGrowth;
        const px = b.nx * w;
        const py = b.ny * h;

        // Gaussian optical decay for expanding black aperture
        const grad = pCtx.createRadialGradient(px, py, 0, px, py, currentRadius);
        const flashBoost = strikeFlash * 0.35;

        grad.addColorStop(0.00, `rgba(0, 0, 0, ${Math.min(1.0, 0.95 + flashBoost)})`);
        grad.addColorStop(0.20, `rgba(0, 0, 0, ${Math.min(1.0, 0.68 + flashBoost * 0.5)})`);
        grad.addColorStop(0.45, 'rgba(0, 0, 0, 0.32)');
        grad.addColorStop(0.70, 'rgba(0, 0, 0, 0.11)');
        grad.addColorStop(0.88, 'rgba(0, 0, 0, 0.02)');
        grad.addColorStop(1.00, 'rgba(0, 0, 0, 0.00)');

        pCtx.fillStyle = grad;
        pCtx.beginPath();
        pCtx.arc(px, py, currentRadius, 0, Math.PI * 2);
        pCtx.fill();

        // Diffuse optical flash bloom on strike (black core absorption)
        if (strikeFlash > 0.01) {
          const flashRadius = currentRadius * 0.45;
          const flashGrad = pCtx.createRadialGradient(px, py, 0, px, py, flashRadius);
          const flashAlpha = strikeFlash * 0.50;
          flashGrad.addColorStop(0.00, `rgba(0, 0, 0, ${flashAlpha})`);
          flashGrad.addColorStop(0.25, `rgba(0, 0, 0, ${flashAlpha * 0.55})`);
          flashGrad.addColorStop(0.60, `rgba(0, 0, 0, ${flashAlpha * 0.18})`);
          flashGrad.addColorStop(1.00, 'rgba(0, 0, 0, 0.00)');
          pCtx.fillStyle = flashGrad;
          pCtx.beginPath();
          pCtx.arc(px, py, flashRadius, 0, Math.PI * 2);
          pCtx.fill();
        }
      }
    }

    // Screen normalization pass: As progress approaches 100%, apertures smoothly merge
    // into exactly ONE uniform, flat, solid black tone across the entire screen
    if (pct > 60) {
      const normProgress = (pct - 60) / 40; // 0.0 at 60% to 1.0 at 100%
      const normAlpha = normProgress * normProgress * (3.0 - 2.0 * normProgress);
      pCtx.fillStyle = `rgba(0, 0, 0, ${normAlpha})`;
      pCtx.fillRect(0, 0, w, h);
    }
  }

  function updateLoader(now) {
    if (preloaderFinished) return;

    const dt = Math.min(0.1, (now - lastLoaderTime) / 1000);
    lastLoaderTime = now;
    const isMobile = isMobileDevice();

    if (renderer.isLoaded) {
      // Unhurried completion: smooth glide to 100%
      const dtRate = isMobile ? 0.20 : Math.min(1.0, 3.2 * dt);
      currentPct += (100.0 - currentPct) * dtRate;
      if (currentPct >= 99.4 && !isRevealing) {
        currentPct = 100;
        isRevealing = true;
        preloaderFinished = true;

        if (isMobile) {
          // Mobile: Original minimal loader bar & percent
          if (loaderPercent) loaderPercent.textContent = '100%';
          if (loaderBar) loaderBar.style.width = '100%';

          setTimeout(() => {
            if (preloader) {
              preloader.classList.add('fade-out');
              setTimeout(() => {
                try { preloader.remove(); } catch (_) {}
              }, 600);
            }
            if (mobileDock) {
              mobileDock.classList.remove('hidden');
            }
          }, 180);
        } else {
          // Desktop: Photonic Impacts solid black normalization + mask sweep reveal
          if (desktopPercent) desktopPercent.innerHTML = `100<span class="veil-pct-symbol">%</span>`;
          renderImpactFrame(100, now);

          setTimeout(() => {
            if (mainStage) {
              mainStage.classList.add('revealing');
            }
            if (preloader) {
              preloader.classList.add('fade-out');
              setTimeout(() => {
                try { preloader.remove(); } catch (_) {}
              }, 900);
            }
            if (uploadUI && !audioEngine.isPlaying) {
              uploadUI.classList.remove('hidden');
            }
          }, 200);
        }
        return;
      }
    } else {
      // 5% per second until 80%, then gradual drift towards 98%
      const elapsedSec = (now - loadStartTime) / 1000;
      let targetPct;
      if (elapsedSec <= 16.0) {
        targetPct = elapsedSec * 5.0;
      } else {
        const extraSec = elapsedSec - 16.0;
        targetPct = Math.min(98.0, 80.0 + extraSec * 0.75);
      }
      currentPct += (targetPct - currentPct) * Math.min(1.0, 6.0 * dt);
    }

    const display = Math.min(100, Math.floor(currentPct));

    if (isMobile) {
      // Mobile: Update original loader-bar & loader-percent
      if (loaderPercent) loaderPercent.textContent = `${display}%`;
      if (loaderBar) loaderBar.style.width = `${currentPct}%`;
    } else {
      // Desktop: Update large difference numeral & Photonic Impacts 2D canvas frame
      if (desktopPercent) desktopPercent.innerHTML = `${display}<span class="veil-pct-symbol">%</span>`;
      renderImpactFrame(currentPct, now);
    }

    requestAnimationFrame(updateLoader);
  }

  requestAnimationFrame(updateLoader);

  window.addEventListener('resize', () => renderer.resize());
  renderer.resize();

  let isDraggingScrubber = false;
  function updateScrubber() {
    if (isDraggingScrubber) return;
    const cur = audioEngine.getCurrentTime() || 0;
    const dur = audioEngine.getDuration() || 0;
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    if (dockTrackFill) dockTrackFill.style.width = `${pct}%`;
    if (dockTimeElapsed) dockTimeElapsed.textContent = formatTime(cur);
    if (dockTimeTotal) dockTimeTotal.textContent = formatTime(dur);
    if (dockScrubber) dockScrubber.setAttribute('aria-valuenow', Math.round(pct));
  }

  function loop() {
    try {
      const audioState = audioEngine.update();
      renderer.setPlaying(!!audioEngine.isPlaying);
      renderer.render(audioState);
      updateScrubber();

      if (mobileDock && audioEngine.isPlaying && audioState && audioState.bandEnvelopes) {
        const bass = (audioState.bandEnvelopes[0] || 0) * 0.65 + (audioState.bandEnvelopes[1] || 0) * 0.35;
        const glow = Math.min(1.0, bass * 1.35).toFixed(3);
        mobileDock.style.setProperty('--dock-glow', glow);
      } else if (mobileDock) {
        mobileDock.style.setProperty('--dock-glow', '0');
      }
    } catch (err) {
      console.error('Render loop error:', err);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  let scrollY = 0.5;
  renderer.setScroll(scrollY);

  const isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  renderer.setTouchMode(isTouch);

  // Single-select for mobile file pickers
  if (isTouch && fileInput) {
    fileInput.removeAttribute('multiple');
  }

  window.addEventListener('mousemove', (e) => {
    renderer.setMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
  });

  // Touch panning
  let activeTouchId = null;
  window.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    if (e.target.closest('#upload-ui, #mobile-dock, button, input, select, textarea, a, [role="button"], .interactive')) {
      return;
    }
    const t = e.touches[0];
    const nx = t.clientX / window.innerWidth;
    const ny = t.clientY / window.innerHeight;
    renderer.beginDrag(nx, ny);
    renderer.pressClick(nx, ny);
    activeTouchId = t.identifier;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!e.touches || e.touches.length === 0) return;
    if (e.target.closest('#upload-ui, #mobile-dock, button, input, select, textarea, a, [role="button"], .interactive')) {
      return;
    }
    const t = (activeTouchId !== null)
      ? Array.from(e.touches).find((touch) => touch.identifier === activeTouchId) || e.touches[0]
      : e.touches[0];
    const nx = t.clientX / window.innerWidth;
    const ny = t.clientY / window.innerHeight;
    renderer.dragTo(nx, ny);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    renderer.releaseClick();
    renderer.endDrag();
    activeTouchId = null;
  }, { passive: false });

  window.addEventListener('touchcancel', () => {
    renderer.releaseClick();
    renderer.endDrag();
    activeTouchId = null;
  }, { passive: false });
  window.addEventListener('mousedown', () => renderer.pressClick());
  window.addEventListener('mouseup', () => renderer.releaseClick());
  window.addEventListener('mouseleave', () => renderer.releaseClick());

  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    scrollY = Math.max(0, Math.min(1, scrollY + e.deltaY * 0.0012));
    renderer.setScroll(scrollY);
  }, { passive: false });

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  function handleFiles(files) {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    const valid = [];
    for (const f of fileArr) {
      if (f.size > MAX_FILE_SIZE) {
        showToast(`"${f.name}" exceeds the 100MB limit. Please choose a smaller track.`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length > 0) {
      showToast(`Loading ${valid.length > 1 ? `${valid.length} tracks` : valid[0].name}...`, 2500);
      audioEngine.addFilesToPlaylist(valid);
    }
  }

  if (btnPlayDefault) {
    btnPlayDefault.addEventListener('click', async () => {
      try {
        await audioEngine.resumeContext();
        if (!audioEngine.audioBuffer) {
          await audioPreloadPromise;
        }
        if (audioEngine.audioBuffer) {
          audioEngine.play();
        } else {
          await audioEngine.playTrack(0);
        }
        uploadUI.classList.add('hidden');
      } catch (err) {
        console.error('Play default track error:', err);
        showToast('Could not play track. Please upload an audio file.');
      }
    });
  }

  btnUpload.addEventListener('click', () => {
    audioEngine.resumeContext();
    if (isInAppBrowser) {
      showToast('Tip: For direct audio uploads, tap \u22EE and open in Chrome / Browser');
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadUI.classList.remove('hidden');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) {
      updateChrome();
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer && e.dataTransfer.files);
    updateChrome();
  });

  function updatePlayIcons(playing) {
    if (dockBtnPlay) {
      const svg = dockBtnPlay.querySelector('svg');
      if (svg) {
        if (playing) {
          svg.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor" rx="1"></rect><rect x="14" y="4" width="4" height="16" fill="currentColor" rx="1"></rect>';
        } else {
          svg.innerHTML = '<polygon points="7 4 19 12 7 20" fill="currentColor"></polygon>';
        }
      }
    }
    if (btnPlayDefault) {
      const svg = btnPlayDefault.querySelector('.btn-icon');
      const label = btnPlayDefault.querySelector('span');
      if (svg) {
        if (playing) {
          svg.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor" rx="1"></rect><rect x="14" y="4" width="4" height="16" fill="currentColor" rx="1"></rect>';
        } else {
          svg.innerHTML = '<polygon points="6 3 20 12 6 21 6 3"></polygon>';
        }
      }
      if (label) {
        label.textContent = playing ? 'Pause' : 'Play song';
      }
    }
  }

  // Floating Pill mobile dock bindings
  if (dockBtnPlay) {
    dockBtnPlay.addEventListener('click', async () => {
      try {
        await audioEngine.resumeContext();
        if (audioEngine.isPlaying) {
          audioEngine.pause();
          showToast('Paused', 1000);
        } else {
          if (!audioEngine.audioBuffer) {
            await audioPreloadPromise;
          }
          if (audioEngine.audioBuffer) {
            audioEngine.play();
          } else {
            await audioEngine.playTrack(0);
          }
          uploadUI.classList.add('hidden');
          showToast('Playing', 1000);
        }
      } catch (err) {
        console.error('Dock play error:', err);
      }
    });
  }

  let lastBackTap = 0;
  if (dockBtnBack) {
    dockBtnBack.addEventListener('click', async () => {
      try {
        await audioEngine.resumeContext();
        const now = performance.now();
        if (now - lastBackTap < 2000) {
          // Double-tap within 2.0s -> previous song
          lastBackTap = 0;
          if (audioEngine.playlist.length > 0) {
            const prevIdx = (audioEngine.currentIndex - 1 + audioEngine.playlist.length) % audioEngine.playlist.length;
            await audioEngine.playTrack(prevIdx);
            uploadUI.classList.add('hidden');
            showToast(`Track: ${audioEngine.getTrackName()}`, 1200);
          }
        } else {
          // Single tap -> restarts song from start
          lastBackTap = now;
          audioEngine.seek(0);
          if (!audioEngine.isPlaying) {
            audioEngine.play();
            uploadUI.classList.add('hidden');
          }
          showToast('Restarted', 1000);
        }
      } catch (err) {
        console.error('Dock back error:', err);
      }
    });
  }

  if (dockBtnNext) {
    dockBtnNext.addEventListener('click', async () => {
      try {
        await audioEngine.resumeContext();
        if (audioEngine.playlist.length > 0) {
          audioEngine.nextTrack();
          uploadUI.classList.add('hidden');
          showToast(`Track: ${audioEngine.getTrackName()}`, 1200);
        }
      } catch (err) {
        console.error('Dock next error:', err);
      }
    });
  }

  if (dockBtnUpload) {
    dockBtnUpload.addEventListener('click', () => {
      audioEngine.resumeContext();
      if (isInAppBrowser) {
        showToast('Tip: For direct audio uploads, tap ⋮ and open in Chrome / Browser');
      }
      fileInput.click();
    });
  }

  if (dockScrubber) {
    function seekFromEvent(e) {
      const rect = dockScrubber.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (dockTrackFill) dockTrackFill.style.width = `${norm * 100}%`;
      const dur = audioEngine.getDuration();
      if (dur > 0) {
        const targetTime = norm * dur;
        if (dockTimeElapsed) dockTimeElapsed.textContent = formatTime(targetTime);
        audioEngine.seek(targetTime);
      }
    }

    function onPointerDown(e) {
      isDraggingScrubber = true;
      dockScrubber.classList.add('dragging');
      audioEngine.resumeContext();
      seekFromEvent(e);

      function onPointerMove(e) {
        if (!isDraggingScrubber) return;
        seekFromEvent(e);
      }

      function onPointerUp() {
        isDraggingScrubber = false;
        dockScrubber.classList.remove('dragging');
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);
      }

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    }

    dockScrubber.addEventListener('mousedown', onPointerDown);
    dockScrubber.addEventListener('touchstart', onPointerDown, { passive: true });
  }

  audioEngine.onError((msg) => {
    showToast(msg);
  });

  audioEngine.onStateChange((state) => {
    renderer.setPlaying(!!state.isPlaying);
    updatePlayIcons(!!state.isPlaying);
    updateChrome(state);
  });

  if (typeof audioEngine.onPlaylistChange === 'function') {
    audioEngine.onPlaylistChange(() => {
      updateChrome();
    });
  }

  function updateChrome(state) {
    if (!preloaderFinished) return;
    if (audioEngine.isPlaying || audioEngine.isPaused) {
      uploadUI.classList.add('hidden');
    } else {
      uploadUI.classList.remove('hidden');
    }
  }

  // Desktop keyboard controls
  window.addEventListener('keydown', async (e) => {
    if (e.target && e.target.closest && e.target.closest('input, select, textarea, [contenteditable="true"]')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      await audioEngine.resumeContext();
      if (audioEngine.isPlaying) {
        audioEngine.pause();
        showToast('Paused', 1000);
      } else {
        if (!audioEngine.audioBuffer) {
          await audioPreloadPromise;
        }
        if (audioEngine.audioBuffer) {
          audioEngine.play();
        } else {
          await audioEngine.playTrack(0);
        }
        uploadUI.classList.add('hidden');
        showToast('Playing', 1000);
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (audioEngine.playlist.length > 0) {
        await audioEngine.resumeContext();
        audioEngine.nextTrack();
        uploadUI.classList.add('hidden');
        showToast(`Track: ${audioEngine.getTrackName()}`, 1500);
      }
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (audioEngine.playlist.length > 0) {
        await audioEngine.resumeContext();
        audioEngine.prevTrack();
        uploadUI.classList.add('hidden');
        showToast(`Track: ${audioEngine.getTrackName()}`, 1500);
      }
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      const cur = audioEngine.volume !== undefined ? audioEngine.volume : 1.0;
      const newVol = Math.min(1.0, Math.round((cur + 0.05) * 100) / 100);
      audioEngine.setVolume(newVol);
      showToast(`Volume: ${Math.round(newVol * 100)}%`, 1000);
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      const cur = audioEngine.volume !== undefined ? audioEngine.volume : 1.0;
      const newVol = Math.max(0.0, Math.round((cur - 0.05) * 100) / 100);
      audioEngine.setVolume(newVol);
      showToast(`Volume: ${Math.round(newVol * 100)}%`, 1000);
    } else if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    }
  });
});