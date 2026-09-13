const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './session';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, 'creds.json')
});
const upload = multer({ storage });

let sock;

app.post('/upload', upload.single('credsFile'), async (req, res) => {
    res.json({ success: true });
    startWhatsAppEngine();
});

async function startWhatsAppEngine() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        syncFullHistory: true, 
        browser: ['Custom Web Client', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') {
            io.emit('system_status', { status: 'connected' });
        }
    });

    // Handle History Sync (Purani Chats load karna)
    sock.ev.on('messaging-history.set', ({ chats }) => {
        chats.forEach(chat => {
            io.emit('chat_update', {
                jid: chat.id,
                type: chat.id.includes('@g.us') ? 'Group' : (chat.id.includes('@newsletter') ? 'Channel' : 'Direct'),
                sender: chat.name || chat.id.split('@')[0],
                text: 'Load chat history to view',
                fromMe: false
            });
        });
    });

    // Handle New Incoming Messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        const isChannel = msg.key.remoteJid.includes('@newsletter');
        let type = isChannel ? 'Channel' : (isGroup ? 'Group' : 'Direct');
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || '[Media/System Message]';

        io.emit('chat_update', {
            jid: msg.key.remoteJid,
            type: type,
            sender: msg.pushName || msg.key.remoteJid.split('@')[0],
            text: text,
            fromMe: msg.key.fromMe
        });
    });
}

// Frontend Commands Handler
io.on('connection', (socket) => {
    socket.on('send_message', async (data) => {
        if (sock) {
            await sock.sendMessage(data.jid, { text: data.text });
            socket.emit('chat_update', { jid: data.jid, sender: 'You', text: data.text, fromMe: true, type: 'Direct' });
        }
    });

    socket.on('follow_channel', async (jid) => {
        if (sock) await sock.newsletterFollow(jid);
    });

    socket.on('add_user', async (data) => {
        if (sock) await sock.groupParticipantsUpdate(data.groupJid, [data.targetJid], "add");
    });
});

server.listen(3000, () => console.log('🚀 Custom WhatsApp UI live on port 3000'));
