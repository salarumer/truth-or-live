import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Serve the built React app
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req: any, res: any) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
