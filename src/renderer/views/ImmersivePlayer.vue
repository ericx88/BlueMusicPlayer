<template>
  <div
    class="immersive-player-container"
    :style="backgroundStyle"
    @mousemove="handleMouseMove"
    @click="toggleControls"
  >
    <!-- Background overlay for better text readability -->
    <div class="background-overlay"></div>

    <div class="main-content">
      <!-- Album Art -->
      <div class="album-container" :class="{ 'is-playing': isPlaying }">
        <img
          :src="albumCover"
          class="album-art"
          alt="Album Cover"
          v-if="albumCover"
          crossorigin="anonymous"
          ref="imgRef"
        />
        <div v-else class="album-placeholder"></div>
      </div>

      <!-- Dual Line Lyrics -->
      <div class="lyrics-container">
        <div class="lyric-line previous-line" :class="{ active: false }">
          {{ previousLyric }}
        </div>
        <div class="lyric-line current-line active" ref="currentLineRef">
          <template v-if="currentLyricObj?.hasWordByWord && currentLyricObj?.words">
            <span
              v-for="(word, index) in currentLyricObj.words"
              :key="index"
              class="lyric-word"
              :style="getWordStyle(word)"
            >
              {{ word.text }}<span v-if="word.space">&nbsp;</span>
            </span>
          </template>
          <template v-else>
            {{ currentLyric || t('player.noLyric') }}
          </template>
        </div>
        <div class="lyric-line next-line" :class="{ active: false }">
          {{ nextLyric }}
        </div>
      </div>
    </div>

    <!-- Auto-hiding Controls -->
    <transition name="fade">
      <div
        class="controls-container"
        v-show="controlsVisible"
        @click.stop
      >
        <div class="song-info">
          <div class="song-name">{{ playMusic?.name }}</div>
          <div class="song-artist">{{ artistName }}</div>
        </div>

        <div class="progress-bar-container" @click="seek">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPercentage + '%' }"></div>
          </div>
          <div class="time-display">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>

        <div class="playback-controls">
          <button class="control-btn" @click="prev">
            <i class="ri-skip-back-fill"></i>
          </button>
          <button class="control-btn play-btn" @click="togglePlay">
            <i :class="isPlaying ? 'ri-pause-fill' : 'ri-play-fill'"></i>
          </button>
          <button class="control-btn" @click="next">
            <i class="ri-skip-forward-fill"></i>
          </button>
          
          <!-- Exit Immersive Mode Button -->
          <button class="control-btn exit-btn" @click="exitImmersive" title="Exit Immersive Mode">
            <i class="ri-fullscreen-exit-fill"></i>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import {
  correctionTime,
  lrcArray,
  nowIndex,
  nowTime,
  playMusic
} from '@/hooks/MusicHook';
import { usePlayerStore } from '@/store/modules/player';
import { audioService } from '@/services/audioService';

const { t } = useI18n();
const router = useRouter();
const playerStore = usePlayerStore();

const controlsVisible = ref(true);
const hideControlsTimeout = ref<number | null>(null);
const dominantColor = ref('rgb(20, 20, 20)');
const imgRef = ref<HTMLImageElement | null>(null);

const isPlaying = computed(() => playerStore.play);
const albumCover = computed(() => playMusic.value?.picUrl ? `${playMusic.value.picUrl}?param=500y500` : '');
const artistName = computed(() => {
  const artists = playMusic.value?.ar || playMusic.value?.song?.artists;
  return artists ? artists.map(a => a.name).join(' / ') : '';
});

// Lyrics logic
const currentLyricObj = computed(() => lrcArray.value[nowIndex.value]);
const currentLyric = computed(() => currentLyricObj.value?.text || '');
const previousLyric = computed(() => nowIndex.value > 0 ? lrcArray.value[nowIndex.value - 1]?.text : '');
const nextLyric = computed(() => nowIndex.value < lrcArray.value.length - 1 ? lrcArray.value[nowIndex.value + 1]?.text : '');

// Progress and Time
const currentTime = computed(() => nowTime.value);
const duration = computed(() => {
  const sound = audioService.getCurrentSound();
  return sound ? sound.duration : 0;
});
const progressPercentage = computed(() => {
  if (!duration.value) return 0;
  return (currentTime.value / duration.value) * 100;
});

