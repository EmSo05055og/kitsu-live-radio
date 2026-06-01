const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

let connectedListeners = new Set();
let playlistHistory = [];
const HISTORY_LENGTH = 4;

// Cache für echte Song-Dauern (vom Client gesendet)
const songDurations = {};

// Musik-Ordner definieren
const MUSIC_DIR = path.join(__dirname, 'music');
const SFW_DIR = path.join(MUSIC_DIR, 'SFW');
const ADS_DIR = path.join(MUSIC_DIR, 'ads');

// Alle verfügbaren Songs laden
function getAllSongs() {
  if (!fs.existsSync(SFW_DIR)) {
    fs.mkdirSync(SFW_DIR, { recursive: true });
    return [];
  }

  try {
    const folders = fs.readdirSync(SFW_DIR).filter(file => {
      return fs.statSync(path.join(SFW_DIR, file)).isDirectory();
    });

    return folders.filter(folder => {
      const folderPath = path.join(SFW_DIR, folder);
      const iconPath = path.join(folderPath, 'icon.png');
      const bannerPath = path.join(folderPath, 'banner.png');

      let mp3Path = null;
      try {
        const files = fs.readdirSync(folderPath);
        const mp3File = files.find(file => file.toLowerCase().endsWith('.mp3'));
        if (mp3File) {
          mp3Path = path.join(folderPath, mp3File);
        }
      } catch (err) {
        return false;
      }

      const mp3Exists = mp3Path && fs.existsSync(mp3Path);
      const iconExists = fs.existsSync(iconPath);
      const bannerExists = fs.existsSync(bannerPath);

      return mp3Exists && iconExists && bannerExists;
    });
  } catch (error) {
    console.error('Error reading SFW_DIR:', error);
    return [];
  }
}

// Alle Ads laden
function getAllAds() {
  if (!fs.existsSync(ADS_DIR)) {
    fs.mkdirSync(ADS_DIR, { recursive: true });
    return [];
  }

  try {
    const folders = fs.readdirSync(ADS_DIR).filter(file => {
      return fs.statSync(path.join(ADS_DIR, file)).isDirectory();
    });

    return folders.filter(folder => {
      const folderPath = path.join(ADS_DIR, folder);
      const iconPath = path.join(folderPath, 'icon.png');
      const bannerPath = path.join(folderPath, 'banner.png');

      let mp3Path = null;
      try {
        const files = fs.readdirSync(folderPath);
        const mp3File = files.find(file => file.toLowerCase().endsWith('.mp3'));
        if (mp3File) {
          mp3Path = path.join(folderPath, mp3File);
        }
      } catch (err) {
        return false;
      }

      const mp3Exists = mp3Path && fs.existsSync(mp3Path);
      const iconExists = fs.existsSync(iconPath);
      const bannerExists = fs.existsSync(bannerPath);

      return mp3Exists && iconExists && bannerExists;
    });
  } catch (error) {
    console.error('Error reading ADS_DIR:', error);
    return [];
  }
}

// Song-Metadaten laden (Dauer aus Cache oder Schätzung)
function getSongMetadata(songName, isAd = false) {
  const dir = isAd ? ADS_DIR : SFW_DIR;
  const songPath = path.join(dir, songName);

  let mp3Path = null;
  try {
    const files = fs.readdirSync(songPath);
    const mp3File = files.find(file => file.toLowerCase().endsWith('.mp3'));
    if (mp3File) {
      mp3Path = path.join(songPath, mp3File);
    }
  } catch (err) {
    return null;
  }

  if (!mp3Path || !fs.existsSync(mp3Path)) {
    return null;
  }

  try {
    const stats = fs.statSync(mp3Path);
    
    // Versuche Dauer aus Cache zu bekommen (vom Client gesendet)
    const cacheKey = `${isAd ? 'ads' : 'sfw'}_${songName}`;
    let duration = songDurations[cacheKey];
    
    // Fallback: Schätze basierend auf Dateigröße
    if (!duration) {
      duration = Math.ceil((stats.size / 16000) * 1.05);
      duration = Math.max(duration, 10);
    }

    return {
      name: songName,
      duration: duration,
      isAd: isAd
    };
  } catch (error) {
    console.error('Error getting metadata:', error);
    return {
      name: songName,
      duration: 180,
      isAd: isAd
    };
  }
}

let radioStartTime = Date.now();
let currentPlaylist = [];

function initializePlaylist() {
  const allSongs = getAllSongs();
  if (allSongs.length === 0) return;

  currentPlaylist = [];
  let tempSongs = [...allSongs];

  for (let i = 0; i < 100; i++) {
    if (tempSongs.length === 0) tempSongs = [...allSongs];
    
    const randomIndex = Math.floor(Math.random() * tempSongs.length);
    const song = tempSongs[randomIndex];
    
    tempSongs.splice(randomIndex, 1);
    currentPlaylist.push({ name: song, isAd: false });

    if ((i + 1) % 5 === 0) {
      const ads = getAllAds();
      if (ads.length > 0) {
        const randomAd = ads[Math.floor(Math.random() * ads.length)];
        currentPlaylist.push({ name: randomAd, isAd: true });
      }
    }
  }
}

