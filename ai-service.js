// AI Service wrapper - supports both OpenAI and AIML API
const { OpenAI } = require('openai');

// Support both OpenAI API key and AIML API key
// API key must be provided via environment variables (OPENAI_API_KEY or AI_API_KEY)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_AIML_MODEL = 'qwen3-32b';

// Determine if we should use AIML API (if key starts with '05a6eb' or USE_OPENAI is explicitly false)
const USE_OPENAI = process.env.USE_OPENAI !== 'false' && OPENAI_API_KEY && !OPENAI_API_KEY.startsWith('05a6eb');

// Determine API configuration and model
let apiConfig;
let AI_MODEL_FINAL;

if (!OPENAI_API_KEY) {
  console.error('[AI Service] Error: OPENAI_API_KEY or AI_API_KEY not set in environment variables.');
  console.error('[AI Service] Please set OPENAI_API_KEY in your .env file.');
  throw new Error('OPENAI_API_KEY is required. Please set it in your .env file.');
}

if (USE_OPENAI) {
  // Use OpenAI directly
  apiConfig = {
    apiKey: OPENAI_API_KEY,
  };
  AI_MODEL_FINAL = process.env.AI_MODEL || DEFAULT_OPENAI_MODEL;
  console.log('[AI Service] Using OpenAI API with model:', AI_MODEL_FINAL);
} else {
  // Use AIML API
  apiConfig = {
    baseURL: 'https://api.aimlapi.com/v1',
    apiKey: OPENAI_API_KEY,
  };
  AI_MODEL_FINAL = process.env.AI_MODEL || DEFAULT_AIML_MODEL;
  console.log('[AI Service] Using AIML API with model:', AI_MODEL_FINAL);
}

const api = new OpenAI(apiConfig);

/**
 * Call AI model with messages
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Additional options (temperature, max_tokens, etc.)
 * @returns {Promise<string>} - AI response content
 */
async function callAI(messages, options = {}) {
    try {
        const result = await api.chat.completions.create({
            model: AI_MODEL_FINAL,
            messages: messages,
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || 2000,
            ...options
        });

        const message = result.choices[0].message.content;
        return message;
    } catch (error) {
        console.error('[AI Service] Error calling AI:', error);
        console.error('[AI Service] Error details:', error.response?.data || error.message);
        throw new Error(`AI service error: ${error.message}`);
    }
}

/**
 * Create a system message
 */
function createSystemMessage(content) {
    return {
        role: 'system',
        content: content
    };
}

/**
 * Create a user message
 */
function createUserMessage(content) {
    return {
        role: 'user',
        content: content
    };
}

/**
 * Create an assistant message
 */
function createAssistantMessage(content) {
    return {
        role: 'assistant',
        content: content
    };
}

module.exports = {
    callAI,
    createSystemMessage,
    createUserMessage,
    createAssistantMessage
};

