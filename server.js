require('dotenv').config();
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3');
const SQLiteStore = require('connect-sqlite3')(session);
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();

app.set('trust proxy', 1); // needed for secure cookies to work when HTTPS is terminated by your reverse proxy

// Persists sessions to disk so the family isn't logged out on every
// `docker compose up -d --build` or container restart.
const sessionDbDir = process.env.SESSION_DB_DIR || '/app/data';
fs.mkdirSync(sessionDbDir, { recursive: true });
const sessionDb = new sqlite3.Database(path.join(sessionDbDir, 'sessions.sqlite'));

app.use(express.json());
app.use(cookieParser());
app.use(session({
  store: new SQLiteStore({ db: sessionDb }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — this is a family dashboard, not a bank
    // Only mark the cookie secure once you're actually accessing this over HTTPS
    // (i.e. through your reverse proxy). Testing directly at http://host:4000
    // needs this OFF, or the browser silently refuses to store the cookie
    // and you'll get signed out on every refresh.
    secure: process.env.COOKIE_SECURE === 'true'
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/plex', require('./routes/plex'));
app.use('/api/tautulli', require('./routes/tautulli'));
app.use('/api/sonarr', require('./routes/sonarr'));
app.use('/api/radarr', require('./routes/radarr'));
app.use('/api/overseerr', require('./routes/overseerr'));

// index.html carries a {{SITE_NAME}} placeholder so this same image can show a generic
// "Marquee" brand out of the box, or your own (e.g. via SITE_NAME=skyn3t in .env).
const siteName = process.env.SITE_NAME || 'Marquee';
app.get('/', (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) return res.status(500).end();
    res.type('html').send(html.replaceAll('{{SITE_NAME}}', siteName));
  });
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`${siteName} running on :${port}`));
