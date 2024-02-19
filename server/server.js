const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3');
const app = express();
const port = 3000;

app.use(cors(), bodyParser.json());

// Open a database connection
const db = new sqlite3.Database('./web-session-storage.db', (err) => {
    if (err) {
        console.error(err.message);
        throw err;
    } else {
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            key TEXT PRIMARY KEY,
            data TEXT
        )`);
    }
});

// POST route to load data
app.post('/load', (req, res) => {
    const { key } = req.body;
    db.get('SELECT data FROM sessions WHERE key = ?', [key], (err, row) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error querying the database' });
        } else if (row) {
            res.json({ ok: true, result: JSON.parse(row.data) });
        } else {
            res.status(404).json({ ok: false, message: 'Key not found' });
        }
    });
});

// POST route to save data
app.post('/save', (req, res) => {
    const { key, data } = req.body;
    db.run('INSERT OR REPLACE INTO sessions (key, data) VALUES (?, ?)', [key, JSON.stringify(data)], (err) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error writing to the database' });
        } else {
            res.json({ ok: true, result: 'Data saved successfully' });
        }
    });
});

// POST route to get all sessions
app.post('/sessions', (req, res) => {
    db.all('SELECT key, data FROM sessions', [], (err, rows) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error querying the database' });
        } else {
            const sessions = {};
            rows.forEach((row) => {
                sessions[row.key] = JSON.parse(row.data);
            });
            res.json({ ok: true, result: sessions });
        }
    });
});

// POST route to delete a session
app.post('/delete', (req, res) => {
    const { sessionId } = req.body;
    db.run('DELETE FROM sessions WHERE key = ?', [sessionId], (err) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error deleting from the database' });
        } else {
            res.json({ ok: true, result: 'Session deleted successfully' });
        }
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});

// Close db connection on server close
process.on('SIGINT', () => {
    db.close(() => {
        process.exit(0);
    });
});