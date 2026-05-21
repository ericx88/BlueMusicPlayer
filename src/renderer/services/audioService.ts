import type { AudioOutputDevice } from '@/types/audio';
import type { SongResult } from '@/types/music';
import { isElectron } from '@/utils';

class AudioService {
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

  private currentTrack: SongResult | null = null;
  private context: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private bypass = false;
  private playbackRate = 1.0;
  private currentSinkId: string = 'default';
  private _isLoading = false;

  private operationLock = false;
  private operationLockTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  private defaultEQSettings: { [key: string]: number } = {
    '31': 0, '62': 0, '125': 0, '250': 0, '500': 0,
    '1000': 0, '2000': 0, '4000': 0, '8000': 0, '16000': 0
  };

  private callbacks: { [key: string]: Function[] } = {};

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

  private initMediaSession() {
    navigator.mediaSession.setActionHandler('play', () => {
      (this.activePlayer === 'A' ? this.audioA : this.audioB).play();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      (this.activePlayer === 'A' ? this.audioA : this.audioB).pause();
    });

    navigator.mediaSession.setActionHandler('stop', () => {
      this.stop();
    });

    navigator.mediaSession.setActionHandler('seekto', (event) => {
      if (event.seekTime !== undefined) {
        this.seek(event.seekTime);
      }
    });

    navigator.mediaSession.setActionHandler('seekbackward', (event) => {
      this.seek((this.activePlayer === 'A' ? this.audioA : this.audioB).currentTime - (event.seekOffset || 10));
    });

    navigator.mediaSession.setActionHandler('seekforward', (event) => {
      this.seek((this.activePlayer === 'A' ? this.audioA : this.audioB).currentTime + (event.seekOffset || 10));
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      this.emit('previoustrack');
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      this.emit('nexttrack');
    });
  }

