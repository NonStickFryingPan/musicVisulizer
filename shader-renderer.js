export class ShaderRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: true });
    if (!this.gl) {
      throw new Error('WebGL not supported in this browser.');
    }

    this.isLoaded = false;

    // Target parameters
    this.targetFeather = 0.80;
    this.targetBloom = 1.00;
    this.targetAudioSensitivity = 0.70;
    this.smoothFeather = 0.80;
    this.smoothBloom = 1.00;
    this.smoothSensitivity = 0.70;

    // Visual mode transition state
    this.currentVisualMode = 0;
    this.prevVisualMode = 0;
    this.modeBlend = 1.0;

    // Color theme transition state
    this.currentColorMode = 0;
    this.prevColorMode = 0;
    this.colorBlend = 1.0;

    // Smoothed visual envelope followers
    this.smoothAudioLevel = 0.05;
    this.smoothBassLevel = 0.05;
    this.smoothMidLevel = 0.05;
    this.smoothTrebleLevel = 0.05;
    this.smoothStereoPan = 0.0;
    this.smoothCentroid = 0.3;
    this.smoothOnset = 0.0;
    this.smoothClimaxFlash = 0.0;

    this.imgWidth = 1085;
    this.imgHeight = 1450;
    this.viewScale = 1.0;
    this.viewOffsetX = 0;
    this.viewOffsetY = 0;

    // Camera and viewport state
    this.visibleX = 1.0;
    this.visibleY = 1.0;
    this.maxPanX = 0.0;
    this.maxPanY = 0.0;
    this.panX = 0.0;
    this.panY = 0.0;
    this.targetPanX = 0.0;
    this.targetPanY = 0.0;
    this.mouseX = 0.5;
    this.mouseY = 0.5;
    const startX = 0.12 + Math.random() * 0.23;
    const startY = 0.12 + Math.random() * 0.23;
    this.mouseX = startX;
    this.mouseY = startY;
    this.targetMouseX = startX;
    this.targetMouseY = startY;
    this.lastActiveX = startX;
    this.lastActiveY = startY;
    this.lastPointerMove = (typeof performance !== 'undefined') ? (performance.now() / 1000) : 0;
    this.idleBlend = 0.0;
    this.clickPulse = 0.0;
    this.holdingClick = false;
    this.scrollY = 0.5;
    this.isPlaying = false;
    this.mouseUVX = 0.5;
    this.mouseUVY = 0.5;

    this.smoothCursorStrength = 0.95;
    this.cameraPlayBlend = 0.0;
    this.lastFrameTime = (typeof performance !== 'undefined') ? performance.now() : 0;

    // Touch panning state
    this.touchMode = false;
    this.isDragging = false;
    this.dragStartX = 0.5;
    this.dragStartY = 0.5;
    this.dragStartPanX = 0;
    this.dragStartPanY = 0;
    this.basePanX = 0;
    this.basePanY = 0;
    this.lastDragX = 0.5;
    this.lastDragY = 0.5;
    this.dragVelX = 0;
    this.dragVelY = 0;

    this.texScene = null;
    this.texBlinds = null;
    this.texDiffSharp = null;
    this.texDiffBlur = null;
    this.texDiffWideBlur = null;

    this.program = null;
    this.uniforms = {};
    this.time = 0.0;
    this.progressCallbacks = [];

    this._initWebGL();
    this.readyPromise = this._loadAssets();
  }

  onProgress(cb) {
    this.progressCallbacks.push(cb);
  }

  _reportProgress(pct, status) {
    for (const cb of this.progressCallbacks) {
      try { cb(pct, status); } catch (e) {}
    }
  }

  // Getters & setters
  set feather(v) { this.targetFeather = v; }
  get feather() { return this.targetFeather; }

  set bloom(v) { this.targetBloom = v; }
  get bloom() { return this.targetBloom; }

  set audioSensitivity(v) { this.targetAudioSensitivity = v; }
  get audioSensitivity() { return this.targetAudioSensitivity; }

  set visualMode(m) { this.setVisualMode(m); }
  get visualMode() { return this.currentVisualMode; }

  set colorMode(m) { this.setColorMode(m); }
  get colorMode() { return this.currentColorMode; }

  setVisualMode(mode) {
    const m = parseInt(mode, 10);
    if (!isNaN(m) && m !== this.currentVisualMode) {
      this.prevVisualMode = this.currentVisualMode;
      this.currentVisualMode = m;
      this.modeBlend = 0.0;
    }
  }

  setColorMode(mode) {
    const m = parseInt(mode, 10);
    if (!isNaN(m) && m !== this.currentColorMode) {
      this.prevColorMode = this.currentColorMode;
      this.currentColorMode = m;
      this.colorBlend = 0.0;
    }
  }

  setMouse(nx, ny) {
    this.lastActiveX = Math.max(0, Math.min(1, nx));
    this.lastActiveY = Math.max(0, Math.min(1, ny));
    this.lastPointerMove = performance.now() / 1000;
  }

  setTouchMode(isTouch) {
    this.touchMode = !!isTouch;
  }

  beginDrag(nx, ny) {
    this.touchMode = true;
    this.isDragging = true;
    this.dragStartX = nx;
    this.dragStartY = ny;
    this.dragStartPanX = this.panX;
    this.dragStartPanY = this.panY;
    this.basePanX = this.panX;
    this.basePanY = this.panY;
    this.lastDragX = nx;
    this.lastDragY = ny;
    this.dragVelX = 0;
    this.dragVelY = 0;
    this.setMouse(nx, ny);
  }

  dragTo(nx, ny) {
    if (!this.isDragging) {
      this.beginDrag(nx, ny);
      return;
    }
    const dx = (nx - this.dragStartX) * this.visibleX;
    const dy = (ny - this.dragStartY) * this.visibleY;

    // Track drag velocity for inertia
    const curVelX = (nx - this.lastDragX) * this.visibleX;
    const curVelY = (ny - this.lastDragY) * this.visibleY;
    this.dragVelX = curVelX * 0.45 + this.dragVelX * 0.55;
    this.dragVelY = curVelY * 0.45 + this.dragVelY * 0.55;
    this.lastDragX = nx;
    this.lastDragY = ny;

    this.targetPanX = Math.max(-this.maxPanX, Math.min(this.maxPanX, this.dragStartPanX - dx));
    this.targetPanY = Math.max(-this.maxPanY, Math.min(this.maxPanY, this.dragStartPanY - dy));
    this.basePanX = this.targetPanX;
    this.basePanY = this.targetPanY;
    this.setMouse(nx, ny);
  }

  endDrag() {
    this.isDragging = false;
    // Apply inertia
    const inertiaX = this.dragVelX * 2.5;
    const inertiaY = this.dragVelY * 2.5;
    this.targetPanX = Math.max(-this.maxPanX, Math.min(this.maxPanX, this.targetPanX - inertiaX));
    this.targetPanY = Math.max(-this.maxPanY, Math.min(this.maxPanY, this.targetPanY - inertiaY));
    this.basePanX = this.targetPanX;
    this.basePanY = this.targetPanY;
    this.dragVelX = 0;
    this.dragVelY = 0;
  }

  pressClick(nx, ny) {
    if (typeof nx === 'number' && typeof ny === 'number') {
      this.setMouse(nx, ny);
    }
    this.holdingClick = true;
  }

  releaseClick() {
    this.holdingClick = false;
  }

  setScroll(v) {
    this.scrollY = Math.max(0, Math.min(1, v));
  }

  setPlaying(v) {
    this.isPlaying = !!v;
  }

  _initWebGL() {
    const gl = this.gl;

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_position + 1.0) * 0.5;
        // Flip Y for standard top-to-bottom UV
        v_uv.y = 1.0 - v_uv.y;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      varying vec2 v_uv;

      uniform sampler2D u_scene;
      uniform sampler2D u_blinds;
      uniform sampler2D u_diffSharp;
      uniform sampler2D u_diffBlur;
      uniform sampler2D u_diffWideBlur;

      uniform float u_audioLevel;
      uniform float u_bassLevel;
      uniform float u_midLevel;
      uniform float u_trebleLevel;
      uniform float u_stereoPan;
      uniform float u_centroid;
      uniform float u_onset;
      uniform float u_climaxFlash;
      uniform float u_feather;
      uniform float u_bloom;
      uniform float u_time;

      uniform int u_prevVisualMode;
      uniform int u_currentVisualMode;
      uniform float u_modeBlend;

      uniform int u_prevColorMode;
      uniform int u_currentColorMode;
      uniform float u_colorBlend;
      uniform vec2 u_viewScale;
      uniform vec2 u_viewPan;
      uniform float u_idleBlend;
      uniform vec2 u_mouse;
      uniform float u_cursorRadius;
      uniform float u_cursorStrength;

      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      float getModeDrive(int mode, vec2 uv, float audioLevel, float bass, float mid, float treble, float pan, float onset, float time) {
        float d = 0.0;
        if (mode == 0) {
          // Mode 0: Bottom-up raster
          float heightFromLawn = 1.0 - uv.y;
          float reach = clamp(audioLevel * 1.45 + onset * 0.25, 0.08, 1.0);
          
          float floorFactor = 1.0 - smoothstep(reach, reach + 0.30, heightFromLawn);
          
          float wavePulse = fract(time * 0.45 + heightFromLawn * 1.2);
          float waveIn = smoothstep(0.0, 0.3, wavePulse);
          float waveOut = 1.0 - smoothstep(0.3, 0.7, wavePulse);
          float waveEffect = waveIn * waveOut * onset * 0.4;

          float freqSplit = mix(bass, treble, smoothstep(0.2, 0.8, heightFromLawn));
          d = (floorFactor * 0.75 + freqSplit * 0.45 + waveEffect) * 1.1;
        }
        else if (mode == 1) {
          // Mode 1: Radial expansion from entrance
          vec2 entranceOrigin = vec2(0.50, 0.64);
          vec2 dVec = (uv - entranceOrigin) * vec2(1.0, 1.35);
          float dist = length(dVec);

          float rippleWave = sin(dist * 22.0 - time * 7.0) * 0.5 + 0.5;
          float outwardWash = 1.0 - smoothstep(0.0, 1.1, dist);

          d = (outwardWash * 0.65 + rippleWave * (audioLevel * 0.5 + onset * 0.4)) * 1.15;
        }
        else if (mode == 2) {
          // Mode 2: Stereo wings
          float height = 1.0 - uv.y;
          float freqDrive = mix(bass, treble, smoothstep(0.15, 0.85, height));
          
          float stereoDrive = 0.0;
          if (uv.x < 0.35) {
            stereoDrive = mix(freqDrive, audioLevel, clamp(-pan, 0.0, 0.8));
          } else if (uv.x > 0.65) {
            stereoDrive = mix(freqDrive, audioLevel, clamp(pan, 0.0, 0.8));
          } else {
            stereoDrive = mid * 1.25 + onset * 0.2;
          }
          d = mix(audioLevel, stereoDrive, 0.75) + onset * 0.2;
        }
        else if (mode == 3) {
          // Mode 3: Equalizer sweep
          float colBand = clamp(uv.x, 0.0, 1.0);
          float colHeight = mix(bass, treble, colBand);
          float sweep = smoothstep(0.0, 0.8, uv.y + (1.0 - colHeight) * 0.7);
          d = sweep * 1.1 + onset * 0.2;
        }
        else {
          // Mode 4: Full building pulse
          d = audioLevel * 1.25 + onset * 0.35;
        }
        return d;
      }

      vec3 getModeLightColor(int mode, vec2 uv, float centroid) {
        if (mode == 1) {
          float targetHue = mix(0.08, 0.55, centroid);
          return hsv2rgb(vec3(targetHue, 0.9, 1.0));
        } else if (mode == 2) {
          float wingHue = uv.x < 0.5 ? 0.52 : 0.88;
          return hsv2rgb(vec3(wingHue, 0.95, 1.0));
        } else if (mode == 3) {
          float synthHue = mix(0.78, 0.05, uv.y);
          return hsv2rgb(vec3(synthHue, 0.9, 1.0));
        } else if (mode == 4) {
          return vec3(0.2, 1.0, 0.45);
        }
        return vec3(1.0, 0.86, 0.56);
      }

      vec3 applyColorTheme(int mode, vec2 uv, vec3 baseColor, float reveal, float centroid) {
        if (mode == 1) {
          float targetHue = mix(0.08, 0.55, centroid);
          vec3 hsv = rgb2hsv(baseColor);
          hsv.x = targetHue;
          hsv.y = min(1.0, hsv.y * 1.35);
          return mix(baseColor, hsv2rgb(hsv), reveal * 0.75);
        } else if (mode == 2) {
          float wingHue = uv.x < 0.5 ? 0.52 : 0.88;
          vec3 hsv = rgb2hsv(baseColor);
          hsv.x = wingHue;
          hsv.y = max(hsv.y * 1.6, 0.85);
          return mix(baseColor, hsv2rgb(hsv), reveal * 0.85);
        } else if (mode == 3) {
          float synthHue = mix(0.78, 0.05, uv.y);
          vec3 hsv = rgb2hsv(baseColor);
          hsv.x = synthHue;
          hsv.y = max(hsv.y * 1.5, 0.85);
          return mix(baseColor, hsv2rgb(hsv), reveal * 0.8);
        } else if (mode == 4) {
          vec3 hsv = rgb2hsv(baseColor);
          hsv.x = 0.38;
          hsv.y = max(hsv.y * 1.6, 0.85);
          return mix(baseColor, hsv2rgb(hsv), reveal * 0.85);
        }
        return baseColor;
      }

      void main() {
        vec2 uv = v_uv;
        uv = (uv - 0.5) * u_viewScale + 0.5 + u_viewPan;
        uv = clamp(uv, 0.0, 1.0);

        // Torch spotlight / idle morph
        vec2 cursorDelta = uv - u_mouse;
        float cursorAngle = atan(cursorDelta.y, cursorDelta.x + 1e-6);
        float cursorRad = length(cursorDelta);
        float idleWobble = 1.0
          + 0.07 * sin(cursorAngle * 2.0 + u_time * 0.8)
          + 0.05 * sin(cursorAngle * 3.0 - u_time * 0.55)
          + 0.03 * sin(cursorAngle * 5.0 + u_time * 1.25);
        float morph = u_idleBlend;
        float shapeFactor = 1.0 + morph * (idleWobble - 1.0);
        float expand = 1.0 + morph * 0.4;
        float organicRadius = u_cursorRadius * expand * clamp(shapeFactor, 0.88, 1.14);
        float coreGlow = 1.0 - smoothstep(0.0, organicRadius, cursorRad);
        coreGlow = smoothstep(0.0, 1.0, coreGlow);
        coreGlow = coreGlow * coreGlow;
        coreGlow = coreGlow * 1.1;

        // Halo and rim
        float haloRadius = organicRadius * 1.35;
        float halo = 1.0 - smoothstep(organicRadius * 0.7, haloRadius, cursorRad);
        halo = smoothstep(0.0, 1.0, halo) * 0.08;
        float rimRadius = organicRadius * 1.22;
        float rimDiff = (cursorRad - rimRadius) / (organicRadius * 0.10 + 0.001);
        float rim = exp(-(rimDiff * rimDiff)) * 0.10;
        float cursorGlow = clamp(coreGlow + halo + rim, 0.0, 1.0);
        vec4 sceneCol = texture2D(u_scene, uv);
        vec4 blindsCol = texture2D(u_blinds, uv);
        vec4 diffSharp = texture2D(u_diffSharp, uv);
        vec4 diffBlur  = texture2D(u_diffBlur, uv);
        vec4 diffWide  = texture2D(u_diffWideBlur, uv);

        float sharpLum = dot(diffSharp.rgb, vec3(0.299, 0.587, 0.114));
        float blurLum  = dot(diffBlur.rgb, vec3(0.299, 0.587, 0.114));
        float wideLum  = dot(diffWide.rgb, vec3(0.299, 0.587, 0.114));

        // Window mask blend
        float mask = mix(sharpLum, blurLum, u_feather * 0.85);

        // Mode blend
        float driveA = getModeDrive(u_prevVisualMode, uv, u_audioLevel, u_bassLevel, u_midLevel, u_trebleLevel, u_stereoPan, u_onset, u_time);
        float driveB = getModeDrive(u_currentVisualMode, uv, u_audioLevel, u_bassLevel, u_midLevel, u_trebleLevel, u_stereoPan, u_onset, u_time);
        float easedModeT = smoothstep(0.0, 1.0, u_modeBlend);
        float drive = mix(driveA, driveB, easedModeT);
        drive = max(drive, cursorGlow * u_cursorStrength);

        // Idle breathing
        float idleSine = sin(u_time * 0.7) * 0.5 + 0.5;
        float idleBreath = smoothstep(0.0, 1.0, idleSine) * 0.035 + 0.04;
        drive = max(idleBreath, drive);

        // Reveal threshold
        float threshold = clamp(1.0 - drive * 1.35, 0.02, 0.98);
        float featherBand = max(0.08, u_feather * 0.55);
        float rawReveal = smoothstep(threshold - featherBand, threshold + featherBand, mask);
        float reveal = smoothstep(0.0, 1.0, rawReveal);

        vec3 result = mix(sceneCol.rgb, blindsCol.rgb, reveal);

        // Color blend
        vec3 colorA = applyColorTheme(u_prevColorMode, uv, result, reveal, u_centroid);
        vec3 colorB = applyColorTheme(u_currentColorMode, uv, result, reveal, u_centroid);
        vec3 lightA = getModeLightColor(u_prevColorMode, uv, u_centroid);
        vec3 lightB = getModeLightColor(u_currentColorMode, uv, u_centroid);

        float easedColorT = smoothstep(0.0, 1.0, u_colorBlend);
        vec3 finalColor = mix(colorA, colorB, easedColorT);
        vec3 emitLightColor = mix(lightA, lightB, easedColorT);

        // Bloom scatter
        float bloomMedium = smoothstep(0.03, 0.55, blurLum);
        float bloomWide   = smoothstep(0.02, 0.40, wideLum);
        float combinedBloom = (bloomMedium * 0.7 + bloomWide * 0.5) * (drive * 0.8 + u_onset * 0.45);

        // Light bleed
        vec3 bloomBleed = emitLightColor * (combinedBloom * u_bloom * 0.65);
        finalColor += bloomBleed;

        // Cursor glow overlay
        float cursorOverlay = 1.0 - smoothstep(organicRadius * 0.05, organicRadius, cursorRad);
        cursorOverlay = smoothstep(0.0, 1.0, cursorOverlay);
        cursorOverlay = cursorOverlay * cursorOverlay;
        finalColor += emitLightColor * cursorOverlay * (0.22 + u_idleBlend * 0.06) * u_bloom * u_cursorStrength;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('Vertex shader compile error:', gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('Fragment shader compile error:', gl.getShaderInfoLog(fs));
    }

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(this.program));
    }

    gl.useProgram(this.program);

    const quad = new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1
    ]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    this.attribPos = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(this.attribPos);
    gl.vertexAttribPointer(this.attribPos, 2, gl.FLOAT, false, 0, 0);

    const initErr = gl.getError();
    if (initErr !== gl.NO_ERROR) {
      console.error('WebGL init error code:', initErr);
    }

    this.uniforms = {
      scene: gl.getUniformLocation(this.program, 'u_scene'),
      blinds: gl.getUniformLocation(this.program, 'u_blinds'),
      diffSharp: gl.getUniformLocation(this.program, 'u_diffSharp'),
      diffBlur: gl.getUniformLocation(this.program, 'u_diffBlur'),
      diffWideBlur: gl.getUniformLocation(this.program, 'u_diffWideBlur'),
      audioLevel: gl.getUniformLocation(this.program, 'u_audioLevel'),
      bassLevel: gl.getUniformLocation(this.program, 'u_bassLevel'),
      midLevel: gl.getUniformLocation(this.program, 'u_midLevel'),
      trebleLevel: gl.getUniformLocation(this.program, 'u_trebleLevel'),
      stereoPan: gl.getUniformLocation(this.program, 'u_stereoPan'),
      centroid: gl.getUniformLocation(this.program, 'u_centroid'),
      onset: gl.getUniformLocation(this.program, 'u_onset'),
      climaxFlash: gl.getUniformLocation(this.program, 'u_climaxFlash'),
      feather: gl.getUniformLocation(this.program, 'u_feather'),
      bloom: gl.getUniformLocation(this.program, 'u_bloom'),
      time: gl.getUniformLocation(this.program, 'u_time'),
      prevVisualMode: gl.getUniformLocation(this.program, 'u_prevVisualMode'),
      currentVisualMode: gl.getUniformLocation(this.program, 'u_currentVisualMode'),
      modeBlend: gl.getUniformLocation(this.program, 'u_modeBlend'),
      prevColorMode: gl.getUniformLocation(this.program, 'u_prevColorMode'),
      currentColorMode: gl.getUniformLocation(this.program, 'u_currentColorMode'),
      colorBlend: gl.getUniformLocation(this.program, 'u_colorBlend'),
      viewScale: gl.getUniformLocation(this.program, 'u_viewScale'),
      viewPan: gl.getUniformLocation(this.program, 'u_viewPan'),
      mouse: gl.getUniformLocation(this.program, 'u_mouse'),
      cursorRadius: gl.getUniformLocation(this.program, 'u_cursorRadius'),
      cursorStrength: gl.getUniformLocation(this.program, 'u_cursorStrength'),
      idleBlend: gl.getUniformLocation(this.program, 'u_idleBlend')
    };
  }

  async _loadAssets() {
    let loadedCount = 0;
    const totalAssets = 3;
    const loadImg = (url, name) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedCount++;
        const pct = 0.2 + (loadedCount / totalAssets) * 0.65;
        this._reportProgress(pct, `Loading ${name}...`);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load visualizer asset: ${url}`));
      img.src = url;
    });

    try {
      this._reportProgress(0.12, 'Connecting architectural pipeline...');
      const [imgScene, imgBlinds, imgDiff] = await Promise.all([
        loadImg('scenes.png', 'base facade'),
        loadImg('blinds.png', 'illumination mask'),
        loadImg('difference.png', 'photonic difference')
      ]);

      console.log('Images loaded successfully:', {
        scene: `${imgScene.width}x${imgScene.height}`,
        blinds: `${imgBlinds.width}x${imgBlinds.height}`,
        diff: `${imgDiff.width}x${imgDiff.height}`
      });

      this._reportProgress(0.88, 'Compiling photonic bloom buffers...');
      this.imgWidth = imgScene.width;
      this.imgHeight = imgScene.height;

      this.texScene = this._createTexture(imgScene, 'texScene');
      this.texBlinds = this._createTexture(imgBlinds, 'texBlinds');
      this.texDiffSharp = this._createTexture(imgDiff, 'texDiffSharp');

      // Gaussian blurs for bloom
      const blurCanvas1 = document.createElement('canvas');
      blurCanvas1.width = imgDiff.width;
      blurCanvas1.height = imgDiff.height;
      const ctx1 = blurCanvas1.getContext('2d');
      ctx1.filter = 'blur(16px)';
      ctx1.drawImage(imgDiff, 0, 0);
      this.texDiffBlur = this._createTexture(blurCanvas1, 'texDiffBlur');

      const blurCanvas2 = document.createElement('canvas');
      blurCanvas2.width = imgDiff.width;
      blurCanvas2.height = imgDiff.height;
      const ctx2 = blurCanvas2.getContext('2d');
      ctx2.filter = 'blur(36px)';
      ctx2.drawImage(imgDiff, 0, 0);
      this.texDiffWideBlur = this._createTexture(blurCanvas2, 'texDiffWideBlur');

      this.isLoaded = true;
      this.resize();
      this._reportProgress(1.0, 'Architecture calibrated');
      console.log('ShaderRenderer asset pipeline ready, isLoaded=true');
      return true;
    } catch (err) {
      console.error('ShaderRenderer asset loading error:', err);
      return false;
    }
  }

  _createTexture(imageSource, label = 'texture') {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      console.error(`WebGL _createTexture error for ${label}:`, err);
    }
    return tex;
  }

  resize() {
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : null;
    const w = rect ? rect.width : window.innerWidth;
    const h = rect ? rect.height : window.innerHeight;
    if (w <= 0 || h <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // Cover fit
    const overscan = 1.09;
    const baseScale = Math.max(w / this.imgWidth, h / this.imgHeight) * overscan;
    const dispW = this.imgWidth * baseScale;
    const dispH = this.imgHeight * baseScale;
    this.visibleX = w / dispW;
    this.visibleY = h / dispH;
    this.maxPanX = Math.max(0.025, (1.0 - this.visibleX) * 0.5);
    this.maxPanY = Math.max(0.025, (1.0 - this.visibleY) * 0.5);

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(audioState) {
    if (!this.isLoaded) return;
    const gl = this.gl;

    const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const dt = Math.min(0.05, Math.max(0.005, (nowMs - (this.lastFrameTime || nowMs)) / 1000));
    this.lastFrameTime = nowMs;
    const dt60 = dt * 60.0;

    this.time += 0.025 * dt60;

    if (this.modeBlend < 1.0) {
      this.modeBlend = Math.min(1.0, this.modeBlend + 0.035 * dt60);
    }

    if (this.colorBlend < 1.0) {
      this.colorBlend = Math.min(1.0, this.colorBlend + 0.035 * dt60);
    }

    this.smoothFeather += (this.targetFeather - this.smoothFeather) * Math.min(1.0, 0.16 * dt60);
    this.smoothBloom += (this.targetBloom - this.smoothBloom) * Math.min(1.0, 0.16 * dt60);
    this.smoothSensitivity += (this.targetAudioSensitivity - this.smoothSensitivity) * Math.min(1.0, 0.16 * dt60);

    const smoothEase = (current, target, attackRate, releaseRate) => {
      const rate = (target > current ? attackRate : releaseRate) * dt60;
      return current + (target - current) * Math.min(1.0, rate);
    };

    const env = audioState ? audioState.bandEnvelopes : new Float32Array(7);
    const sens = this.smoothSensitivity;

    const isPlaying = this.isPlaying;
    const rawAudioLevel = isPlaying && audioState ? Math.min(1.0, audioState.rms * 1.5 * sens) : 0.0;
    const rawBassLevel = isPlaying && audioState ? Math.min(1.0, (env[0] * 0.7 + env[1] * 0.6) * sens) : 0.0;
    const rawMidLevel = isPlaying && audioState ? Math.min(1.0, (env[2] * 0.5 + env[3] * 0.6) * sens) : 0.0;
    const rawTrebleLevel = isPlaying && audioState ? Math.min(1.0, (env[4] * 0.5 + env[5] * 0.7 + env[6] * 0.6) * sens) : 0.0;
    const rawStereoPan = isPlaying && audioState ? audioState.stereoPan : 0.0;
    const rawCentroid = isPlaying && audioState ? audioState.spectralCentroid : 0.3;
    const rawOnset = isPlaying && audioState ? audioState.onsetIntensity : 0.0;
    const rawClimax = isPlaying && audioState ? audioState.climaxFlash : 0.0;

    this.smoothAudioLevel   = smoothEase(this.smoothAudioLevel, rawAudioLevel, 0.22, 0.07);
    this.smoothBassLevel    = smoothEase(this.smoothBassLevel, rawBassLevel, 0.24, 0.06);
    this.smoothMidLevel     = smoothEase(this.smoothMidLevel, rawMidLevel, 0.20, 0.07);
    this.smoothTrebleLevel  = smoothEase(this.smoothTrebleLevel, rawTrebleLevel, 0.26, 0.08);
    this.smoothStereoPan   += (rawStereoPan - this.smoothStereoPan) * Math.min(1.0, 0.08 * dt60);
    this.smoothCentroid    += (rawCentroid - this.smoothCentroid) * Math.min(1.0, 0.05 * dt60);
    this.smoothOnset        = smoothEase(this.smoothOnset, rawOnset, 0.32, 0.07);
    this.smoothClimaxFlash  = smoothEase(this.smoothClimaxFlash, rawClimax, 0.20, 0.05);

    const isAudioPlaying = isPlaying && (audioState && audioState.rms > 0.002);

    // Cursor strength fade
    const targetCursorStrength = isAudioPlaying ? 0.0 : 0.95;
    const cursorEaseRate = (isAudioPlaying ? 0.06 : 0.035) * dt60;
    this.smoothCursorStrength += (targetCursorStrength - this.smoothCursorStrength) * Math.min(1.0, cursorEaseRate);
    if (this.smoothCursorStrength < 0.001) this.smoothCursorStrength = 0.0;
    const normCursor = Math.max(0.0, Math.min(1.0, this.smoothCursorStrength / 0.95));
    const easedCursorStrength = (normCursor * normCursor * (3.0 - 2.0 * normCursor)) * 0.95;

    // Click pulse
    if (this.holdingClick) {
      this.clickPulse += (1.0 - this.clickPulse) * Math.min(1.0, 0.22 * dt60);
    } else {
      this.clickPulse += (0.0 - this.clickPulse) * Math.min(1.0, 0.055 * dt60);
      if (this.clickPulse < 0.001) this.clickPulse = 0.0;
    }
    const easedClick = this.clickPulse * this.clickPulse * (3.0 - 2.0 * this.clickPulse);
    const clickScale = 1.0 + easedClick * 1.35;

    // Idle transition
    const nowSec = nowMs / 1000;
    const shouldBeIdle = (nowSec - this.lastPointerMove) > 3.6;

    const targetIdle = shouldBeIdle ? 1.0 : 0.0;
    const idleRate = (shouldBeIdle ? 0.015 : 0.055) * dt60;
    this.idleBlend += (targetIdle - this.idleBlend) * Math.min(1.0, idleRate);
    const easedIdle = this.idleBlend * this.idleBlend * (3.0 - 2.0 * this.idleBlend);

    const t = this.time;
    const wanderX = 0.5 + 0.16 * Math.sin(t * 0.21) + 0.07 * Math.sin(t * 0.53 + 1.7);
    const wanderY = 0.5 + 0.13 * Math.cos(t * 0.17 + 0.9) + 0.05 * Math.sin(t * 0.41 + 2.4);
    const wX = Math.max(0.18, Math.min(0.82, wanderX));
    const wY = Math.max(0.2, Math.min(0.8, wanderY));

    const activeX = this.lastActiveX;
    const activeY = this.lastActiveY;
    this.targetMouseX = activeX + (wX - activeX) * easedIdle;
    this.targetMouseY = activeY + (wY - activeY) * easedIdle;

    const pointerEase = (0.03 + (1.0 - easedIdle) * 0.12) * dt60;
    this.mouseX += (this.targetMouseX - this.mouseX) * Math.min(1.0, pointerEase);
    this.mouseY += (this.targetMouseY - this.mouseY) * Math.min(1.0, pointerEase);

    // Camera drift and parallax
    const driftX = (Math.sin(t * 0.28) * 0.55 + Math.sin(t * 0.52 + 1.4) * 0.30 + Math.sin(t * 0.12 + 2.8) * 0.15);
    const driftY = (Math.cos(t * 0.23 + 0.7) * 0.55 + Math.sin(t * 0.44 + 2.1) * 0.30 + Math.cos(t * 0.10 + 0.3) * 0.15);

    if (this.touchMode) {
      if (!this.isDragging) {
        const swayAmp = isAudioPlaying ? 0.35 : 0.65;
        const driftOffsetX = driftX * this.maxPanX * swayAmp * 0.35;
        const driftOffsetY = driftY * this.maxPanY * swayAmp * 0.35;
        this.targetPanX = Math.max(-this.maxPanX, Math.min(this.maxPanX, this.basePanX + driftOffsetX));
        this.targetPanY = Math.max(-this.maxPanY, Math.min(this.maxPanY, this.basePanY + driftOffsetY));
      }
    } else {
      const targetPlayBlend = isAudioPlaying ? 1.0 : 0.0;
      this.cameraPlayBlend += (targetPlayBlend - this.cameraPlayBlend) * Math.min(1.0, 0.04 * dt60);
      const easedPlayT = this.cameraPlayBlend * this.cameraPlayBlend * (3.0 - 2.0 * this.cameraPlayBlend);

      const swayAmp = isAudioPlaying ? 0.25 : 0.55;
      const tpx = (this.mouseX - 0.5) * this.maxPanX + driftX * this.maxPanX * swayAmp;

      const focus = Math.max(0.2, Math.min(0.75, 0.45 + (this.smoothAudioLevel - 0.4) * 0.6));
      const tpyPlaying = (0.5 - focus) * this.maxPanY * 0.85 + (this.mouseY - 0.5) * 0.12 * this.maxPanY;
      const tpyIdle = (this.scrollY - 0.5) * this.maxPanY + (this.mouseY - 0.5) * 0.35 * this.maxPanY;
      const tpy = tpyIdle + (tpyPlaying - tpyIdle) * easedPlayT + driftY * this.maxPanY * swayAmp;

      this.targetPanX = Math.max(-this.maxPanX, Math.min(this.maxPanX, tpx));
      this.targetPanY = Math.max(-this.maxPanY, Math.min(this.maxPanY, tpy));
    }

    // Camera pan easing
    const panEase = Math.min(1.0, 0.08 * dt60);
    this.panX += (this.targetPanX - this.panX) * panEase;
    this.panY += (this.targetPanY - this.panY) * panEase;

    // Map cursor to UV space
    this.mouseUVX = (this.mouseX - 0.5) * this.visibleX + 0.5 + this.panX;
    this.mouseUVY = (this.mouseY - 0.5) * this.visibleY + 0.5 + this.panY;

    // Render viewport
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.024, 0.035, 0.067, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texScene);
    gl.uniform1i(this.uniforms.scene, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texBlinds);
    gl.uniform1i(this.uniforms.blinds, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texDiffSharp);
    gl.uniform1i(this.uniforms.diffSharp, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.texDiffBlur);
    gl.uniform1i(this.uniforms.diffBlur, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.texDiffWideBlur);
    gl.uniform1i(this.uniforms.diffWideBlur, 4);

    gl.uniform1f(this.uniforms.audioLevel, this.smoothAudioLevel);
    gl.uniform1f(this.uniforms.bassLevel, this.smoothBassLevel);
    gl.uniform1f(this.uniforms.midLevel, this.smoothMidLevel);
    gl.uniform1f(this.uniforms.trebleLevel, this.smoothTrebleLevel);
    gl.uniform1f(this.uniforms.stereoPan, this.smoothStereoPan);
    gl.uniform1f(this.uniforms.centroid, this.smoothCentroid);
    gl.uniform1f(this.uniforms.onset, this.smoothOnset);
    gl.uniform1f(this.uniforms.climaxFlash, this.smoothClimaxFlash);
    gl.uniform1f(this.uniforms.feather, this.smoothFeather);
    gl.uniform1f(this.uniforms.bloom, this.smoothBloom);
    gl.uniform1f(this.uniforms.time, this.time);
    gl.uniform2f(this.uniforms.viewScale, this.visibleX, this.visibleY);
    gl.uniform2f(this.uniforms.viewPan, this.panX, this.panY);
    gl.uniform2f(this.uniforms.mouse, this.mouseUVX, this.mouseUVY);
    gl.uniform1f(this.uniforms.cursorRadius, 0.14 * clickScale);
    gl.uniform1f(this.uniforms.idleBlend, easedIdle);
    gl.uniform1f(this.uniforms.cursorStrength, easedCursorStrength);

    gl.uniform1i(this.uniforms.prevVisualMode, this.prevVisualMode);
    gl.uniform1i(this.uniforms.currentVisualMode, this.currentVisualMode);
    gl.uniform1f(this.uniforms.modeBlend, this.modeBlend);

    gl.uniform1i(this.uniforms.prevColorMode, this.prevColorMode);
    gl.uniform1i(this.uniforms.currentColorMode, this.currentColorMode);
    gl.uniform1f(this.uniforms.colorBlend, this.colorBlend);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.attribPos);
    gl.vertexAttribPointer(this.attribPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!this._firstFrameLogged) {
      this._firstFrameLogged = true;
      const drawErr = gl.getError();
      console.log('ShaderRenderer first frame drawn:', {
        canvasW: this.canvas.width,
        canvasH: this.canvas.height,
        visibleX: this.visibleX,
        visibleY: this.visibleY,
        glError: drawErr
      });
    }
  }
}
