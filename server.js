require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');
const playlist = require('./public/js/songs');

const isVercelRuntime = Boolean(process.env.VERCEL);
let Database;
try {
  Database = require('better-sqlite3');
} catch (error) {
  console.warn('better-sqlite3 unavailable, falling back to Supabase-only mode:', error.message);
  Database = null;
}

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'blue-secret-cookie-key';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'comments.db');
const COMMENTS_JSON_FILE = path.join(DATA_DIR, 'comments.json');
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const useSupabase = Boolean(supabaseUrl && (supabaseAnonKey || supabaseServiceKey));
const supabase = useSupabase
  ? createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;
let db = null;

function createCommentRecord(videoId, author, content) {
  return {
    id: 'c-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    video_id: videoId,
    author,
    content,
    created_at: new Date().toISOString(),
    flagged: 0
  };
}

async function fetchCommentsForVideo(videoId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('comments')
      .select('id, video_id, author, content, created_at')
      .eq('video_id', videoId)
      .eq('flagged', 0)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase fetch comments error:', error);
      return [];
    }

    return data || [];
  }

  if (!db) {
    return [];
  }

  const stmt = db.prepare(`
    SELECT id, video_id, author, content, created_at 
    FROM comments 
    WHERE video_id = ? AND flagged = 0 
    ORDER BY datetime(created_at) ASC, created_at ASC
  `);
  return stmt.all(videoId);
}

async function insertCommentForVideo(videoId, author, content) {
  const newComment = createCommentRecord(videoId, author, content);

  if (supabase) {
    const { data, error } = await supabase
      .from('comments')
      .insert([newComment])
      .select();

    if (error) {
      throw new Error(error.message || 'Supabase insert failed');
    }

    return data && data[0] ? data[0] : newComment;
  }

  if (!db) {
    throw new Error('Local SQLite is unavailable in this runtime.');
  }

  const insertStmt = db.prepare(`
    INSERT INTO comments (id, video_id, author, content, created_at, flagged)
    VALUES (@id, @video_id, @author, @content, @created_at, @flagged)
  `);
  insertStmt.run({
    id: newComment.id,
    video_id: newComment.video_id,
    author: newComment.author,
    content: newComment.content,
    created_at: newComment.created_at,
    flagged: newComment.flagged
  });

  return newComment;
}

async function flagCommentInStore(videoId, id) {
  if (supabase) {
    const { error } = await supabase
      .from('comments')
      .update({ flagged: 1 })
      .eq('id', id)
      .eq('video_id', videoId);

    return !error;
  }

  if (!db) {
    return false;
  }

  const stmt = db.prepare('UPDATE comments SET flagged = 1 WHERE id = ? AND video_id = ?');
  const info = stmt.run(id, videoId);
  return info.changes > 0;
}

async function deleteCommentFromStore(videoId, id) {
  if (supabase) {
    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', id)
      .eq('video_id', videoId);

    return !error;
  }

  if (!db) {
    return false;
  }

  const stmt = db.prepare('DELETE FROM comments WHERE id = ? AND video_id = ?');
  const info = stmt.run(id, videoId);
  return info.changes > 0;
}

// Ensure data directory exists
if (!isVercelRuntime && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Set of valid video IDs from curated playlist
const validVideoIds = new Set(playlist.map((s) => s.videoId));

if (!isVercelRuntime && Database) {
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      flagged INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id, flagged);
  `);
}

// Migrate existing comments from comments.json if table is empty
function migrateJsonComments() {
  if (!db) return;
  const rowCount = db.prepare('SELECT COUNT(*) as count FROM comments').get().count;
  if (rowCount === 0 && fs.existsSync(COMMENTS_JSON_FILE)) {
    try {
      const raw = fs.readFileSync(COMMENTS_JSON_FILE, 'utf8');
      const commentsMap = JSON.parse(raw);
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO comments (id, video_id, author, content, created_at, flagged)
        VALUES (@id, @video_id, @author, @content, @created_at, @flagged)
      `);

      const insertMany = db.transaction((entries) => {
        for (const item of entries) {
          insertStmt.run(item);
        }
      });

      const records = [];
      for (const [vId, list] of Object.entries(commentsMap)) {
        if (Array.isArray(list)) {
          for (const c of list) {
            if (c && c.id && c.content) {
              records.push({
                id: String(c.id),
                video_id: c.video_id || vId,
                author: c.author || 'Anonymous Listener',
                content: c.content,
                created_at: c.created_at || new Date().toISOString(),
                flagged: c.flagged ? 1 : 0
              });
            }
          }
        }
      }

      if (records.length > 0) {
        insertMany(records);
        console.log(`Migrated ${records.length} comments from comments.json to SQLite.`);
      }
    } catch (err) {
      console.error('Failed to migrate comments.json:', err);
    }
  }
}

if (db) {
  migrateJsonComments();
}

// Active SSE client connections: videoId -> Set of response objects
const sseClients = new Map();

