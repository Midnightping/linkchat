const { Client, LocalAuth } = require('whatsapp-web.js');
const { generateReply, logActivity, getActivityLog } = require('./ai');
const express = require('express');
const qrcodeLib = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.text({ limit: '50mb' })); // To handle large .txt file uploads
app.use(express.static('public'));

// Data path setup
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}
const configPath = path.join(dataDir, 'config.json');

// Initialize config if it doesn't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ allowed_contacts: {} }));
}

// Clean up stale Chromium lock files left by previous crashed process
// This prevents the "profile in use by another process" error on Railway restarts
function cleanChromiumLocks(dir) {
    try {
        const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
        const walk = (d) => {
            if (!fs.existsSync(d)) return;
            fs.readdirSync(d).forEach(f => {
                const fullPath = path.join(d, f);
                if (lockFiles.includes(f)) {
                    fs.unlinkSync(fullPath);
                    console.log(`🧹 Removed stale lock: ${fullPath}`);
                } else if (fs.statSync(fullPath).isDirectory()) {
                    walk(fullPath);
                }
            });
        };
        walk(dir);
    } catch (e) {
        console.log('Lock cleanup skipped:', e.message);
    }
}
cleanChromiumLocks(dataDir);

function getConfig() {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// WhatsApp Client Setup
let currentQR = null;
let isConnected = false;

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: dataDir }), // Saves session to /data folder
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    }
});

client.on('qr', async (qr) => {
    currentQR = await qrcodeLib.toDataURL(qr);
    logActivity('QR Code generated. Waiting for scan...');
});

client.on('ready', () => {
    isConnected = true;
    currentQR = null;
    logActivity('WhatsApp Connected & Ready!');
});

client.on('disconnected', () => {
    isConnected = false;
    logActivity('WhatsApp Disconnected!');
});

client.on('message', async (msg) => {
    const contactId = msg.from; 
    const config = getConfig();
    
    if (config.allowed_contacts && config.allowed_contacts[contactId]) {
        const contact = config.allowed_contacts[contactId];
        logActivity(`📩 [${contact.name}] Msg: "${msg.body}"`);
        
        // Realistic Human Reaction Delay: wait 2 to 8 seconds before "seeing" it
        const reactionDelay = Math.floor(Math.random() * (8000 - 2000 + 1)) + 2000;
        await new Promise(resolve => setTimeout(resolve, reactionDelay));
        
        const replyText = await generateReply(contactId, contact, msg.body);
        
        if (replyText) {
            logActivity(`🤖 [AI -> ${contact.name}] Drafted: "${replyText}"`);
            const chat = await msg.getChat();
            
            // Show "typing..."
            await chat.sendStateTyping();
            
            // Realistic Human Typing Delay: ~60ms per character + some random hesitation
            const typingDelay = (replyText.length * 60) + Math.floor(Math.random() * 1500); 
            await new Promise(resolve => setTimeout(resolve, typingDelay));
            
            await chat.clearState();
            await client.sendMessage(contactId, replyText);
            logActivity(`✅ [Sent to ${contact.name}] "${replyText}"`);
        } else {
            logActivity(`⚠️ AI returned no reply for ${contact.name} (Silent drop)`);
        }
    }
});

client.initialize();

// API ROUTES FOR DASHBOARD
app.get('/api/status', (req, res) => {
    res.json({ connected: isConnected, qr: currentQR });
});

app.get('/api/activity', (req, res) => {
    res.json(getActivityLog());
});

app.get('/api/contacts', (req, res) => {
    const config = getConfig();
    res.json(config.allowed_contacts || {});
});

app.post('/api/contacts', (req, res) => {
    const { id, name, relationship, goal } = req.body;
    if (!id || !name || !goal) return res.status(400).json({ error: "Missing fields" });

    const config = getConfig();
    if(!config.allowed_contacts) config.allowed_contacts = {};
    
    config.allowed_contacts[id] = { name, relationship, goal };
    saveConfig(config);
    
    res.json({ success: true });
});

app.delete('/api/contacts/:id', (req, res) => {
    const id = req.params.id;
    const config = getConfig();
    
    if (config.allowed_contacts && config.allowed_contacts[id]) {
        delete config.allowed_contacts[id];
        saveConfig(config);
    }
    
    res.json({ success: true });
});

// Route for Data Sync feature
app.post('/api/upload-history/:id', (req, res) => {
    const id = req.params.id;
    const historyText = req.body; // Received as raw text due to express.text()
    
    if (!historyText || typeof historyText !== 'string') {
        return res.status(400).json({ error: "Invalid file data" });
    }

    try {
        const historyPath = path.join(dataDir, `history_${id}.txt`);
        fs.writeFileSync(historyPath, historyText);
        logActivity(`📁 Synced chat history for target: ${id}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(port, () => {
    console.log(`\n🌍 Dashboard running at port ${port}`);
});
