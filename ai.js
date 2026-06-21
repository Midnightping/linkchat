const { OpenAI } = require('openai');
const fs = require('fs');

require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

const persona = fs.readFileSync('persona.txt', 'utf8');

// A simple in-memory store for conversation history per contact
const conversationMemory = {};

async function generateReply(contactId, contactInfo, incomingMessage) {
    if (!conversationMemory[contactId]) {
        conversationMemory[contactId] = [];
    }

    // Keep only the last 10 messages for context
    if (conversationMemory[contactId].length > 10) {
        conversationMemory[contactId].shift();
    }

    // Add user's message to memory
    conversationMemory[contactId].push({ role: 'user', content: incomingMessage });

    const systemPrompt = `
${persona}

You are talking to: ${contactInfo.name}
Relationship: ${contactInfo.relationship}
Your Goal: ${contactInfo.goal}

Read the recent messages and generate a response that fulfills the goal while strictly maintaining your texting style persona. Do not include quotes or prefixes like "Me:". Just the raw text.
    `.trim();

    try {
        const response = await openai.chat.completions.create({
            model: 'llama3-70b-8192', // Using Groq's high-speed LLaMA 3 model
            messages: [
                { role: 'system', content: systemPrompt },
                ...conversationMemory[contactId]
            ],
            temperature: 0.7,
            max_tokens: 150
        });

        const reply = response.choices[0].message.content.trim();
        
        // Add AI's reply to memory
        conversationMemory[contactId].push({ role: 'assistant', content: reply });

        return reply;
    } catch (error) {
        console.error("OpenAI API Error:", error);
        return null;
    }
}

module.exports = {
    generateReply
};
