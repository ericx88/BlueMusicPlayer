import re

with open('src/renderer/services/audioService.ts.bak', 'r') as f:
    code = f.read()

# Replace properties
code = code.replace("private audio: HTMLAudioElement;", """
  private audioA: HTMLAudioElement;
  private audioB: HTMLAudioElement;
  private activePlayer: 'A' | 'B' = 'A';
  private sourceNodeA: MediaElementAudioSourceNode | null = null;
  private sourceNodeB: MediaElementAudioSourceNode | null = null;
  private gainNodeA: GainNode | null = null;
  private gainNodeB: GainNode | null = null;
  private isCrossfading = false;
  private crossfadeFiredForCurrentTrack = false;
  private fadeDuration = 3.0; // 3 seconds crossfade
""")

# Remove old single properties
code = code.replace("private sourceNode: MediaElementAudioSourceNode | null = null;", "")
code = code.replace("private gainNode: GainNode | null = null;", "")

# Replace constructor
new_constructor = """
  constructor() {
    this.audioA = new Audio();
    this.audioA.crossOrigin = 'anonymous';
    this.audioA.preload = 'auto';

    this.audioB = new Audio();
    this.audioB.crossOrigin = 'anonymous';
    this.audioB.preload = 'auto';

    this.bindAudioEvents(this.audioA, 'A');
    this.bindAudioEvents(this.audioB, 'B');

    if ('mediaSession' in navigator) {
      this.initMediaSession();
    }

    const bypassState = localStorage.getItem('eqBypass');
    this.bypass = bypassState ? JSON.parse(bypassState) : false;

    this.forceResetOperationLock();
    window.addEventListener('beforeunload', () => this.forceResetOperationLock());
    
    // Check for near end
    setInterval(() => this.checkNearEnd(), 500);
  }

  private checkNearEnd() {
    const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
    if (!currentAudio.paused && !this.crossfadeFiredForCurrentTrack && currentAudio.duration) {
      if (currentAudio.currentTime >= currentAudio.duration - this.fadeDuration) {
        this.crossfadeFiredForCurrentTrack = true;
        this.emit('near_end');
      }
    }
  }
"""
code = re.sub(r'constructor\(\) \{[\s\S]*?\}\n', new_constructor, code)

code = re.sub(r'private bindAudioEvents\(\) \{[\s\S]*?\}\n\n  // ==================== MediaSession', """
  private bindAudioEvents(audio: HTMLAudioElement, player: 'A' | 'B') {
    audio.addEventListener('play', () => {
      if (this.activePlayer === player) {
        this.updateMediaSessionState(true);
        this.emit('play');
      }
    });

    audio.addEventListener('pause', () => {
      if (this.activePlayer === player && !this.isCrossfading) {
        this.updateMediaSessionState(false);
        this.emit('pause');
      }
    });

    audio.addEventListener('ended', () => {
      if (this.activePlayer === player) {
        this.emit('end');
      }
    });

    audio.addEventListener('seeked', () => {
      if (this.activePlayer === player) {
        this.updateMediaSessionPositionState();
        this.emit('seek');
      }
    });

    audio.addEventListener('waiting', () => {
      if (this.activePlayer === player) this._isLoading = true;
    });

    audio.addEventListener('canplay', () => {
      if (this.activePlayer === player) this._isLoading = false;
    });

    audio.addEventListener('error', () => {
      if (this.activePlayer === player) {
        const error = audio.error;
        console.error('Audio element error:', error?.code, error?.message);
        this.emit('audio_error', { type: 'media_error', error });
      }
    });
  }

  // ==================== MediaSession""", code)

# Replace this.audio with currentAudio
code = code.replace("this.audio.play()", "(this.activePlayer === 'A' ? this.audioA : this.audioB).play()")
code = code.replace("this.audio.pause()", "(this.activePlayer === 'A' ? this.audioA : this.audioB).pause()")
code = code.replace("this.audio.currentTime", "(this.activePlayer === 'A' ? this.audioA : this.audioB).currentTime")
code = code.replace("this.audio.duration", "(this.activePlayer === 'A' ? this.audioA : this.audioB).duration")
code = code.replace("this.audio.playbackRate", "(this.activePlayer === 'A' ? this.audioA : this.audioB).playbackRate")
code = code.replace("this.audio.src", "(this.activePlayer === 'A' ? this.audioA : this.audioB).src")
code = code.replace("this.audio.paused", "(this.activePlayer === 'A' ? this.audioA : this.audioB).paused")
code = code.replace("this.audio.ended", "(this.activePlayer === 'A' ? this.audioA : this.audioB).ended")
code = code.replace("this.audio.volume", "(this.activePlayer === 'A' ? this.audioA : this.audioB).volume")
code = code.replace("this.audio.error", "(this.activePlayer === 'A' ? this.audioA : this.audioB).error")
code = code.replace("this.audio.removeAttribute('src')", "(this.activePlayer === 'A' ? this.audioA : this.audioB).removeAttribute('src')")
code = code.replace("this.audio.load()", "(this.activePlayer === 'A' ? this.audioA : this.audioB).load()")

