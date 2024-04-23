const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3');
const path = require('path');
const minimist = require('minimist');
const axios = require('axios');
const open = require('open');

const app = express();

// Parse command line arguments
const args = minimist(process.argv.slice(2));
// Default fallbacks: command line args -> environment variables -> static defaults
const port = args.port || process.env.MIKUPAD_PORT || 3000;
const host = args.host || process.env.MIKUPAD_HOST || '0.0.0.0';
const noOpen = (args.open !== undefined && !args.open) || process.env.MIKUPAD_NO_OPEN;

app.use(cors(), bodyParser.json({limit: "100mb"}));

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

// GET route to serve Mikupad html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'mikupad.html'));
});

// Dynamic POST proxy route
app.post('/proxy/*', async (req, res) => {
    // Capture the part of the URL after '/proxy'
    const path = req.params[0];

    // Target server base URL
    const targetBaseUrl = req.headers['x-real-url'];
    delete req.headers['x-real-url'];

    if ('content-length' in req.headers) {
        delete req.headers['content-length'];
    }

    try {
        const response = await axios({
            method: 'post',
            url: `${targetBaseUrl}/${path}`,
            data: req.body,
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname  // Update the Host header for the target server
            },
            responseType: 'stream'
        });

        // Proxy the headers
        res.set(response.headers);

        // Proxy stream requests
        response.data.pipe(res);

        // Stop stream requests if the connection is aborted on the other end
        res.on('close', () => {
            response.data.destroy();
        });
    } catch (error) {
        if (error.response) {
            if (error.response.data.pipe !== undefined) {
                error.response.data.pipe(res.status(error.response.status));
            } else {
                res.status(error.response.status).send(error.response.data);
            }
        } else if (error.request) {
            res.status(504).send('No response from target server.');
        } else {
            res.status(500).send(`Error setting up request to target server: ${error.message}`);
        }
    }
});

// Dynamic GET proxy route
app.get('/proxy/*', async (req, res) => {
    // Capture the part of the URL after '/proxy'
    const path = req.params[0];

    // Target server base URL
    const targetBaseUrl = req.headers['x-real-url'];
    delete req.headers['x-real-url'];

    if ('content-length' in req.body) {
        delete req.body['content-length'];
    }

    try {
        const response = await axios.get(`${targetBaseUrl}/${path}`, {
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname  // Update the Host header for the target server
            }
        });

        res.send(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
            res.status(504).send('No response from target server.');
        } else {
            res.status(500).send(`Error setting up request to target server: ${error.message}`);
        }
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
app.listen(port, host, () => {
    console.log(`Server listening at http://${host}:${port}`);
    if (!noOpen) {
        open(`http://127.0.0.1:${port}/`);
    }
});

// Close db connection on server close
process.on('SIGINT', () => {
    db.close(() => {
        process.exit(0);
    });
});