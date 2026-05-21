const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const match = require('@unblockneteasemusic/server').default || require('@unblockneteasemusic/server');

// Ensure anonymous_token exists for Netease API
if (!fs.existsSync(path.resolve(os.tmpdir(), 'anonymous_token'))) {
  fs.writeFileSync(path.resolve(os.tmpdir(), 'anonymous_token'), '', 'utf-8');
}

const ALL_PLATFORMS = ['migu', 'kugou', 'kuwo', 'pyncmd'];

function ensureDataStructure(data) {
  if (!data) return { name: '', artists: [], album: { name: '' } };
  if (data.name === undefined || data.name === null) data.name = '';
  if (!data.artists || !Array.isArray(data.artists)) data.artists = data.ar && Array.isArray(data.ar) ? data.ar : [];
  if (data.artists.length > 0) {
    data.artists = data.artists.map(artist => artist ? { name: artist.name || '' } : { name: '' });
  }
  if (!data.album || typeof data.album !== 'object') {
    data.album = data.al && typeof data.al === 'object' ? data.al : { name: '' };
  }
  if (!data.album.name) data.album.name = '';
  return data;
}

const app = express();
app.use(express.json());

// Unblock music endpoint
app.post('/unblock-music', async (req, res) => {
  try {
    const { id, songData, enabledSources } = req.body;
    const filteredPlatforms = enabledSources
      ? enabledSources.filter(p => ALL_PLATFORMS.includes(p))
      : ALL_PLATFORMS;
    const processedSongData = ensureDataStructure(songData);
    
    const data = await match(parseInt(String(id), 10), filteredPlatforms, processedSongData);
    res.json({
      data: {
        data,
        params: { id: parseInt(String(id), 10), type: 'song' }
      }
    });
  } catch (error) {
    console.error('Unblock music failed:', error);
    res.status(500).json({ error: error.message || 'Unknown error' });
  }
});

// Start unblock API server
const UNBLOCK_PORT = 30489;
app.listen(UNBLOCK_PORT, '127.0.0.1', () => {
  console.log(`Unblock API started on port ${UNBLOCK_PORT}`);
});

// Start Netease API
const port = 30488;
try {
  const server = require('netease-cloud-music-api-alger/server');
  server.serveNcmApi({
    port,
    host: '127.0.0.1'
  }).then(() => {
    console.log(`MUSIC API STARTED on port ${port}`);
  });
} catch (error) {
  console.error(`MUSIC API failed to start:`, error);
}
