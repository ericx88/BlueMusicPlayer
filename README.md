<h1 align="center">🎵 BlueMusicPlayer (露营风清吧定制版)</h1>
<div align="center">
  <p><strong>基于 Tauri 2.0 重构的高性能、沉浸式、无人值守音乐播放器</strong></p>
  <img src="https://img.shields.io/badge/Tauri-2.0-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue">
  <img src="https://img.shields.io/badge/Rust-1.70+-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust">
</div>

## 📌 项目背景与简介

本项目在开源软件 **AlgerMusicPlayer** 的基础上进行了深度的二次开发与架构迁移，专为“**露营风清吧**”等实体商业场景打造。

原版 Electron 架构虽然功能丰富，但在长时间运行和特定的场景需求上略有不足。我们将其核心引擎**彻底迁移到了 Rust (Tauri 2.0)**，大幅降低了内存占用和包体积，并针对清吧无人值守的背景音乐播放需求，定制了**定时自动切歌单**、**无缝交叉混音**和**全屏沉浸式 UI**。

---

## ✨ 核心特性升级

### 🚀 1. Tauri 极致轻量化架构
- **剥离 Electron**：全面采用 Rust 作为后端，摒弃了 Chromium + Node.js 的庞大体积。
- **独立 API Sidecar**：将原本的网易云 API 抽离为独立的二进制可执行文件，通过 Tauri 的 Sidecar 机制在后台静默运行，保证了原有音源解析的完整性，同时实现主进程性能最优。

### 🕒 2. 智能定时播放调度 (Rust 驱动)
- 清吧需要“早晚播放不同风格音乐”的功能。我们在 Rust 后端植入了毫秒级的守护线程，监听并解析 `playlist-schedule.json`。
- 设定好时间后，系统会自动在后台规划下一个播放队列，等当前曲目**完整播放完毕后**，平滑切入新歌单，完全无需人工干预。

### 🎛️ 3. Web Audio 无缝混音引擎 (Crossfade)
- 彻底抛弃简单的 `<audio>` 标签，基于 **Web Audio API** 打造了定制的 A/B 双播放器引擎。
- 在当前歌曲距离结束还有 **3 秒** 时，下一首歌曲会提前加载并执行优雅的 **线性交叉淡入淡出（Crossfade）**，杜绝两首歌曲之间的静音断档，打造专业电台般的连贯听感。

### 🏕️ 4. 露营风全屏沉浸播放模式
- 在主界面右下方一键进入**全屏沉浸模式（Immersive Mode）**。
- **智能动态背景**：自动提取专辑封面主色调，渲染发散式径向渐变背景。
- **60帧双行歌词**：抛弃繁杂的滚动列表，改为巨大的双行显示。采用 `requestAnimationFrame` 配合纯 CSS 进行硬件加速渲染，实现极致丝滑的**逐字高亮**。
- 自动隐藏鼠标与控件，不留任何视觉死角，最适合投屏至大电视或投影仪。

---

## 💻 本地运行与开发

由于切换到了 Tauri，开发环境需要 Node.js 与 Rust。

### 1. 环境准备
- [Node.js](https://nodejs.org/zh-cn/) (推荐 v18+)
- [Rust 工具链](https://rustup.rs/) (用于 Tauri 后端编译)

### 2. 启动项目

```bash
# 安装前端与 API 依赖
npm install

# 本地调试运行 (会自动拉起前端和 Rust 窗口)
npm run tauri dev
```

### 3. 项目打包

#### Windows 用户
如果您在 Windows 下开发，可直接执行：
```bash
# 全局安装打包工具，打包 Sidecar
npm install -g pkg
mkdir -p src-tauri/bin
pkg scripts/api-sidecar.js --targets node18-win-x64 --output src-tauri/bin/api-sidecar-x86_64-pc-windows-msvc.exe

# 执行 Tauri 打包
npm run tauri build
```
打包输出路径位于：`src-tauri/target/release/bundle/`

#### 自动化云端打包 (GitHub Actions)
本项目已配置了完整的 GitHub Actions 工作流。您只需：
1. `git push` 最新代码。
2. 推送一个版本 tag：`git tag v1.0.0 && git push origin v1.0.0`
3. GitHub 服务器会自动在云端编译出 `.exe` 和 `.msi` 格式的 Windows 安装包。

---

## 👏 致谢

本项目是在 [**AlgerMusicPlayer**](https://github.com/algerkong/AlgerMusicPlayer) 的优秀开源基础上迁移定制的。
- 感谢 **Alger** 提供的极佳 Vue3 + Pinia 前端基础和完善的 API 封装。
- 感谢 **@unblockneteasemusic/server** 提供的音乐资源支持。

## ⚠️ 声明

本项目仅供学习与技术交流，切勿用于商业盈利用途，请支持官方正版音乐服务。
