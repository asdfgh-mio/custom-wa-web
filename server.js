const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
const port = 3000;

app.use(express.static('public'));

// Setup Multer to strictly save file as 'creds.json' inside './session' folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './session';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, 'creds.json');
    }
});
const upload = multer({ storage: storage });

app.post('/upload-and-start', upload.single('credsFile'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'creds.json file is missing' });

    res.json({ success: true, message: 'Creds uploaded! Booting up WhatsApp Bot...' });
    
    // Background mein bot start karna
    launchBot();
});

async function launchBot() {
    console.log("Reading keys from creds.json...");
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, isNewLogin } = update;
        if (connection === 'open') {
            console.log('Bot is Live and Connected using uploaded creds!');
            sock.sendMessage(sock.user.id, { text: 'Bot successfully started from uploaded creds.json!' });
        } else if (connection === 'close') {
            console.log('Connection closed.');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
