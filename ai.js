const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

const persona = fs.readFileSync('persona.txt', 'utf8');

// A simple in-memory store for conversation history per contact
const conversationMemory = {};

// Keep an activity log for the dashboard
const activityLog = [];

function logActivity(message) {
    const timestamp = new Date().toLocaleTimeString();
    activityLog.unshift(`[${timestamp}] ${message}`);
    if (activityLog.length > 50) activityLog.pop(); // keep last 50
}

function getActivityLog() {
    return activityLog;
}

async function generateReply(contactId, contactInfo, incomingMessage) {
    if (!conversationMemory[contactId]) {
        conversationMemory[contactId] = [];
    }

    // Keep only the last 15 messages for context
    if (conversationMemory[contactId].length > 15) {
        conversationMemory[contactId].shift();
    }

    // Add user's message to memory
    conversationMemory[contactId].push({ role: 'user', content: incomingMessage });

    // Check for target-specific history
    let targetHistory = "";
    const historyPath = path.join(__dirname, 'data', `history_${contactId}.txt`);
    if (fs.existsSync(historyPath)) {
        try {
            const rawHistory = fs.readFileSync(historyPath, 'utf8');
            // get the last 4000 characters to prevent token limits
            targetHistory = rawHistory.slice(-4000); 
        } catch (e) {
            console.error("Error reading history file", e);
        }
    }

    const systemPrompt = `
${persona}

You are talking to: ${contactInfo.name}
Relationship: ${contactInfo.relationship}
Your AI Goal for this person: ${contactInfo.goal}

CRITICAL RULES FOR REALISM:
1. DO NOT write paragraphs or essays. Keep replies EXTREMELY short (1-2 sentences max).
2. DO NOT act like an AI assistant. NEVER ask artificial follow-up questions just to keep the conversation going. Real humans don't always ask questions.
3. If the conversation is dying (they say "ok", "cool", etc.), you can either just say "yh" or randomly bring up a new topic related to your past history.
4. If they say goodnight or indicate they are going to sleep, JUST SAY GOODNIGHT and end the conversation. Do not ask them anything else. Let them sleep.
5. You must factor your "AI Goal" into the conversation subtly.

${targetHistory ? `\nPAST CHAT HISTORY WITH ${contactInfo.name}:\n${targetHistory}\nUse this history to perfectly match the vibe, inside jokes, and exact way you talk to them.` : ''}

Read the recent messages and generate your response. Do not include quotes or prefixes like "Me:". Just the raw text.
    `.trim();

    try {
        const response = await openai.chat.completions.create({
            model: 'llama3-70b-8192',
            messages: [
                { role: 'system', content: systemPrompt },
                ...conversationMemory[contactId]
            ],
            temperature: 0.7,
            max_tokens: 100
        });

        let reply = response.choices[0].message.content.trim();
        
        // Strip out any weird AI prefixes if they slip through
        if (reply.toLowerCase().startsWith('me:')) {
            reply = reply.substring(3).trim();
        }
        
        // Add AI's reply to memory
        conversationMemory[contactId].push({ role: 'assistant', content: reply });

        return reply;
    } catch (error) {
        // Fail silently on quota limit or API errors
        console.error("Groq API Error:", error.message);
        logActivity(`❌ API Error for ${contactInfo.name}: ${error.message} (Failing silently)`);
        return null;
    }
}

module.exports = {
    generateReply,
    logActivity,
    getActivityLog
};
