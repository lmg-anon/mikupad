const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3');
const path = require('path');
const minimist = require('minimist');
const axios = require('axios');
const open = require('open');
const zlib = require('zlib');

const app = express();

// Parse command line arguments
const args = minimist(process.argv.slice(2));
// Default fallbacks: command line args -> environment variables -> static defaults
const port = args.port || process.env.MIKUPAD_PORT || 3000;
const host = args.host || process.env.MIKUPAD_HOST || '0.0.0.0';
const noOpen = (args.open !== undefined && !args.open) || process.env.MIKUPAD_NO_OPEN;
const login = args.login || process.env.MIKUPAD_LOGIN || 'anon';
const password = args.password || process.env.MIKUPAD_PASSWORD || undefined;

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

// Server API version
const SERVER_VERSION = 3;

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

const compressData = (data) => {
    return new Promise((resolve, reject) => {
        zlib.gzip(data, (err, buffer) => {
            if (err) return reject(err);
            resolve(buffer);
        });
    });
};

const decompressData = (buffer) => {
    return new Promise((resolve, reject) => {
        zlib.gunzip(buffer, (err, decompressed) => {
            if (err) return reject(err);
            resolve(decompressed.toString());
        });
    });
};

const runMigrationToV3 = (db) => {
    return new Promise((resolve, reject) => {
        // Check if the 'sessions' table exists and the 'names' table doesn't to determine if a 2->3 migration is needed.
        const migrationCheckSql = `
            SELECT 'migration_needed' as status
            FROM sqlite_master
            WHERE type = 'table' AND name = 'sessions'
              AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'names');
        `;
        
        db.get(migrationCheckSql, (err, row) => {
            if (err) {
                return reject(err);
            }

            if (row) {
                // This is a V2 database. We need to extract names and compress data.
                db.serialize(async () => {
                    try {
                        const migrateTable = async (tableName, processRow) => {
                            await new Promise((res, rej) => db.run(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`, (err) => err ? rej(err) : res()));
                            await new Promise((res, rej) => db.run(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, data BLOB)`, (err) => err ? rej(err) : res()));
                            const rows = await new Promise((res, rej) => db.all(`SELECT key, data FROM ${tableName}_old`, [], (err, rows) => err ? rej(err) : res(rows)));
                            for (const row of rows) {
                                await processRow(row);
                            }
                            await new Promise((res, rej) => db.run(`DROP TABLE ${tableName}_old`, (err) => err ? rej(err) : res()));
                        };

                        db.run("BEGIN TRANSACTION;");
                        
                        await new Promise((res, rej) => db.run(`CREATE TABLE names (key TEXT PRIMARY KEY, data TEXT);`, (err) => err ? rej(err) : res()));

                        await migrateTable('sessions', async (row) => {
                            const sessionData = JSON.parse(row.data);
                            const sessionName = sessionData.name;

                            if (sessionName) {
                                await new Promise((res, rej) => db.run("INSERT INTO names (key, data) VALUES (?, ?)", [row.key, sessionName], (err) => err ? rej(err) : res()));
                                delete sessionData.name;
                            }

                            const compressedData = await compressData(JSON.stringify(sessionData));
                            await new Promise((res, rej) => db.run("INSERT INTO sessions (key, data) VALUES (?, ?)", [row.key, compressedData], (err) => err ? rej(err) : res()));
                        });

                        await migrateTable('templates', async (row) => {
                            const compressedData = await compressData(row.data);
                            await new Promise((res, rej) => db.run("INSERT INTO templates (key, data) VALUES (?, ?)", [row.key, compressedData], (err) => err ? rej(err) : res()));
                        });

                        db.run("COMMIT;", (err) => {
                            if (err) {
                                return reject(err);
                            }
                            // Migration was successful!
                            resolve(true);
                        });

                    } catch (e) {
                        db.run("ROLLBACK;");
                        reject(e);
                    }
                });
            } else {
                // This is already a V3 db, no migration needed.
                resolve(false);
            }
        });
    });
};


