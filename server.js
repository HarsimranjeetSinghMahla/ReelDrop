const express = require('express');
const cors    = require('cors');
const { spawn } = require('child_process');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_, res) => res.json({ ok: true }));

// Base yt-dlp args — no cookies, mobile UA so Instagram serves public content
function baseArgs() {
  return [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-retries', '3',
    '--retries', '3',
    '--socket-timeout', '30',
    // Mobile UA — Instagram serves public reels without login to mobile clients
    '--add-header', 'User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  ];
}

// GET INFO
app.post('/api/info', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const safeUrl = url.replace(/["`$\\]/g, '');

  const args = [
  '--dump-json',
  '--no-playlist',
  safeUrl
];
  const proc = spawn('yt-dlp', args);
  let stdout = '', stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', code => {
    if (code !== 0) {
      console.error('[info error]', stderr.slice(0, 500));
      return res.status(400).json({ error: cleanError(stderr) });
    }
    try {
      const info = JSON.parse(stdout.trim().split('\n')[0]);
      res.json({
        title:     info.title     || 'Video',
        thumbnail: info.thumbnail || null,
        duration:  formatDur(info.duration),
        uploader:  info.uploader  || info.channel || null,
        platform:  info.extractor_key || 'Unknown',
        formats:   buildFormats(info.formats || []),
      });
    } catch { res.status(500).json({ error: 'Could not parse video info' }); }
  });
});

// DOWNLOAD
app.get('/api/download', (req, res) => {
  const { url, quality, format } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const safeUrl = decodeURIComponent(url).replace(/["`$\\]/g, '');
  const ts      = Date.now();
  const tmpBase = path.join(os.tmpdir(), `reeldrop_${ts}`);
  const tmpTmpl = tmpBase + '.%(ext)s';

  const args = [...baseArgs(), '-o', tmpTmpl];

if (format === 'mp3') {
  args.push(
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0'
  );
} else {
  args.push(
    '-f',
    'best'
  );
}



args.push(safeUrl);

  console.log('[yt-dlp]', args.filter(a => !a.startsWith('Mozilla')).join(' '));
  console.log('\n===== DOWNLOAD DEBUG =====');
console.log('URL:', safeUrl);
console.log('FORMAT:', format);
console.log('QUALITY:', quality);
console.log('ARGS:', JSON.stringify(args, null, 2));
console.log('==========================\n');
  const dl = spawn('yt-dlp', args);
  let errOut = '';
  dl.stderr.on('data', d => { errOut += d.toString(); });
  dl.stdout.on('data', d => process.stdout.write(d));

  dl.on('close', code => {
    if (code !== 0) {
      console.error('[dl error]', errOut.slice(0, 500));
      return res.status(400).json({ error: cleanError(errOut) });
    }

    const ext  = format === 'mp3' ? 'mp3' : 'mp4';
    let actual = tmpBase + '.' + ext;
    if (!fs.existsSync(actual)) {
      const found = fs.readdirSync(os.tmpdir()).find(f => f.startsWith(`reeldrop_${ts}`));
      if (found) actual = path.join(os.tmpdir(), found);
      else return res.status(500).json({ error: 'Output file not found on server' });
    }

    const fname = format === 'mp3' ? 'reeldrop_audio.mp3' : 'reeldrop_video.mp4';
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    const stream = fs.createReadStream(actual);
    stream.pipe(res);
    stream.on('end',   () => fs.unlink(actual, () => {}));
    stream.on('error', () => res.status(500).end());
  });
});

function buildFormats(formats) {
  return [...new Set(
    formats.filter(f => f.height && f.vcodec !== 'none').map(f => f.height).sort((a,b) => b-a)
  )].slice(0, 5);
}
function formatDur(s) {
  if (!s) return null;
  const m = Math.floor(s/60), sec = s%60;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function cleanError(msg) {
  // if (msg.includes('Private'))                    return 'This video is private.';
  // if (msg.includes('not available'))              return 'Video not available in your region.';
  // if (msg.includes('Login required') ||
  //     msg.includes('login required') ||
  //     msg.includes('checkpoint'))                 return 'This reel requires an Instagram login. Only public reels work without an account.';
  // if (msg.includes('Unsupported URL'))            return 'URL not supported. Paste a direct reel link (instagram.com/reel/...).';
  // if (msg.includes('Unable to extract') ||
  //     msg.includes('No video formats'))           return 'Could not extract video. The reel may be deleted or private.';
  // if (msg.includes('HTTP Error 401') ||
  //     msg.includes('HTTP Error 403'))             return 'Instagram blocked the request. Try again in a few minutes.';
  // if (msg.includes('ffmpeg') ||
  //     msg.includes('ffprobe'))                    return 'ffmpeg not found. Install it with: brew install ffmpeg';
  // if (msg.includes('404'))                        return 'Video not found (404). Check the URL.';
  // return 'Could not process this URL. Make sure it\'s a public reel and the link is correct.';
  return msg;
}

app.listen(PORT, () => console.log(`\n🎬 ReelDrop → http://localhost:${PORT}\n`));