const formatTime = (time: number) => {
  if (!time || isNaN(time)) return '00:00';
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// Word-by-word highlighting using requestAnimationFrame for smoothness
const currentRafTime = ref(0);
let rafId: number;

const updateRafTime = () => {
  const sound = audioService.getCurrentSound();
  if (sound && !sound.paused) {
    currentRafTime.value = sound.currentTime;
  }
  rafId = requestAnimationFrame(updateRafTime);
};

onMounted(() => {
  rafId = requestAnimationFrame(updateRafTime);
  resetControlsTimeout();
  document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  if (hideControlsTimeout.value) clearTimeout(hideControlsTimeout.value);
  document.removeEventListener('keydown', handleKeyDown);
});

const getWordStyle = (word: any) => {
  // Use RAF time for maximum smoothness, fallback to store time
  const time = (currentRafTime.value || nowTime.value) + correctionTime.value;
  const currentTimeMs = time * 1000;
  const wordStartTime = word.startTime;
  const wordEndTime = word.startTime + word.duration;

  if (currentTimeMs >= wordStartTime && currentTimeMs < wordEndTime) {
    const progress = Math.min((currentTimeMs - wordStartTime) / word.duration, 1);
    const progressPercent = Math.round(progress * 100);
    return {
      backgroundImage: `linear-gradient(to right, #ffffff 0%, #ffffff ${progressPercent}%, rgba(255, 255, 255, 0.4) ${progressPercent}%, rgba(255, 255, 255, 0.4) 100%)`,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      textShadow: '0 0 10px rgba(255,255,255,0.3)'
    };
  } else if (currentTimeMs >= wordEndTime) {
    return {
      color: '#ffffff',
      WebkitTextFillColor: 'initial'
    };
  } else {
    return {
      color: 'rgba(255, 255, 255, 0.4)',
      WebkitTextFillColor: 'initial'
    };
  }
};

// Controls visibility
const handleMouseMove = () => {
  controlsVisible.value = true;
  resetControlsTimeout();
};

const toggleControls = () => {
  controlsVisible.value = !controlsVisible.value;
  if (controlsVisible.value) {
    resetControlsTimeout();
  }
};

const resetControlsTimeout = () => {
  if (hideControlsTimeout.value) clearTimeout(hideControlsTimeout.value);
  hideControlsTimeout.value = window.setTimeout(() => {
    controlsVisible.value = false;
  }, 3000);
};

// Playback actions
const togglePlay = () => {
  if (isPlaying.value) {
    audioService.pause();
  } else {
    const sound = audioService.getCurrentSound();
    if (sound) sound.play();
  }
};

const prev = () => playerStore.prevPlay();
const next = () => playerStore.nextPlay();
const seek = (e: MouseEvent) => {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  if (duration.value) {
    audioService.seek(percent * duration.value);
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.code === 'Space') {
    togglePlay();
    e.preventDefault();
  } else if (e.code === 'Escape') {
    exitImmersive();
  }
};

// Background
const backgroundStyle = computed(() => {
  const bgColor = playMusic.value?.backgroundColor || dominantColor.value;
  return {
    background: `radial-gradient(circle at 50% 50%, ${bgColor} 0%, #000000 100%)`
  };
});

const exitImmersive = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  router.push('/');
};
</script>

<style scoped lang="scss">
.immersive-player-container {
  width: 100vw;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  color: white;
  overflow: hidden;
  transition: background 1s ease-in-out;
  font-family: var(--current-font-family, system-ui, sans-serif);
}

.background-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 2;
  padding: 40px;
}

.album-container {
  width: 40vh;
  height: 40vh;
  max-width: 400px;
  max-height: 400px;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  margin-bottom: 60px;
  transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  
  &.is-playing {
    transform: scale(1.02);
  }
}

.album-art {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.album-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #2a2a2a, #1a1a1a);
}

.lyrics-container {
  text-align: center;
  width: 100%;
  max-width: 1200px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.lyric-line {
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1.4;
  opacity: 0.4;
  transition: all 0.5s ease;
  min-height: 4rem;
  
  &.active {
    opacity: 1;
    font-size: 3.5rem;
    transform: scale(1.05);
  }
}

.lyric-word {
  display: inline-block;
  white-space: pre-wrap;
}

.controls-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 40px 60px;
  background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%);
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

.song-info {
  text-align: center;
}

.song-name {
  font-size: 2rem;
  font-weight: bold;
  margin-bottom: 5px;
}

.song-artist {
  font-size: 1.2rem;
  opacity: 0.7;
}

.progress-bar-container {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  cursor: pointer;
}

.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: #ffffff;
  border-radius: 3px;
  transition: width 0.1s linear;
}

.time-display {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  opacity: 0.7;
}

.playback-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 40px;
  margin-top: 10px;
  position: relative;
}

.control-btn {
  background: none;
  border: none;
  color: white;
  font-size: 2rem;
  cursor: pointer;
  opacity: 0.8;
  transition: all 0.2s;
  
  &:hover {
    opacity: 1;
    transform: scale(1.1);
  }
}

.play-btn {
  font-size: 3.5rem;
}

.exit-btn {
  position: absolute;
  right: 0;
  font-size: 1.5rem;
}
</style>
