const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { generateReply } = require('./ai');

// Load config
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const client = new Client({
    authStrategy: new LocalAuth(), // Saves session so you don't have to scan QR every time
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    // Generate and scan this code with your phone
    console.log('\n--- QR CODE RECEIVED ---');
    console.log('Scan the QR code below with your WhatsApp (Linked Devices):');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ Client is ready! The AI Auto-Responder is now active.');
    console.log('Waiting for messages from allowed contacts...');
});

client.on('message', async (msg) => {
    const contactId = msg.from; // Usually in the format "number@c.us"
    
    // Check if we should reply to this person
    if (config.allowed_contacts[contactId]) {
        console.log(`\n📩 Received message from ${config.allowed_contacts[contactId].name} (${contactId}): ${msg.body}`);
        
        // Optional: add a small delay to simulate reaction time
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate reply
        const replyText = await generateReply(contactId, config.allowed_contacts[contactId], msg.body);
        
        if (replyText) {
            console.log(`🤖 AI generated reply: ${replyText}`);
            
            // Simulate typing
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            
            // Wait a bit to simulate typing time based on length of response
            const typingTime = Math.min(replyText.length * 50, 5000); // 50ms per character, max 5s
            await new Promise(resolve => setTimeout(resolve, typingTime));
            
            await chat.clearState();
            await client.sendMessage(contactId, replyText);
            console.log('✅ Reply sent!');
        }
    } else {
        // console.log(`Ignored message from ${contactId}`);
    }
});

client.initialize();