new_setup_eq = """
  private setupEQ() {
    if (this.sourceNodeA) return;

    if (!isElectron) {
      this.bypass = true;
      return;
    }

    try {
      this.context = new AudioContext();
      this.sourceNodeA = this.context.createMediaElementSource(this.audioA);
      this.sourceNodeB = this.context.createMediaElementSource(this.audioB);
      this.gainNodeA = this.context.createGain();
      this.gainNodeB = this.context.createGain();

      const savedSettings = this.loadEQSettings();
      this.filters = this.frequencies.map((freq) => {
        const filter = this.context!.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = savedSettings[freq.toString()] || 0;
        return filter;
      });

      this.applyBypassState();

      const savedVolume = localStorage.getItem('volume');
      this.applyVolume(savedVolume ? parseFloat(savedVolume) : 1);

      this.setupContextStateMonitoring();
      this.restoreSavedAudioDevice();
    } catch (error) {
      console.error('EQ init failed:', error);
      this.sourceNodeA = null;
      this.sourceNodeB = null;
      this.context = null;
    }
  }

  private applyBypassState() {
    if (!this.sourceNodeA || !this.gainNodeA || !this.context) return;

    try {
      [this.sourceNodeA, this.sourceNodeB, this.gainNodeA, this.gainNodeB, ...this.filters].forEach(node => {
        try { node.disconnect(); } catch {}
      });

      if (this.bypass) {
        this.sourceNodeA.connect(this.gainNodeA);
        this.sourceNodeB.connect(this.gainNodeB);
        this.gainNodeA.connect(this.context.destination);
        this.gainNodeB.connect(this.context.destination);
      } else {
        this.sourceNodeA.connect(this.gainNodeA);
        this.sourceNodeB.connect(this.gainNodeB);
        
        this.gainNodeA.connect(this.filters[0]);
        this.gainNodeB.connect(this.filters[0]);

        this.filters.forEach((filter, index) => {
          if (index < this.filters.length - 1) {
            filter.connect(this.filters[index + 1]);
          }
        });
        this.filters[this.filters.length - 1].connect(this.context.destination);
      }
    } catch (error) {
      console.error('Error applying EQ:', error);
    }
  }
"""

code = re.sub(r'private setupEQ\(\) \{[\s\S]*?private applyBypassState\(\) \{[\s\S]*?\}\n\n  public isEQEnabled', new_setup_eq + '\n  public isEQEnabled', code)

code = re.sub(r'if \(this\.sourceNode && this\.gainNode && this\.context\) \{', 'if (this.sourceNodeA && this.gainNodeA && this.context) {', code)

new_apply_volume = """
  private applyVolume(volume: number) {
    const normalizedVolume = Math.max(0, Math.min(1, volume));

    if (this.gainNodeA && this.gainNodeB && this.context) {
      const activeGainNode = this.activePlayer === 'A' ? this.gainNodeA : this.gainNodeB;
      activeGainNode.gain.cancelScheduledValues(this.context.currentTime);
      activeGainNode.gain.setValueAtTime(normalizedVolume, this.context.currentTime);
    } else {
      this.audioA.volume = normalizedVolume;
      this.audioB.volume = normalizedVolume;
    }
    localStorage.setItem('volume', normalizedVolume.toString());
  }
"""
code = re.sub(r'private applyVolume\(volume: number\) \{[\s\S]*?\}\n', new_apply_volume, code)