// Open a database connection
const db = new sqlite3.Database('./web-session-storage.db', (err) => {
    if (err) {
        console.error(err.message);
        process.exit(1);
    }

    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, data BLOB)`);
        db.run(`CREATE TABLE IF NOT EXISTS templates (key TEXT PRIMARY KEY, data BLOB)`);
        db.run(`CREATE TABLE IF NOT EXISTS themes (key TEXT PRIMARY KEY, data BLOB)`);
        db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

        runMigrationToV3(db).then((didMigrate) => {
            if (!didMigrate) {
                // If no migration happened, it's either a V3 DB or a entirely new DB, ensure names table exists.
                db.run(`CREATE TABLE IF NOT EXISTS names (key TEXT PRIMARY KEY, data TEXT)`);
            }

            db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('version', 3)`);
        }).catch((err) => {
            console.error("Migration failed:", err.message);
            process.exit(1);
        });
    });
});

// GET route to serve Mikupad html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'mikupad.html'));
});

// GET route to get the server version
app.get('/version', (req, res) => {
    res.json({ version: SERVER_VERSION });
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
    if (!storeName) {
        return "sessions";
    }
    const normalizedStoreName = storeName.split(' ')[0].toLowerCase();
    if (["sessions", "templates", "names", "themes"].includes(normalizedStoreName)) {
        return normalizedStoreName;
    }
    return null;
};

// POST route to load data
app.post('/load', (req, res) => {
    const { storeName, key } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }
    db.get(`SELECT data FROM ${normStoreName} WHERE key = ?`, [key], async (err, row) => {
        if (err) {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }
        if (!row) {
            return res.status(404).json({ ok: false, message: 'Key not found' });
        }

        try {
            if (normStoreName !== "names") {
                const decompressed = await decompressData(row.data);
                res.json({ ok: true, result: JSON.parse(decompressed) });
            } else {
                res.json({ ok: true, result: row.data });
            }
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Failed to decompress or parse data.' });
        }
    });
});

// POST route to save data
app.post('/save', async (req, res) => {
    const { storeName, key, data } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }

    try {
        let dataToStore;
        if (normStoreName !== "names") {
            dataToStore = await compressData(JSON.stringify(data));
        } else {
            dataToStore = data;
        }

        db.run(`INSERT OR REPLACE INTO ${normStoreName} (key, data) VALUES (?, ?)`, [key, dataToStore], (err) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error writing to the database' });
            } else {
                res.json({ ok: true, result: 'Data saved successfully' });
            }
        });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Failed to compress data.' });
    }
});

// POST route to update session name
app.post('/rename', (req, res) => {
    const { storeName, key, newName } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (normStoreName !== 'sessions') {
        return res.status(400).json({ ok: false, message: 'Renaming is only supported for sessions' });
    }
    db.run(
        `
        UPDATE names
        SET data = ?
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
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }
    db.all(`SELECT key, data FROM ${normStoreName}`, [], async (err, rows) => {
        if (err) {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }

        try {
            const all = {};
            if (normStoreName !== "names") {
                await Promise.all(rows.map(async (row) => {
                    const decompressed = await decompressData(row.data);
                    all[row.key] = JSON.parse(decompressed);
                }));
            } else {
                rows.forEach((row) => {
                    all[row.key] = row.data;
                });
            }
            res.json({ ok: true, result: all });
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Failed to decompress or parse data for one or more items.' });
        }
    });
});

// POST route to get session info
app.post('/sessions', (req, res) => {
    const { storeName } = req.body;
    db.all(
        `
        SELECT key, data AS name
        FROM names
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
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        db.run(`DELETE FROM ${normStoreName} WHERE key = ?`, [key]);

        if (normStoreName === 'sessions') {
            db.run(`DELETE FROM names WHERE key = ?`, [key]);
        }

        db.run("COMMIT", (err) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ ok: false, message: 'Error deleting from the database' });
            }
            res.json({ ok: true, result: 'Session deleted successfully' });
        });
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
