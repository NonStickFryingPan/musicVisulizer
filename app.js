import { AudioEngine } from './audio-engine.js';
import { ShaderRenderer } from './shader-renderer.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas-main');
  const audioEngine = new AudioEngine();
  const renderer = new ShaderRenderer(canvas);

  const btnPlayDefault = document.getElementById('btn-play-default');
  const btnUpload = document.getElementById('btn-upload');
  const fileInput = document.getElementById('file-input');
  const uploadUI = document.getElementById('upload-ui');
  const toast = document.getElementById('toast');

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

  // Preloader
  const preloader = document.getElementById('preloader');
  const loaderBar = document.getElementById('loader-bar');
  const loaderPercent = document.getElementById('loader-percent');

  let currentPct = 5.0;
  let preloaderFinished = false;
  const loadStartTime = performance.now();

  function updateLoader() {
    if (preloaderFinished) return;

    const elapsedSec = (performance.now() - loadStartTime) / 1000;
    
    let targetPct;
    if (elapsedSec <= 15.0) {
      targetPct = 5.0 + elapsedSec * 5.0;
    } else {
      const extraSec = elapsedSec - 15.0;
      targetPct = Math.min(98.0, 80.0 + extraSec * 0.75);
    }

    if (renderer.isLoaded) {
      currentPct += (100.0 - currentPct) * 0.16;
      if (currentPct >= 99.4) {
        currentPct = 100;
        preloaderFinished = true;
        if (loaderBar) loaderBar.style.width = '100%';
        if (loaderPercent) loaderPercent.textContent = '100%';

        setTimeout(() => {
          if (preloader) {
            preloader.classList.add('fade-out');
            setTimeout(() => {
              try { preloader.remove(); } catch (_) {}
            }, 600);
          }
          if (uploadUI && !audioEngine.isPlaying) {
            uploadUI.classList.remove('hidden');
          }
        }, 180);
        return;
      }
    } else {
      currentPct = Math.max(currentPct, targetPct);
    }

    const display = Math.min(100, Math.floor(currentPct));
    if (loaderBar) loaderBar.style.width = `${display}%`;
    if (loaderPercent) loaderPercent.textContent = `${display}%`;

    requestAnimationFrame(updateLoader);
  }

  requestAnimationFrame(updateLoader);

  window.addEventListener('resize', () => renderer.resize());
  renderer.resize();

  function loop() {
    try {
      const audioState = audioEngine.update();
      renderer.setPlaying(!!audioEngine.isPlaying);
      renderer.render(audioState);
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
    if (e.target.closest('#upload-ui') || e.target.closest('button') || e.target.closest('input')) {
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
    if (e.target.closest('button, input, select, textarea, a, [role="button"], .interactive, #upload-ui')) {
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
      audioEngine.addFilesToPlaylist(valid);
    }
  }

  if (btnPlayDefault) {
    btnPlayDefault.addEventListener('click', async () => {
      try {
        await audioEngine.initContext();
        if (!audioEngine.playlist || audioEngine.playlist.length === 0) {
          await audioEngine.preloadDefaultTrack('song.mp3', 'SINES Theme');
        }
        audioEngine.play();
        uploadUI.classList.add('hidden');
      } catch (err) {
        console.error('Play default track error:', err);
      }
    });
  }

  btnUpload.addEventListener('click', () => {
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

  audioEngine.onError((msg) => {
    showToast(msg);
  });

  audioEngine.onStateChange((state) => {
    renderer.setPlaying(!!state.isPlaying);
    updateChrome(state);
  });

  if (typeof audioEngine.onPlaylistChange === 'function') {
    audioEngine.onPlaylistChange(() => {
      updateChrome();
    });
  }

  function updateChrome(state) {
    if (!preloaderFinished) return;
    if (audioEngine.isPlaying) {
      uploadUI.classList.add('hidden');
    } else {
      uploadUI.classList.remove('hidden');
      const label = btnPlayDefault ? btnPlayDefault.querySelector('span') : null;
      if (label) {
        label.textContent = audioEngine.isPaused ? 'Resume' : 'Play song';
      }
    }
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (audioEngine.isPlaying) audioEngine.pause();
      else audioEngine.play();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) audioEngine.nextTrack();
      else audioEngine.seek(audioEngine.getCurrentTime() + 5);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) audioEngine.prevTrack();
      else audioEngine.seek(Math.max(0, audioEngine.getCurrentTime() - 5));
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      const v = Math.min(1, (audioEngine.volume ?? 1) + 0.05);
      audioEngine.setVolume(v);
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      const v = Math.max(0, (audioEngine.volume ?? 1) - 0.05);
      audioEngine.setVolume(v);
    } else if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    }
  });
});