// Helper to generate poetic listener names server-side
const poeticAdjectives = ['Quiet', 'Late Night', 'Sufi', 'Dreamy', 'Moonlit', 'Raga', 'Melody', 'Silent', 'Wandering', 'Ocean', 'Sky'];
function generatePoeticName() {
  const randomAdj = poeticAdjectives[Math.floor(Math.random() * poeticAdjectives.length)];
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${randomAdj} Listener ${randomNum}`;
}

// Helper to get or issue signed cookie author name
function getOrSetAuthor(req, res) {
  let author = req.signedCookies && req.signedCookies.blue_author;
  if (!author || typeof author !== 'string' || !author.trim()) {
    author = generatePoeticName();
    res.cookie('blue_author', author, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }
  return author;
}

// Security & Optimization Middlewares
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.youtube.com", "https://s.ytimg.com"],
      frameSrc: ["'self'", "https://www.youtube.com"],
      imgSrc: ["'self'", "data:", "https://i.ytimg.com", "https://*.ytimg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(compression());
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json());

// Serve static assets with proper Cache-Control (immutable for assets, no-cache for HTML)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.match(/\.(css|js|webp|jpg|jpeg|png|svg|woff2?)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// In-memory rate-limiter: IP -> lastPostTimestamp
const rateLimitMap = new Map();

// Clean up stale rateLimitMap entries older than 10 seconds every 60 seconds
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamp] of rateLimitMap.entries()) {
    if (now - timestamp > 10000) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// Endpoint to retrieve current listener identity
app.get('/api/me', (req, res) => {
  const author = getOrSetAuthor(req, res);
  res.json({ author });
});

// REST: Get non-flagged comments for a song
app.get('/api/comments/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!validVideoIds.has(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  const comments = await fetchCommentsForVideo(videoId);
  res.json(comments);
});

// REST: Post a reflection for a song
app.post('/api/comments/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!validVideoIds.has(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  // Rate limiting (1 post every 3 seconds per IP)
  const now = Date.now();
  const lastPost = rateLimitMap.get(ip) || 0;
  if (now - lastPost < 3000) {
    return res.status(429).json({ error: 'Please wait a moment before sending another reflection.' });
  }
  rateLimitMap.set(ip, now);

  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Comment content is required.' });
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'Comment cannot be blank.' });
  }

  if (trimmed.length > 500) {
    return res.status(400).json({ error: 'Comment exceeds 500 characters.' });
  }

  const author = getOrSetAuthor(req, res);

  let newComment;
  try {
    newComment = await insertCommentForVideo(videoId, author, trimmed);
  } catch (error) {
    console.error('Failed to insert comment:', error);
    return res.status(500).json({ error: 'Unable to save comment right now.' });
  }

  if (sseClients.has(videoId)) {
    const clients = sseClients.get(videoId);
    const dataString = `data: ${JSON.stringify({
      id: newComment.id,
      video_id: newComment.video_id,
      author: newComment.author,
      content: newComment.content,
      created_at: newComment.created_at
    })}\n\n`;

    for (const clientRes of clients) {
      try {
        clientRes.write(dataString);
      } catch (err) {
        console.warn('Error writing SSE broadcast:', err);
      }
    }
  }

  res.status(201).json({
    id: newComment.id,
    video_id: newComment.video_id,
    author: newComment.author,
    content: newComment.content,
    created_at: newComment.created_at
  });
});

// REST: Flag a comment
app.post('/api/comments/:videoId/:id/flag', async (req, res) => {
  const { videoId, id } = req.params;
  if (!validVideoIds.has(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  const success = await flagCommentInStore(videoId, id);
  if (!success) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  res.json({ success: true, flagged: id });
});

// REST: Admin delete comment protected by ADMIN_TOKEN
app.delete('/api/comments/:videoId/:id', async (req, res) => {
  const { videoId, id } = req.params;
  if (!validVideoIds.has(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  const authHeader = req.headers.authorization;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || !authHeader || authHeader !== `Bearer ${adminToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const success = await deleteCommentFromStore(videoId, id);
  if (!success) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  res.json({ success: true, deleted: id });
});

// SSE: Real-time comments stream for a song with 20s keepalive ping
app.get('/api/comments/:videoId/stream', (req, res) => {
  const { videoId } = req.params;
  if (!validVideoIds.has(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (supabase) {
    const channel = supabase
      .channel(`comments:${videoId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: `video_id=eq.${videoId}`
        },
        (payload) => {
          const record = payload.new || payload.old;
          if (!record || record.flagged === 1) {
            return;
          }

          try {
            res.write(`data: ${JSON.stringify({
              id: record.id,
              video_id: record.video_id,
              author: record.author,
              content: record.content,
              created_at: record.created_at
            })}\n\n`);
          } catch (err) {
            console.warn('Error writing Supabase SSE event:', err);
          }
        }
      )
      .subscribe();

    res.write(': connected\n\n');

    const keepAliveInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (err) {
        clearInterval(keepAliveInterval);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAliveInterval);
      supabase.removeChannel(channel);
    });
    return;
  }

  if (!sseClients.has(videoId)) {
    sseClients.set(videoId, new Set());
  }
  const clients = sseClients.get(videoId);
  clients.add(res);

  res.write(': connected\n\n');

  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      clearInterval(keepAliveInterval);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
    clients.delete(res);
    if (clients.size === 0) {
      sseClients.delete(videoId);
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'blue',
    timestamp: new Date().toISOString()
  });
});

let server;

if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`BLUE server is playing on http://localhost:${PORT}`);
  });
}

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  clearInterval(rateLimitCleanupInterval);

  // Close all SSE connections cleanly
  for (const [, clients] of sseClients.entries()) {
    for (const clientRes of clients) {
      try {
        clientRes.end();
      } catch (e) {}
    }
  }
  sseClients.clear();

  // Close server
  if (server) {
    server.close(() => {
      console.log('HTTP server closed.');
      try {
        if (db) db.close();
        console.log('SQLite database connection closed.');
      } catch (err) {
        console.error('Error closing database:', err);
      }
      process.exit(0);
    });

    // Force exit after 5 seconds if graceful close hangs
    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 5000);
    return;
  }

  try {
    if (db) db.close();
  } catch (err) {
    console.error('Error closing database:', err);
  }
}

if (require.main === module) {
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

module.exports = app;
