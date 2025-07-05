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
const login = args.login || process.env.MIKUPAD_LOGIN || 'anon';
const password = args.password || process.env.MIKUPAD_PASSWORD || undefined;
const storagePath = args.storagePath || process.env.MIKUPAD_STORAGE_PATH || './web-session-storage.db';

// Headers that shouldn't be forwarded in the proxy endpoint.
const headersToRemove = [
    'content-length',
    'cdn-loop',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto'
];

app.use(cors(), bodyParser.json({limit: "100mb"}));

// authentication middleware
app.use((req, res, next) => {
    if (!password) {
        // No password defined, access granted.
        return next();
    }

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [reqLogin, reqPassword] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (reqLogin == login && reqPassword == password) {
        // Access granted.
        return next();
    }

    // Access denied.
    res.set('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Authentication required.');
});

// Open a database connection
const db = new sqlite3.Database(storagePath, (err) => {
    if (err) {
        console.error(err.message);
        throw err;
    } else {
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            key TEXT PRIMARY KEY,
            data TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS templates (
            key TEXT PRIMARY KEY,
            data TEXT
        )`);
    }
});

// GET route to serve Mikupad html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'mikupad.html'));
});

// GET route to get the server version
app.get('/version', (req, res) => {
    res.json({ version: 2 });
});

// Dynamic POST proxy route
app.post('/proxy/*', async (req, res) => {
    // Capture the part of the URL after '/proxy'
    const path = req.params[0];

    // Target server base URL
    const targetBaseUrl = req.headers['x-real-url'];
    delete req.headers['x-real-url'];

    headersToRemove.forEach(header => {
        delete req.headers[header.toLowerCase()];
    });

    try {
        const response = await axios({
            method: 'post',
            url: `${targetBaseUrl}/${path}`,
            data: req.body,
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname,  // Update the Host header for the target server
                'Accept-Encoding': 'identity'
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

    headersToRemove.forEach(header => {
        delete req.headers[header.toLowerCase()];
    });

    try {
        const response = await axios.get(`${targetBaseUrl}/${path}`, {
            params: req.query,
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname,  // Update the Host header for the target server
                'Accept-Encoding': 'identity'
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

// Dynamic DELETE proxy route
app.delete('/proxy/*', async (req, res) => {
    // Capture the part of the URL after '/proxy'
    const path = req.params[0];

    // Target server base URL
    const targetBaseUrl = req.headers['x-real-url'];
    delete req.headers['x-real-url'];

    headersToRemove.forEach(header => {
        delete req.headers[header.toLowerCase()];
    });

    try {
        const response = await axios.delete(`${targetBaseUrl}/${path}`, {
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname,  // Update the Host header for the target server
                'Accept-Encoding': 'identity'
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

const normalizeStoreName = (storeName) => {
    if (!storeName)
        return "Sessions";
    return storeName.split(' ')[0].toLowerCase();
};

// POST route to load data
app.post('/load', (req, res) => {
    const { storeName, key } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    db.get(`SELECT data FROM ${normStoreName} WHERE key = ?`, [key], (err, row) => {
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
    const { storeName, key, data } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    db.run(`INSERT OR REPLACE INTO ${normStoreName} (key, data) VALUES (?, ?)`, [key, JSON.stringify(data)], (err) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error writing to the database' });
        } else {
            res.json({ ok: true, result: 'Data saved successfully' });
        }
    });
});

// POST route to update session name
app.post('/rename', (req, res) => {
    const { storeName, key, newName } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    db.run(
        `
        UPDATE ${normStoreName}
        SET data = json_set(data, '$.name', ?)
        WHERE key = ?
        `,
        [newName, key],
        (err) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error updating the database' });
            } else {
                res.json({ ok: true, result: 'Session renamed successfully' });
            }
        }
    );
});

// POST route to get all rows from a table
app.post('/all', (req, res) => {
    const { storeName } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    db.all(`SELECT key, data FROM ${normStoreName}`, [], (err, rows) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error querying the database' });
        } else {
            const all = {};
            rows.forEach((row) => {
                all[row.key] = JSON.parse(row.data);
            });
            res.json({ ok: true, result: all });
        }
    });
});

// POST route to get session info
app.post('/sessions', (req, res) => {
    const { storeName } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    db.all(
        `
        SELECT key, json_extract(data, '$.name') AS name
        FROM ${normStoreName}
        WHERE key NOT IN ('selectedSessionId', 'nextSessionId')
        `,
        [],
        (err, rows) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error querying the database' });
            } else {
                const sessions = {};
                rows.forEach((row) => {
                    sessions[row.key] = row.name;
                });
                res.json({ ok: true, result: sessions });
            }
        }
    );
});

// POST route to delete a session
app.post('/delete', (req, res) => {
    const { storeName, key } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    db.run(`DELETE FROM ${normStoreName} WHERE key = ?`, [key], (err) => {
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