function getCurrentSongInfo() {
  if (currentPlaylist.length === 0) {
    initializePlaylist();
  }

  const elapsedTime = Date.now() - radioStartTime;
  let currentTime = 0;
  let index = 0;

  for (let i = 0; i < currentPlaylist.length; i++) {
    const songInfo = getSongMetadata(currentPlaylist[i].name, currentPlaylist[i].isAd);
    if (!songInfo) continue;

    const songDuration = songInfo.duration * 1000;

    if (currentTime + songDuration > elapsedTime) {
      index = i;
      break;
    }
    currentTime += songDuration;
  }

  const songInfo = getSongMetadata(currentPlaylist[index].name, currentPlaylist[index].isAd);
  const songStartTime = currentTime;
  const timeIntoSong = (elapsedTime - songStartTime) / 1000;

  return {
    ...songInfo,
    playlistIndex: index,
    songStartTime: songStartTime,
    timeIntoSong: Math.max(0, timeIntoSong),
    listeners: connectedListeners.size,
    serverTime: Date.now(),
    radioStartTime: radioStartTime
  };
}

app.use(express.static('.'));
app.use(express.json());

app.get('/api/current-song', (req, res) => {
  const songInfo = getCurrentSongInfo();
  res.json(songInfo);
});

app.get('/api/next-songs', (req, res) => {
  if (currentPlaylist.length === 0) {
    initializePlaylist();
  }

  const songInfo = getCurrentSongInfo();
  const currentIndex = songInfo.playlistIndex;

  const nextSongs = [];
  for (let i = 1; i <= 3 && currentIndex + i < currentPlaylist.length; i++) {
    const song = currentPlaylist[currentIndex + i];
    const metadata = getSongMetadata(song.name, song.isAd);
    if (metadata) {
      nextSongs.push(metadata);
    }
  }

  res.json(nextSongs);
});

app.post('/api/listener-join', (req, res) => {
  const listenerId = req.body.id || Math.random().toString(36).substr(2, 9);
  connectedListeners.add(listenerId);
  res.json({ id: listenerId, listeners: connectedListeners.size });
});

app.post('/api/listener-leave', (req, res) => {
  const listenerId = req.body.id;
  connectedListeners.delete(listenerId);
  res.json({ listeners: connectedListeners.size });
});

app.get('/api/listeners', (req, res) => {
  res.json({ listeners: connectedListeners.size });
});

// Client sendet echte Dauer hierher
app.post('/api/update-duration', (req, res) => {
  const { songName, isAd, duration } = req.body;
  const cacheKey = `${isAd ? 'ads' : 'sfw'}_${songName}`;
  
  if (duration && duration > 0) {
    songDurations[cacheKey] = Math.ceil(duration);
    console.log(`⏱️  Dauer: ${songName} = ${Math.ceil(duration)}s`);
  }
  
  res.json({ success: true });
});

// Song abspielen
app.get('/music/:type/:songName/mp3', (req, res) => {
  const { type, songName } = req.params;
  const dir = type === 'ads' ? ADS_DIR : SFW_DIR;
  const songPath = path.join(dir, songName);

  let mp3FilePath = null;
  try {
    const files = fs.readdirSync(songPath);
    const mp3File = files.find(file => file.toLowerCase().endsWith('.mp3'));
    if (mp3File) {
      mp3FilePath = path.join(songPath, mp3File);
    }
  } catch (err) {
    return res.status(404).send('Not found');
  }

  if (!mp3FilePath || !fs.existsSync(mp3FilePath)) {
    return res.status(404).send('Not found');
  }

  const stat = fs.statSync(mp3FilePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mpeg'
    });
    fs.createReadStream(mp3FilePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg'
    });
    fs.createReadStream(mp3FilePath).pipe(res);
  }
});

app.get('/music/:type/:songName/icon.png', (req, res) => {
  const { type, songName } = req.params;
  const dir = type === 'ads' ? ADS_DIR : SFW_DIR;
  const filePath = path.join(dir, songName, 'icon.png');
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  
  res.sendFile(filePath);
});

app.get('/music/:type/:songName/banner.png', (req, res) => {
  const { type, songName } = req.params;
  const dir = type === 'ads' ? ADS_DIR : SFW_DIR;
  const filePath = path.join(dir, songName, 'banner.png');
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  
  res.sendFile(filePath);
});

const PORT = process.env.PORT || 3000;

initializePlaylist();

app.listen(PORT, () => {
  console.log(`🎵 Radio läuft auf http://localhost:${PORT}`);
  console.log(`📁 Musik-Ordner: ${MUSIC_DIR}`);
});
