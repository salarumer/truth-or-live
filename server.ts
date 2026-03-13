import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';

const app = express();
app.use(express.json());

const db = new Database('./game-history.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    result TEXT NOT NULL,
    story_type TEXT,
    topic TEXT,
    played_at TEXT NOT NULL
  )
`);

app.post('/api/games', (req: any, res: any) => {
  const { mode, result, story_type, topic } = req.body;
  const stmt = db.prepare('INSERT INTO games (mode, result, story_type, topic, played_at) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(mode, result, story_type ?? null, topic ?? null, new Date().toISOString());
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/games', (_req: any, res: any) => {
  const games = db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT 50').all();
  res.json(games);
});

// Expose API key to frontend at runtime
app.get('/api/config', (_req: any, res: any) => {
  res.json({ apiKey: process.env.GEMINI_API_KEY || "" });
});

// Serve the built React app
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('*', (_req: any, res: any) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