  private updateMediaSessionMetadata(track: SongResult) {
    try {
      if (!('mediaSession' in navigator)) return;

      const artists = track.ar
        ? track.ar.map((a) => a.name)
        : track.song?.artists?.map((a) => a.name);
      const album = track.al ? track.al.name : track.song?.album?.name;
      const artwork = ['96', '128', '192', '256', '384', '512'].map((size) => ({
        src: `${track.picUrl}?param=${size}y${size}`,
        type: 'image/jpg',
        sizes: `${size}x${size}`
      }));

      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.name || '',
        artist: artists ? artists.join(',') : '',
        album: album || '',
        artwork
      });
    } catch (error) {
      console.error('更新媒体会话元数据时出错:', error);
    }
  }

  private updateMediaSessionState(isPlaying: boolean) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    this.updateMediaSessionPositionState();
  }

  private updateMediaSessionPositionState() {
    try {
      if (!('mediaSession' in navigator)) return;
      const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
      if (!currentAudio.duration || !isFinite(currentAudio.duration)) return;

      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: currentAudio.duration,
          playbackRate: this.playbackRate,
          position: currentAudio.currentTime
        });
      }
    } catch (error) {
      console.error('更新媒体会话位置状态时出错:', error);
    }
  }

  private emit(event: string, ...args: any[]) {
    const eventCallbacks = this.callbacks[event];
    if (eventCallbacks) {
      eventCallbacks.forEach((callback) => callback(...args));
    }
  }

  on(event: string, callback: Function) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
  }

  off(event: string, callback: Function) {
    const eventCallbacks = this.callbacks[event];
    if (eventCallbacks) {
      this.callbacks[event] = eventCallbacks.filter((cb) => cb !== callback);
    }
  }

  clearAllListeners() {
    this.callbacks = {};
  }

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

  public isEQEnabled(): boolean {
    return !this.bypass;
  }

  public setEQEnabled(enabled: boolean) {
    this.bypass = !enabled;
    localStorage.setItem('eqBypass', JSON.stringify(this.bypass));

    if (this.sourceNodeA && this.gainNodeA && this.context) {
      this.applyBypassState();
    }
  }

  public setEQFrequencyGain(frequency: string, gain: number) {
    const filterIndex = this.frequencies.findIndex((f) => f.toString() === frequency);
    if (filterIndex !== -1 && this.filters[filterIndex]) {
      this.filters[filterIndex].gain.setValueAtTime(gain, this.context?.currentTime || 0);
      this.saveEQSettings(frequency, gain);
    }
  }

  public resetEQ() {
    this.filters.forEach((filter) => {
      filter.gain.setValueAtTime(0, this.context?.currentTime || 0);
    });
    localStorage.removeItem('eqSettings');
  }

  public getAllEQSettings(): { [key: string]: number } {
    return this.loadEQSettings();
  }

  public getCurrentPreset(): string | null {
    return localStorage.getItem('currentPreset');
  }

  public setCurrentPreset(preset: string): void {
    localStorage.setItem('currentPreset', preset);
  }

  private saveEQSettings(frequency: string, gain: number) {
    const settings = this.loadEQSettings();
    settings[frequency] = gain;
    localStorage.setItem('eqSettings', JSON.stringify(settings));
  }

  private loadEQSettings(): { [key: string]: number } {
    const savedSettings = localStorage.getItem('eqSettings');
    return savedSettings ? JSON.parse(savedSettings) : { ...this.defaultEQSettings };
  }

  private setOperationLock(): boolean {
    if (this.operationLock) {
      return false;
    }
    this.operationLock = true;

    if (this.operationLockTimer) clearTimeout(this.operationLockTimer);
    this.operationLockTimer = setTimeout(() => {
      this.releaseOperationLock();
    }, 5000);

    return true;
  }

  public releaseOperationLock(): void {
    this.operationLock = false;
    if (this.operationLockTimer) {
      clearTimeout(this.operationLockTimer);
      this.operationLockTimer = null;
    }
  }

  public forceResetOperationLock(): void {
    this.operationLock = false;
    if (this.operationLockTimer) {
      clearTimeout(this.operationLockTimer);
      this.operationLockTimer = null;
    }
  }

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
            
            if (!activeAudioElement.paused && activeAudioElement.src && this.context && activeGainNode && nextGainNode) {
               this.isCrossfading = true;
               const savedVolume = parseFloat(localStorage.getItem('volume') || '1');
               const currTime = this.context.currentTime;
               
               nextGainNode.gain.cancelScheduledValues(currTime);
               nextGainNode.gain.setValueAtTime(0, currTime);
               nextGainNode.gain.linearRampToValueAtTime(savedVolume, currTime + this.fadeDuration);
               
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

  public pause() {
    this.forceResetOperationLock();
    try {
      (this.activePlayer === 'A' ? this.audioA : this.audioB).pause();
    } catch (error) {
      console.error('暂停音频失败:', error);
    }
  }

  public stop() {
    this.forceResetOperationLock();
    try {
      const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
      currentAudio.pause();
      currentAudio.removeAttribute('src');
      currentAudio.load();
    } catch (error) {
      console.error('停止音频失败:', error);
    }
    this.currentTrack = null;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
  }

  public seek(time: number) {
    this.forceResetOperationLock();
    try {
      this.emit('seek_start', time);
      const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
      currentAudio.currentTime = Math.max(0, time);
      this.updateMediaSessionPositionState();
    } catch (error) {
      console.error('Seek操作失败:', error);
    }
  }

  public setVolume(volume: number) {
    this.applyVolume(volume);
  }

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

  public setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    (this.activePlayer === 'A' ? this.audioA : this.audioB).playbackRate = rate;
    this.updateMediaSessionPositionState();
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  getCurrentSound(): HTMLAudioElement | null {
    const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
    return currentAudio.src ? currentAudio : null;
  }

  getCurrentTrack(): SongResult | null {
    return this.currentTrack;
  }

  isLoading(): boolean {
    return this._isLoading || this.operationLock;
  }

  isActuallyPlaying(): boolean {
    const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
    if (!currentAudio.src) return false;
    try {
      const isPlaying = !currentAudio.paused && !currentAudio.ended;
      const contextOk = !this.context || this.context.state === 'running';
      return isPlaying && !this._isLoading && contextOk;
    } catch (error) {
      console.error('检查播放状态出错:', error);
      return false;
    }
  }

  public async getAudioOutputDevices(): Promise<AudioOutputDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');

      return audioOutputs.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Speaker ${index + 1}`,
        isDefault: device.deviceId === 'default' || device.deviceId === ''
      }));
    } catch (error) {
      console.error('枚举音频设备失败:', error);
      return [{ deviceId: 'default', label: 'Default', isDefault: true }];
    }
  }

  public async setAudioOutputDevice(deviceId: string): Promise<boolean> {
    try {
      if (this.context && typeof (this.context as any).setSinkId === 'function') {
        await (this.context as any).setSinkId(deviceId);
        this.currentSinkId = deviceId;
        localStorage.setItem('audioOutputDeviceId', deviceId);
        console.log('音频输出设备已切换:', deviceId);
        return true;
      } else {
        console.warn('AudioContext.setSinkId 不可用');
        return false;
      }
    } catch (error) {
      console.error('设置音频输出设备失败:', error);
      return false;
    }
  }

  public getCurrentSinkId(): string {
    return this.currentSinkId;
  }

  private async restoreSavedAudioDevice(): Promise<void> {
    const savedDeviceId = localStorage.getItem('audioOutputDeviceId');
    if (savedDeviceId && savedDeviceId !== 'default') {
      try {
        await this.setAudioOutputDevice(savedDeviceId);
      } catch (error) {
        console.warn('恢复音频输出设备失败，回退到默认设备:', error);
        localStorage.removeItem('audioOutputDeviceId');
        this.currentSinkId = 'default';
      }
    }
  }

  private setupContextStateMonitoring() {
    if (!this.context) return;

    this.context.addEventListener('statechange', async () => {
      console.log('AudioContext state changed:', this.context?.state);
      const currentAudio = this.activePlayer === 'A' ? this.audioA : this.audioB;
      if (this.context?.state === 'suspended' && !currentAudio.paused) {
        try {
          await this.context.resume();
        } catch (e) {
          console.error('Failed to resume AudioContext:', e);
          this.emit('audio_error', { type: 'context_suspended', error: e });
        }
      } else if (this.context?.state === 'closed') {
        console.warn('AudioContext was closed unexpectedly');
        this.emit('audio_error', { type: 'context_closed' });
      }
    });
  }
}

export const audioService = new AudioService();
