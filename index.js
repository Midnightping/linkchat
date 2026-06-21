const { Client, LocalAuth } = require('whatsapp-web.js');
const { generateReply } = require('./ai');
const express = require('express');
const qrcodeLib = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Data path setup (Mounted as a Railway Volume)
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}
const configPath = path.join(dataDir, 'config.json');

// Initialize config if it doesn't exist
if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ allowed_contacts: {} }));
}

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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', async (qr) => {
    console.log('\n--- QR CODE RECEIVED (Check Dashboard) ---');
    currentQR = await qrcodeLib.toDataURL(qr);
});

client.on('ready', () => {
    console.log('\n✅ Client is ready! The AI Auto-Responder is now active.');
    isConnected = true;
    currentQR = null;
});

client.on('disconnected', () => {
    console.log('Client disconnected.');
    isConnected = false;
});

client.on('message', async (msg) => {
    const contactId = msg.from; 
    const config = getConfig();
    
    if (config.allowed_contacts && config.allowed_contacts[contactId]) {
        console.log(`\n📩 Received message from ${config.allowed_contacts[contactId].name}: ${msg.body}`);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        const replyText = await generateReply(contactId, config.allowed_contacts[contactId], msg.body);
        
        if (replyText) {
            console.log(`🤖 AI generated reply: ${replyText}`);
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            
            const typingTime = Math.min(replyText.length * 50, 5000); 
            await new Promise(resolve => setTimeout(resolve, typingTime));
            
            await chat.clearState();
            await client.sendMessage(contactId, replyText);
            console.log('✅ Reply sent!');
        }
    }
});

client.initialize();

// API ROUTES FOR DASHBOARD
app.get('/api/status', (req, res) => {
    res.json({ connected: isConnected, qr: currentQR });
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

app.listen(port, () => {
    console.log(`\n🌍 Dashboard running at http://localhost:${port}`);
});