new_play = """
  public play(
    url: string,
    track: SongResult,
    isPlay: boolean = true,
    seekTime: number = 0,
    _existingSound?: HTMLAudioElement
  ): Promise<HTMLAudioElement> {
    const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
    if (currentAudio.src && !url && !track) {
      currentAudio.play();
      return Promise.resolve(currentAudio);
    }

    this.forceResetOperationLock();
    this.setOperationLock();

    if (!url || !track) {
      this.releaseOperationLock();
      return Promise.reject(new Error('缺少必要参数: url和track'));
    }

    const currentSrc = currentAudio.src;
    const isSameUrl = currentSrc && currentSrc === url;

    if (isSameUrl) {
      this.currentTrack = track;
      if (seekTime > 0) currentAudio.currentTime = seekTime;
      if (isPlay) currentAudio.play();
      this.updateMediaSessionMetadata(track);
      this.releaseOperationLock();
      return Promise.resolve(currentAudio);
    }

    return new Promise<HTMLAudioElement>((resolve, reject) => {
      let retryCount = 0;
      const maxRetries = 1;

      const tryPlay = () => {
        this._isLoading = true;
        this.currentTrack = track;

        this.setupEQ();

        if (this.context && this.context.state === 'suspended') {
          this.context.resume().catch((e) => console.warn('Failed to resume AudioContext:', e));
        }
        
        // Setup Crossfade
        const nextPlayer = this.activePlayer === 'A' ? 'B' : 'A';
        const activeAudioElement = this.activePlayer === 'A' ? this.audioA : this.audioB;
        const nextAudioElement = nextPlayer === 'A' ? this.audioA : this.audioB;
        const activeGainNode = this.activePlayer === 'A' ? this.gainNodeA : this.gainNodeB;
        const nextGainNode = nextPlayer === 'A' ? this.gainNodeA : this.gainNodeB;

        const onCanPlay = () => {
          cleanup();
          this._isLoading = false;

          if (seekTime > 0) {
            nextAudioElement.currentTime = seekTime;
          }

          if (isPlay) {
            nextAudioElement.play().catch((err) => {
              console.error('Audio play failed:', err);
              this.emit('playerror', { track, error: err });
            });
            
            // Apply Crossfade if previous audio is playing
            if (!activeAudioElement.paused && activeAudioElement.src && this.context && activeGainNode && nextGainNode) {
               this.isCrossfading = true;
               const savedVolume = parseFloat(localStorage.getItem('volume') || '1');
               const currTime = this.context.currentTime;
               
               // Fade in next
               nextGainNode.gain.cancelScheduledValues(currTime);
               nextGainNode.gain.setValueAtTime(0, currTime);
               nextGainNode.gain.linearRampToValueAtTime(savedVolume, currTime + this.fadeDuration);
               
               // Fade out active
               activeGainNode.gain.cancelScheduledValues(currTime);
               activeGainNode.gain.setValueAtTime(savedVolume, currTime);
               activeGainNode.gain.linearRampToValueAtTime(0, currTime + this.fadeDuration);
               
               setTimeout(() => {
                 activeAudioElement.pause();
                 activeAudioElement.removeAttribute('src');
                 activeAudioElement.load();
                 this.isCrossfading = false;
               }, this.fadeDuration * 1000);
            } else {
               // No crossfade, just apply volume
               const savedVolume = parseFloat(localStorage.getItem('volume') || '1');
               if (nextGainNode && this.context) {
                  nextGainNode.gain.cancelScheduledValues(this.context.currentTime);
                  nextGainNode.gain.setValueAtTime(savedVolume, this.context.currentTime);
               } else {
                  nextAudioElement.volume = savedVolume;
               }
               activeAudioElement.pause();
               activeAudioElement.removeAttribute('src');
               activeAudioElement.load();
            }
          }

          this.activePlayer = nextPlayer;
          this.crossfadeFiredForCurrentTrack = false;
          nextAudioElement.playbackRate = this.playbackRate;
          
          this.updateMediaSessionMetadata(track);
          this.updateMediaSessionPositionState();
          this.emit('load');
          this.releaseOperationLock();
          resolve(nextAudioElement);
        };

        const onError = () => {
          cleanup();
          this._isLoading = false;
          const error = nextAudioElement.error;
          this.emit('loaderror', { track, error });

          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(tryPlay, 1000 * retryCount);
          } else {
            this.emit('url_expired', track);
            this.releaseOperationLock();
            reject(new Error('音频加载失败，请尝试切换其他歌曲'));
          }
        };

        const cleanup = () => {
          nextAudioElement.removeEventListener('canplay', onCanPlay);
          nextAudioElement.removeEventListener('error', onError);
        };

        nextAudioElement.addEventListener('canplay', onCanPlay, { once: true });
        nextAudioElement.addEventListener('error', onError, { once: true });

        nextAudioElement.src = url;
        nextAudioElement.load();
      };

      tryPlay();
    }).finally(() => {
      this.releaseOperationLock();
    });
  }
"""
code = re.sub(r'public play\([\s\S]*?\}\)\.finally\(\(\) => \{[\s\S]*?\}\);\n  \}', new_play, code)

code = code.replace("getCurrentSound(): HTMLAudioElement | null {", """
  getCurrentSound(): HTMLAudioElement | null {
    const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
    return currentAudio.src ? currentAudio : null;
  }
  
  _ignore_this() {""")
code = code.replace("_ignore_this() {", "")

with open('src/renderer/services/audioService.ts', 'w') as f:
    f.write(code)

