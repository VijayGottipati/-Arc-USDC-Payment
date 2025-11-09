// Intent Agent - Analyzes user prompts and determines intent
const { callAI, createSystemMessage, createUserMessage } = require('../ai-service');

const INTENT_SYSTEM_PROMPT = `You are an Intent Agent for a USDC payment system. Your job is to analyze user prompts and determine the user's intent.

Available intents:
1. GET_BALANCE - User wants to check their wallet balance
2. GET_PAYMENT_HISTORY - User wants to see payment history (recent, all, inbound, outbound)
3. SEND_PAYMENT - User wants to send a payment/transfer (includes recurring and conditional payments)
4. GET_CONTACTS - User wants to see their contacts
5. ADD_CONTACT - User wants to add a contact
6. ANALYZE_REPORT - User wants to see payment analysis/reports
7. CANCEL_PAYMENT - User wants to cancel a scheduled payment
8. QUERY - General query that doesn't require payment transactions

IMPORTANT: Extract recipient names from prompts. Recipients can be:
- Contact custom names (e.g., "kani", "john")
- Usernames (e.g., "user123")
- Wallet addresses (0x...)

Examples:
- "pay 1 usdc to kani" → intent: SEND_PAYMENT, recipient: "kani", amount: 1
- "1 usd to kani every thursday" → intent: SEND_PAYMENT, recipient: "kani", amount: 1, frequency: "weekly"
- "send to kani 1 usdc if i have at least 10 USDC" → intent: SEND_PAYMENT, recipient: "kani", amount: 1, condition: "balance >= 10"
- "cancel payment" → intent: CANCEL_PAYMENT

Respond ONLY with a JSON object in this exact format:
{
    "intent": "INTENT_NAME",
    "confidence": 0.0-1.0,
    "requiresPayment": true/false,
    "parameters": {
        "amount": null or number,
        "recipient": null or string (name, username, or address),
        "frequency": null or string (for recurring payments: "daily", "weekly", "monthly", "yearly"),
        "condition": null or string (for conditional payments, e.g., "balance >= 10"),
        "filter": null or string (for payment history: "all", "inbound", "outbound", "recent")
    },
    "reasoning": "brief explanation of why this intent was chosen"
}

Be precise and analyze the user's intent carefully. Extract recipient names even if they're not wallet addresses.`;

/**
 * Analyze user prompt and determine intent
 * @param {string} userPrompt - User's input message
 * @param {Object} userContext - User context (userId, walletAddress, etc.)
 * @returns {Promise<Object>} - Intent analysis result
 */
async function analyzeIntent(userPrompt, userContext = {}) {
    try {
        // Get available contacts and usernames for context (only names, no sensitive data)
        const { dbHelpers } = require('../database');
        const userId = userContext.userId;
        let availableRecipients = [];
        
        if (userId) {
            // Get user's contacts (only names)
            const contacts = dbHelpers.getContacts(userId);
            availableRecipients = contacts.map(c => ({
                custom_name: c.custom_name,
                username: c.username,
                type: 'contact'
            }));
            
            // Get all usernames (for reference, no sensitive data)
            const allUsernames = dbHelpers.getAllUsernames();
            availableRecipients = availableRecipients.concat(
                allUsernames
                    .filter(u => u.id !== userId) // Exclude current user
                    .map(u => ({ username: u.username, type: 'user' }))
            );
        }
        
        const messages = [
            createSystemMessage(INTENT_SYSTEM_PROMPT),
            createUserMessage(`User prompt: "${userPrompt}"\n\nUser context: ${JSON.stringify(userContext, null, 2)}\n\nAvailable recipients (contacts and usernames): ${JSON.stringify(availableRecipients, null, 2)}`)
        ];

        let response;
        try {
            response = await callAI(messages, { temperature: 0.3, max_tokens: 500 });
        } catch (error) {
            console.error('[Intent Agent] Error calling AI:', error);
            throw new Error(`Failed to analyze intent: ${error.message}`);
        }
        
        // Parse JSON response
        let intentResult;
        try {
            // Extract JSON from response (handle markdown code blocks)
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                intentResult = JSON.parse(jsonMatch[0]);
            } else {
                intentResult = JSON.parse(response);
            }
        } catch (parseError) {
            console.error('[Intent Agent] Error parsing response:', parseError);
            console.error('[Intent Agent] Raw response:', response);
            // Fallback to default intent
            intentResult = {
                intent: 'QUERY',
                confidence: 0.5,
                requiresPayment: false,
                parameters: {},
                reasoning: 'Failed to parse intent, defaulting to QUERY'
            };
        }

        // Validate intent result
        if (!intentResult.intent) {
            intentResult.intent = 'QUERY';
        }

        console.log('[Intent Agent] Intent analyzed:', intentResult);
        return intentResult;
    } catch (error) {
        console.error('[Intent Agent] Error analyzing intent:', error);
        // Re-throw error so orchestrator can handle it properly
        throw error;
    }
}

module.exports = {
    analyzeIntent
};

