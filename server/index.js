const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeChannel } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for frontend
app.use(cors());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..')));

// ── In-memory cache ──────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ── SSE: Real-time new post detection ────────────────────────────────
const sseClients = new Set();
const knownPostIds = new Map();       // channel -> Set of post IDs
const watchedChannels = new Set();    // channels currently being watched
const POLL_INTERVAL = 30 * 1000;      // poll every 30 seconds
let pollTimer = null;

/**
 * GET /api/stream?channels=ch1,ch2,ch3
 * Server-Sent Events endpoint — pushes new posts in real-time.
 */
app.get('/api/stream', (req, res) => {
  const channelsParam = (req.query.channels || '').trim();
  const channels = channelsParam.split(',').map(c => c.trim()).filter(Boolean);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: 'connected', channels })}\n\n`);

  // Register client
  const client = { res, channels };
  sseClients.add(client);

  // Add channels to watch list
  for (const ch of channels) {
    watchedChannels.add(ch);
  }

  // Start polling if not already running
  startPolling();

  // Keep alive ping every 15 seconds
  const keepAlive = setInterval(() => {
    res.write(`: keepalive\n\n`);
  }, 15000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(client);
    console.log(`📡 SSE client disconnected (${sseClients.size} remaining)`);
    // Recalculate watched channels
    rebuildWatchedChannels();
  });

  console.log(`📡 SSE client connected for [${channels.join(', ')}] (${sseClients.size} total)`);
});

/**
 * Rebuild the set of watched channels from all active SSE clients.
 */
function rebuildWatchedChannels() {
  watchedChannels.clear();
  for (const client of sseClients) {
    for (const ch of client.channels) {
      watchedChannels.add(ch);
    }
  }
  if (watchedChannels.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('⏸️  Polling stopped (no SSE clients)');
  }
}

/**
 * Start the background polling loop.
 */
function startPolling() {
  if (pollTimer) return; // already running

  console.log('▶️  Background polling started (every 30s)');
  pollTimer = setInterval(pollForNewPosts, POLL_INTERVAL);

  // Do an initial poll after a short delay
  setTimeout(pollForNewPosts, 2000);
}

/**
 * Poll all watched channels for new posts.
 */
async function pollForNewPosts() {
  if (watchedChannels.size === 0) return;

  const channelsList = [...watchedChannels];

  for (const channel of channelsList) {
    try {
      const result = await scrapeChannel(channel);

      // Update cache
      setCache(`posts:${channel.toLowerCase()}`, result);

      // Check for new posts
      const prevIds = knownPostIds.get(channel) || new Set();
      const currentIds = new Set();
      const newPosts = [];

      for (const post of result.posts) {
        currentIds.add(post.id);
        if (prevIds.size > 0 && !prevIds.has(post.id)) {
          newPosts.push({ ...post, channelInfo: result.channel });
        }
      }

      // Update known IDs
      knownPostIds.set(channel, currentIds);

      // If we have new posts, broadcast to SSE clients
      if (newPosts.length > 0) {
        console.log(`🆕 ${newPosts.length} new post(s) from @${channel}`);
        broadcastNewPosts(channel, newPosts, result.channel);
      }
    } catch (err) {
      console.error(`⚠️  Poll error for @${channel}:`, err.message);
    }
  }
}

/**
 * Broadcast new posts to all SSE clients watching the channel.
 */
function broadcastNewPosts(channel, newPosts, channelInfo) {
  const payload = JSON.stringify({
    type: 'new_posts',
    channel,
    channelInfo,
    posts: newPosts,
    timestamp: new Date().toISOString(),
  });

  for (const client of sseClients) {
    if (client.channels.includes(channel) || client.channels.length === 0) {
      try {
        client.res.write(`data: ${payload}\n\n`);
      } catch (err) {
        // Client probably disconnected
        sseClients.delete(client);
      }
    }
  }
}

/**
 * POST /api/watch — update the channels being watched by SSE
 * Body: { channels: ["ch1", "ch2"] }
 */
app.use(express.json());
app.post('/api/watch', (req, res) => {
  const { channels } = req.body || {};
  if (!Array.isArray(channels)) {
    return res.status(400).json({ error: 'channels must be an array' });
  }
  // Add to watched channels
  for (const ch of channels) {
    watchedChannels.add(ch);
  }
  startPolling();
  res.json({ watching: [...watchedChannels] });
});

// ── API Routes ───────────────────────────────────────────────────────

/**
 * GET /api/posts?channel=channelname
 * Scrape and return posts from a public Telegram channel.
 */
app.get('/api/posts', async (req, res) => {
  const channel = (req.query.channel || '').trim();

  if (!channel) {
    return res.status(400).json({ error: 'Missing "channel" query parameter' });
  }

  // Validate channel name (alphanumeric + underscore, 5-32 chars)
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(channel)) {
    return res.status(400).json({ error: 'Invalid channel name' });
  }

  const cacheKey = `posts:${channel.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    const result = await scrapeChannel(channel);
    setCache(cacheKey, result);

    // Initialize known post IDs for this channel
    const ids = new Set(result.posts.map(p => p.id));
    knownPostIds.set(channel, ids);

    res.json({ ...result, cached: false });
  } catch (err) {
    console.error(`Error scraping channel "${channel}":`, err.message);
    res.status(500).json({ error: `Failed to scrape channel: ${err.message}` });
  }
});

/**
 * GET /api/multi?channels=ch1,ch2,ch3
 * Scrape multiple channels at once and return combined posts sorted by date.
 */
app.get('/api/multi', async (req, res) => {
  const channelsParam = (req.query.channels || '').trim();

  if (!channelsParam) {
    return res.status(400).json({ error: 'Missing "channels" query parameter' });
  }

  const channels = channelsParam.split(',').map(c => c.trim()).filter(Boolean);

  if (channels.length === 0) {
    return res.status(400).json({ error: 'No valid channels provided' });
  }

  if (channels.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 channels at once' });
  }

  try {
    const results = await Promise.allSettled(
      channels.map(async (channel) => {
        const cacheKey = `posts:${channel.toLowerCase()}`;
        const cached = getCached(cacheKey);
        if (cached) return cached;

        const result = await scrapeChannel(channel);
        setCache(cacheKey, result);
        return result;
      })
    );

    const allPosts = [];
    const channelInfos = {};

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { channel, posts } = result.value;
        channelInfos[channel.username] = channel;

        // Initialize known post IDs
        const ids = new Set(posts.map(p => p.id));
        knownPostIds.set(channel.username, ids);

        for (const post of posts) {
          allPosts.push({ ...post, channelInfo: channel });
        }
      }
    }

    // Sort by date (newest first)
    allPosts.sort((a, b) => {
      if (!a.date || !b.date) return 0;
      return new Date(b.date) - new Date(a.date);
    });

    res.json({ channels: channelInfos, posts: allPosts });
  } catch (err) {
    console.error('Error in multi-scrape:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start Server ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🚀 TeleMirror Server running at http://localhost:${PORT}`);
  console.log(`  📡 API endpoint: http://localhost:${PORT}/api/posts?channel=durov`);
  console.log(`  🔴 SSE stream:   http://localhost:${PORT}/api/stream?channels=durov`);
  console.log(`  🌐 Frontend:     http://localhost:${PORT}\n`);
});
