const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Frontend files serve karne ke liye
app.use(express.static('public'));
app.use(express.json());

// File upload setup
const upload = multer({ dest: 'uploads/' });

let sock;

// API: Handle creds.json upload
app.post('/upload-creds', upload.single('credsFile'), async (req, res) => {
    try {
        const sessionPath = path.join(__dirname, 'session');
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);

        // Rename uploaded file to creds.json
        fs.renameSync(req.file.path, path.join(sessionPath, 'creds.json'));

        res.json({ success: true, message: 'Credentials loaded! Connecting to WhatsApp...' });
        
        // Start WhatsApp Connection
        startWhatsApp(sessionPath);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

async function startWhatsApp(sessionPath) {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ WhatsApp Connected!');
            io.emit('status', { text: '🟢 Connected!', color: '#22c55e' });
        } else if (connection === 'close') {
            console.log('❌ Disconnected');
            io.emit('status', { text: '🔴 Disconnected. Please re-upload valid creds.', color: '#ef4444' });
        }
    });

    // Receive incoming messages and send to frontend
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid.split('@')[0];
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '[Media/Other]';

        io.emit('new_message', { sender, text });
    });
}

// Socket.io for sending messages from web interface
io.on('connection', (socket) => {
    socket.on('send_message', async (data) => {
        if (sock) {
            try {
                const jid = `${data.number}@s.whatsapp.net`;
                await sock.sendMessage(jid, { text: data.text });
                socket.emit('message_sent', { success: true });
            } catch (err) {
                socket.emit('message_sent', { success: false, error: err.message });
            }
        } else {
            socket.emit('message_sent', { success: false, error: "WhatsApp not connected yet." });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
