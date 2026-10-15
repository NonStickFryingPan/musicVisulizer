export class AudioEngine {
  constructor(options = {}) {
    this.fftSize = options.fftSize || 2048;
    this.historyDurationSec = options.historyDurationSec || 6.0;
    this.attack = options.attack !== undefined ? options.attack : 0.35;
    this.release = options.release !== undefined ? options.release : 0.045;
    this.onsetMultiplier = options.onsetMultiplier || 1.35;
    this.gainMultiplier = options.gainMultiplier || 0.7;

    this.audioCtx = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.splitterNode = null;

    // Analysers for stereo mid/side
    this.analyserL = null;
    this.analyserR = null;
    this.analyserMid = null;
    this.analyserSide = null;

    // Multi-track playlist
    this.playlist = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.audioBuffer = null;

    this.startTime = 0;
    this.pauseOffset = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.isDemoTrack = false;
    this.isLooping = options.loop !== undefined ? options.loop : true;

    // 7 Frequency Bands (Hz)
    this.bandDefs = [
      { name: 'sub_bass', min: 20, max: 60 },
      { name: 'bass', min: 60, max: 250 },
      { name: 'low_mid', min: 250, max: 500 },
      { name: 'mid', min: 500, max: 2000 },
      { name: 'high_mid', min: 2000, max: 6000 },
      { name: 'presence', min: 6000, max: 12000 },
      { name: 'air', min: 12000, max: 20000 }
    ];

    this.bandHistory = this.bandDefs.map(() => []);
    this.bandEnvelopes = new Float32Array(this.bandDefs.length);
    this.bandRawDb = new Float32Array(this.bandDefs.length);
    this.bandNorm = new Float32Array(this.bandDefs.length);
    this.bandEnvelopesL = new Float32Array(this.bandDefs.length);
    this.bandEnvelopesR = new Float32Array(this.bandDefs.length);

    // Features
    this.prevMag = null;
    this.spectralFlux = 0;
    this.fluxHistory = [];
    this.isOnset = false;
    this.onsetIntensity = 0;
    this.spectralCentroid = 0.3;
    this.centroidSmooth = 0.3;
    this.rms = 0;
    this.rmsSmooth = 0;
    this.stereoPan = 0;
    this.stereoWidth = 0;
    this.vocalProxy = 0;
    this.percussionProxy = 0;

    // Peak energy tracking
    this.energyHistory = [];
    this.climaxFlash = 0.0;
    this.isPeakClimax = false;

    // FFT buffers
    this.freqDataMid = null;
    this.freqDataSide = null;
    this.freqDataL = null;
    this.freqDataR = null;
    this.timeData = null;

    // Synth scheduler
    this.demoInterval = null;
    this.demoStep = 0;
    this.demoBpm = 124;

    this.onStateChangeCallbacks = [];
    this.onPlaylistChangeCallbacks = [];
    this.onErrorCallbacks = [];
  }

  async initContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this._setupGraph();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  _setupGraph() {
    if (!this.audioCtx) return;
    const fftSize = this.fftSize;

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = this.volume !== undefined ? this.volume : 1.0;
    this.gainNode.connect(this.audioCtx.destination);

    const createAnalyser = () => {
      const a = this.audioCtx.createAnalyser();
      a.fftSize = fftSize;
      a.smoothingTimeConstant = 0.0;
      a.minDecibels = -100;
      a.maxDecibels = -10;
      return a;
    };

    this.analyserL = createAnalyser();
    this.analyserR = createAnalyser();
    this.analyserMid = createAnalyser();
    this.analyserSide = createAnalyser();

    this.splitterNode = this.audioCtx.createChannelSplitter(2);

    // Mid = (L + R) * 0.5
    const midGainL = this.audioCtx.createGain();
    midGainL.gain.value = 0.5;
    const midGainR = this.audioCtx.createGain();
    midGainR.gain.value = 0.5;

    // Side = (L - R) * 0.5
    const sideGainL = this.audioCtx.createGain();
    sideGainL.gain.value = 0.5;
    const sideGainR = this.audioCtx.createGain();
    sideGainR.gain.value = -0.5;

    this.splitterNode.connect(this.analyserL, 0);
    this.splitterNode.connect(this.analyserR, 1);

    this.splitterNode.connect(midGainL, 0);
    this.splitterNode.connect(midGainR, 1);
    midGainL.connect(this.analyserMid);
    midGainR.connect(this.analyserMid);

    this.splitterNode.connect(sideGainL, 0);
    this.splitterNode.connect(sideGainR, 1);
    sideGainL.connect(this.analyserSide);
    sideGainR.connect(this.analyserSide);

    const binCount = this.analyserMid.frequencyBinCount;
    this.freqDataMid = new Float32Array(binCount);
    this.freqDataSide = new Float32Array(binCount);
    this.freqDataL = new Float32Array(binCount);
    this.freqDataR = new Float32Array(binCount);
    this.timeData = new Float32Array(binCount);
    this.prevMag = new Float32Array(binCount);
  }

  // Playlist management
  async addFilesToPlaylist(files) {
    await this.initContext();
    const newItems = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isMediaMime = file.type.startsWith('audio/') || file.type === 'video/mp4' || file.type === 'video/webm' || file.type === 'video/ogg';
      const isMediaExt = /\.(mp3|wav|ogg|oga|flac|m4a|m4b|aac|opus|mp4|webm|weba|wma|aiff|aif|caf)$/i.test(file.name);
      if (isMediaMime || isMediaExt || !file.type) {
        newItems.push({
          file: file,
          name: file.name.replace(/\.[^/.]+$/, ''),
          buffer: null,
          duration: 0
        });
      }
    }

    if (newItems.length === 0) return;

    const wasEmpty = this.playlist.length === 0;
    this.playlist.push(...newItems);
    this._notifyPlaylistChange();

    if (wasEmpty) {
      await this.playTrack(0);
    }
  }

  async preloadDefaultTrack(url = 'song.mp3', name = 'SINES Theme') {
    try {
      const streamUrl = url.includes('?') ? url : `${url}?stream=1`;
      const response = await fetch(streamUrl, {
        headers: { 'Accept': 'audio/*, application/octet-stream' }
      });
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      await this.initContext();
      const decoded = await this.audioCtx.decodeAudioData(arrayBuffer);
      const defaultItem = {
        url: url,
        name: name,
        buffer: decoded,
        duration: decoded.duration
      };
      if (this.playlist.length === 0) {
        this.playlist = [defaultItem];
        this.currentIndex = 0;
        this.currentTrack = defaultItem;
        this.audioBuffer = decoded;
        this.isDemoTrack = false;
        this.pauseOffset = 0;
        this._notifyPlaylistChange();
        this._notifyStateChange();
      }
      return defaultItem;
    } catch (err) {
      console.warn('Preload default track notice:', err.message);
      return null;
    }
  }

  setLoop(enabled) {
    this.isLooping = !!enabled;
  }

  async playTrack(index) {
    if (index < 0 || index >= this.playlist.length) return;
    this._playToken = (this._playToken || 0) + 1;
    const token = this._playToken;

    await this.initContext();
    this.stopPlaybackOnly();

    this.currentIndex = index;
    this.currentTrack = this.playlist[index];
    this.isDemoTrack = false;
    this.pauseOffset = 0;

    // Decode buffer if not cached
    if (!this.currentTrack.buffer) {
      try {
        let arrayBuffer;
        if (this.currentTrack.file) {
          arrayBuffer = await this.currentTrack.file.arrayBuffer();
        } else if (this.currentTrack.url) {
          const res = await fetch(this.currentTrack.url);
          arrayBuffer = await res.arrayBuffer();
        }
        if (this._playToken !== token) return; // User switched track while reading
        const decoded = await this.audioCtx.decodeAudioData(arrayBuffer);
        if (this._playToken !== token) return; // User switched track while decoding
        this.currentTrack.buffer = decoded;
        this.currentTrack.duration = decoded.duration;
      } catch (err) {
        if (this._playToken !== token) return;
        console.error('Error decoding audio:', err);
        this._notifyError('Could not decode this audio file. Please try an MP3, WAV, or M4A track.');
        return;
      }
    }

    if (this._playToken !== token) return;

    this.audioBuffer = this.currentTrack.buffer;
    this._notifyStateChange();
    this._notifyPlaylistChange();
    this.play();
  }

  nextTrack() {
    if (this.playlist.length === 0) return;
    const nextIdx = (this.currentIndex + 1) % this.playlist.length;
    this.playTrack(nextIdx);
  }

  prevTrack() {
    if (this.playlist.length === 0) return;
    if (this.getCurrentTime() > 3.0) {
      // If more than 3 seconds in, restart current track
      this.seek(0);
      return;
    }
    const prevIdx = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
    this.playTrack(prevIdx);
  }

  clearPlaylist() {
    this.stop();
    this.playlist = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.audioBuffer = null;
    this._notifyStateChange();
    this._notifyPlaylistChange();
  }

  removeTrack(index) {
    if (index < 0 || index >= this.playlist.length) return;
    const wasCurrent = index === this.currentIndex;
    const wasPlaying = this.isPlaying;
    this.playlist.splice(index, 1);

    if (this.playlist.length === 0) {
      this.clearPlaylist();
      return;
    }

    if (wasCurrent) {
      const nextIdx = Math.min(index, this.playlist.length - 1);
      if (wasPlaying) {
        this.playTrack(nextIdx);
      } else {
        this.stopPlaybackOnly();
        this.currentIndex = nextIdx;
        this.currentTrack = this.playlist[nextIdx];
        this.audioBuffer = this.currentTrack ? this.currentTrack.buffer : null;
        this._notifyStateChange();
        this._notifyPlaylistChange();
      }
    } else {
      if (index < this.currentIndex) {
        this.currentIndex--;
      }
      this._notifyStateChange();
      this._notifyPlaylistChange();
    }
  }

  // Transport controls
  play() {
    if (this.isDemoTrack) {
      this._startDemoTrack();
      return;
    }
    if (!this.audioBuffer) {
      if (this.playlist.length > 0) {
        this.playTrack(0);
      } else {
        this.playDemo();
      }
      return;
    }

    if (this.sourceNode) {
      const oldNode = this.sourceNode;
      this.sourceNode = null;
      oldNode.onended = null;
      try { oldNode.stop(); } catch (e) {}
    }

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.connect(this.splitterNode);
    this.sourceNode.connect(this.gainNode);

    // Auto-advance to next track when finished, or loop if looping is enabled
    this.sourceNode.onended = () => {
      if (this.isPlaying && this.getCurrentTime() >= (this.getDuration() - 0.35)) {
        if (this.isLooping) {
          if (this.playlist.length > 1) {
            this.nextTrack();
          } else {
            // Seamless loop of the current track
            this.pauseOffset = 0;
            this.play();
          }
        } else {
          if (this.playlist.length > 1) {
            this.nextTrack();
          } else {
            this.stop();
          }
        }
      }
    };

    this.startTime = this.audioCtx.currentTime - this.pauseOffset;
    this.sourceNode.start(0, this.pauseOffset);
    this.isPlaying = true;
    this.isPaused = false;
    this._notifyStateChange();
  }

  pause() {
    if (this.isDemoTrack) {
      this.stop();
      return;
    }
    if (!this.isPlaying) return;

    this.pauseOffset = this.audioCtx.currentTime - this.startTime;
    this.isPlaying = false;
    this.isPaused = true;

    if (this.sourceNode) {
      const oldNode = this.sourceNode;
      this.sourceNode = null;
      oldNode.onended = null;
      try { oldNode.stop(); } catch (e) {}
    }
    this._notifyStateChange();
  }

  stopPlaybackOnly() {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseOffset = 0;

    if (this.sourceNode) {
      const oldNode = this.sourceNode;
      this.sourceNode = null;
      oldNode.onended = null;
      try { oldNode.stop(); } catch (e) {}
    }
  }

  stop() {
    this.stopPlaybackOnly();
    this._notifyStateChange();
  }

  seek(timeInSec) {
    if (this.isDemoTrack || !this.audioBuffer) return;
    const dur = this.getDuration();
    const wasPlaying = this.isPlaying;
    this.pause();
    this.pauseOffset = Math.max(0, Math.min(timeInSec, Math.max(0, dur - 0.05)));
    if (wasPlaying) {
      this.play();
    } else {
      this._notifyStateChange();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode && this.audioCtx) {
      try {
        this.gainNode.gain.setTargetAtTime(this.volume, this.audioCtx.currentTime, 0.02);
      } catch (e) {
        this.gainNode.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      }
    }
  }

  getCurrentTime() {
    if (this.isDemoTrack) return 0;
    if (!this.isPlaying) return this.pauseOffset;
    return Math.min(this.getDuration(), this.audioCtx.currentTime - this.startTime);
  }

  getDuration() {
    if (this.currentTrack && this.currentTrack.duration) return this.currentTrack.duration;
    if (this.audioBuffer) return this.audioBuffer.duration;
    return 0;
  }

  getTrackName() {
    if (this.isDemoTrack) return 'Procedural Synth Beat';
    if (this.currentTrack) return this.currentTrack.name;
    return 'No track loaded';
  }

  // Procedural synth demo
  async playDemo() {
    await this.initContext();
    this.stopPlaybackOnly();
    this.isDemoTrack = true;
    this.currentTrack = null;
    this.audioBuffer = null;
    this._startDemoTrack();
  }

  _startDemoTrack() {
    this.isPlaying = true;
    this.isPaused = false;
    this._notifyStateChange();

    const stepMs = (60 / this.demoBpm / 4) * 1000;
    this.demoStep = 0;

    const chords = [
      [146.83, 174.61, 220.00],
      [116.54, 146.83, 174.61],
      [174.61, 220.00, 261.63],
      [130.81, 164.81, 196.00]
    ];
    const bassNotes = [73.42, 58.27, 87.31, 65.41];

    this.demoInterval = setInterval(() => {
      if (!this.isPlaying || !this.audioCtx) return;
      const t = this.audioCtx.currentTime;
      const step = this.demoStep % 16;
      const bar = Math.floor((this.demoStep % 64) / 16);

      if (step === 0 || step === 4 || step === 8 || step === 12) this._synthKick(t);
      if (step === 4 || step === 12) this._synthSnare(t);
      if (step % 2 === 0) this._synthHiHat(t, step % 4 === 2);
      if (step === 0 || step === 3 || step === 6 || step === 10 || step === 14) this._synthBass(t, bassNotes[bar]);
      if (step === 0 || step === 8) this._synthChord(t, chords[bar]);

      this.demoStep++;
    }, stepMs);
  }

  _synthKick(t) {
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);

    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    osc.connect(gain);
    gain.connect(this.splitterNode);
    gain.connect(this.gainNode);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  _synthSnare(t) {
    const bufSize = Math.floor(this.audioCtx.sampleRate * 0.18);
    const buf = this.audioCtx.createBuffer(1, bufSize, this.audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = this.audioCtx.createBufferSource();
    noise.buffer = buf;
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1200, t);

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.splitterNode);
    gain.connect(this.gainNode);
    noise.start(t);
  }

  _synthHiHat(t, isOpen) {
    const bufSize = Math.floor(this.audioCtx.sampleRate * (isOpen ? 0.14 : 0.04));
    const buf = this.audioCtx.createBuffer(1, bufSize, this.audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = this.audioCtx.createBufferSource();
    noise.buffer = buf;
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7000, t);

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(isOpen ? 0.35 : 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (isOpen ? 0.14 : 0.04));

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.splitterNode);
    gain.connect(this.gainNode);
    noise.start(t);
  }

  _synthBass(t, freq) {
    const osc = this.audioCtx.createOscillator();
    const filter = this.audioCtx.createBiquadFilter();
    const gain = this.audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + 0.2);

    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.splitterNode);
    gain.connect(this.gainNode);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  _synthChord(t, notes) {
    notes.forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

      osc.connect(gain);
      gain.connect(this.splitterNode);
      gain.connect(this.gainNode);
      osc.start(t);
      osc.stop(t + 0.75);
    });
  }

  // Real-time analysis
  update() {
    if (!this.audioCtx || !this.analyserMid) {
      return this._getEmptyState();
    }

    const sampleRate = this.audioCtx.sampleRate;
    const binCount = this.analyserMid.frequencyBinCount;
    const nyquist = sampleRate / 2;
    const binWidth = nyquist / binCount;

    this.analyserMid.getFloatFrequencyData(this.freqDataMid);
    this.analyserSide.getFloatFrequencyData(this.freqDataSide);
    this.analyserL.getFloatFrequencyData(this.freqDataL);
    this.analyserR.getFloatFrequencyData(this.freqDataR);
    this.analyserMid.getFloatTimeDomainData(this.timeData);

    // RMS Loudness
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      sumSq += this.timeData[i] * this.timeData[i];
    }
    this.rms = Math.sqrt(sumSq / this.timeData.length) * this.gainMultiplier;
    this.rmsSmooth += 0.15 * (this.rms - this.rmsSmooth);

    // Linear magnitude & Spectral Centroid
    const mag = new Float32Array(binCount);
    let totalMag = 0;
    let weightedFreqSum = 0;

    for (let i = 0; i < binCount; i++) {
      const db = this.freqDataMid[i];
      const linear = Math.pow(10, db / 20);
      mag[i] = linear;
      totalMag += linear;
      weightedFreqSum += (i * binWidth) * linear;
    }

    if (totalMag > 1e-6) {
      const centroidHz = weightedFreqSum / totalMag;
      this.spectralCentroid = Math.max(0, Math.min(1, (centroidHz - 100) / 5000));
    } else {
      this.spectralCentroid = 0.25;
    }
    this.centroidSmooth += 0.08 * (this.spectralCentroid - this.centroidSmooth);

    // Spectral Flux & Onsets
    let flux = 0;
    if (this.prevMag) {
      for (let i = 0; i < binCount; i++) {
        const diff = mag[i] - this.prevMag[i];
        if (diff > 0) flux += diff;
      }
    }
    this.spectralFlux = flux * this.gainMultiplier;
    this.prevMag.set(mag);

    this.fluxHistory.push(this.spectralFlux);
    if (this.fluxHistory.length > 60) this.fluxHistory.shift();

    let fluxMean = 0;
    for (let f of this.fluxHistory) fluxMean += f;
    fluxMean /= Math.max(1, this.fluxHistory.length);

    let fluxVar = 0;
    for (let f of this.fluxHistory) fluxVar += (f - fluxMean) * (f - fluxMean);
    const fluxStd = Math.sqrt(fluxVar / Math.max(1, this.fluxHistory.length));

    const adaptiveThreshold = fluxMean + this.onsetMultiplier * fluxStd;
    this.isOnset = this.spectralFlux > adaptiveThreshold && this.spectralFlux > 0.05;
    if (this.isOnset) {
      const targetIntensity = Math.min(1.0, (this.spectralFlux - adaptiveThreshold) / (fluxStd + 0.01) * 0.7 + 0.3);
      this.onsetIntensity += (targetIntensity - this.onsetIntensity) * 0.6;
    } else {
      this.onsetIntensity *= 0.88;
    }

    // 7 Bands + Adaptive Normalization
    const historyLimit = Math.round(this.historyDurationSec * 60);

    for (let b = 0; b < this.bandDefs.length; b++) {
      const def = this.bandDefs[b];
      const startBin = Math.max(0, Math.floor(def.min / binWidth));
      const endBin = Math.min(binCount - 1, Math.ceil(def.max / binWidth));

      let bandEnergy = 0;
      let bandEnergyL = 0;
      let bandEnergyR = 0;

      for (let bin = startBin; bin <= endBin; bin++) {
        bandEnergy += mag[bin] * mag[bin];
        const linL = Math.pow(10, this.freqDataL[bin] / 20);
        const linR = Math.pow(10, this.freqDataR[bin] / 20);
        bandEnergyL += linL * linL;
        bandEnergyR += linR * linR;
      }

      const bandDb = 20 * Math.log10(Math.sqrt(bandEnergy) * this.gainMultiplier + 1e-9);
      this.bandRawDb[b] = bandDb;

      const hist = this.bandHistory[b];
      hist.push(bandDb);
      if (hist.length > historyLimit) hist.shift();

      const sorted = [...hist].sort((a, b) => a - b);
      const loIdx = Math.floor(sorted.length * 0.05);
      const hiIdx = Math.floor(sorted.length * 0.95);
      const lo = sorted[loIdx] !== undefined ? sorted[loIdx] : -80;
      const hi = sorted[hiIdx] !== undefined ? sorted[hiIdx] : -20;
      const range = Math.max(8.0, hi - lo);

      const norm = Math.max(0, Math.min(1, (bandDb - lo) / range));
      this.bandNorm[b] = norm;

      const currentEnv = this.bandEnvelopes[b];
      if (norm > currentEnv) {
        this.bandEnvelopes[b] += this.attack * (norm - currentEnv);
      } else {
        this.bandEnvelopes[b] += this.release * (norm - currentEnv);
      }

      const normL = Math.max(0, Math.min(1, (20 * Math.log10(Math.sqrt(bandEnergyL) * this.gainMultiplier + 1e-9) - lo) / range));
      const normR = Math.max(0, Math.min(1, (20 * Math.log10(Math.sqrt(bandEnergyR) * this.gainMultiplier + 1e-9) - lo) / range));

      if (normL > this.bandEnvelopesL[b]) {
        this.bandEnvelopesL[b] += this.attack * (normL - this.bandEnvelopesL[b]);
      } else {
        this.bandEnvelopesL[b] += this.release * (normL - this.bandEnvelopesL[b]);
      }

      if (normR > this.bandEnvelopesR[b]) {
        this.bandEnvelopesR[b] += this.attack * (normR - this.bandEnvelopesR[b]);
      } else {
        this.bandEnvelopesR[b] += this.release * (normR - this.bandEnvelopesR[b]);
      }
    }

    // Vocal & Percussion Proxies
    this.vocalProxy = (this.bandEnvelopes[2] * 0.4 + this.bandEnvelopes[3] * 0.6);
    this.percussionProxy = Math.min(1.0, this.onsetIntensity * 0.6 + this.bandEnvelopes[4] * 0.4);

    // Stereo Width & Pan
    let sumL = 0, sumR = 0;
    for (let b = 0; b < this.bandDefs.length; b++) {
      sumL += this.bandEnvelopesL[b];
      sumR += this.bandEnvelopesR[b];
    }
    const totLR = sumL + sumR + 1e-5;
    this.stereoPan = (sumR - sumL) / totLR;
    this.stereoWidth = Math.abs(sumR - sumL) / totLR;

    // Peak energy detection
    const currentCombinedEnergy = this.rmsSmooth * 0.5 + this.bandEnvelopes[0] * 0.3 + this.bandEnvelopes[1] * 0.2;
    this.energyHistory.push(currentCombinedEnergy);
    if (this.energyHistory.length > 240) this.energyHistory.shift();

    const sortedEnergy = [...this.energyHistory].sort((a, b) => a - b);
    const p95Idx = Math.floor(sortedEnergy.length * 0.95);
    const p95Energy = sortedEnergy[p95Idx] !== undefined ? sortedEnergy[p95Idx] : 0.8;

    this.isPeakClimax = (this.energyHistory.length >= 30) && (currentCombinedEnergy >= p95Energy) && (currentCombinedEnergy > 0.42);

    if (this.isPeakClimax) {
      this.climaxFlash += (1.0 - this.climaxFlash) * 0.22;
    } else {
      this.climaxFlash *= 0.94;
      if (this.climaxFlash < 0.005) this.climaxFlash = 0.0;
    }

    return {
      bandEnvelopes: this.bandEnvelopes,
      bandEnvelopesL: this.bandEnvelopesL,
      bandEnvelopesR: this.bandEnvelopesR,
      spectralFlux: this.spectralFlux,
      isOnset: this.isOnset,
      onsetIntensity: this.onsetIntensity,
      spectralCentroid: this.centroidSmooth,
      rms: this.rmsSmooth,
      stereoPan: this.stereoPan,
      stereoWidth: this.stereoWidth,
      vocalProxy: this.vocalProxy,
      percussionProxy: this.percussionProxy,
      climaxFlash: this.climaxFlash,
      isPeakClimax: this.isPeakClimax
    };
  }

  _getEmptyState() {
    return {
      bandEnvelopes: this.bandEnvelopes,
      bandEnvelopesL: this.bandEnvelopesL,
      bandEnvelopesR: this.bandEnvelopesR,
      spectralFlux: 0,
      isOnset: false,
      onsetIntensity: 0,
      spectralCentroid: 0.3,
      rms: 0,
      stereoPan: 0,
      stereoWidth: 0,
      vocalProxy: 0,
      percussionProxy: 0,
      climaxFlash: 0,
      isPeakClimax: false
    };
  }

  onStateChange(cb) {
    this.onStateChangeCallbacks.push(cb);
  }

  onPlaylistChange(cb) {
    if (typeof cb === 'function') {
      this.onPlaylistChangeCallbacks.push(cb);
    }
  }

  onError(cb) {
    this.onErrorCallbacks.push(cb);
  }

  _notifyError(message) {
    for (const cb of this.onErrorCallbacks) {
      try { cb(message); } catch (_) {}
    }
  }

  _notifyStateChange() {
    for (const cb of this.onStateChangeCallbacks) {
      cb({
        isPlaying: this.isPlaying,
        isPaused: this.isPaused,
        isDemoTrack: this.isDemoTrack,
        trackName: this.getTrackName(),
        duration: this.getDuration(),
        currentTime: this.getCurrentTime(),
        currentIndex: this.currentIndex,
        playlistCount: this.playlist.length
      });
    }
  }

  _notifyPlaylistChange() {
    for (const cb of this.onPlaylistChangeCallbacks) {
      cb(this.playlist, this.currentIndex);
    }
  }
}
