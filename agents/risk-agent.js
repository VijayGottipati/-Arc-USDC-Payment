// Risk Management Agent - Handles risk assessment for operations
const { callAI, createSystemMessage, createUserMessage } = require('../ai-service');

const GUARDRIEL_SYSTEM_PROMPT = `You are Guardriel, a security agent for payment transactions. Your job is to assess the risk of payment transactions and approve or reject them.

You must analyze:
1. Transaction amount (is it unusually large?)
2. Recipient address (is it valid? suspicious?)
3. Transaction frequency (is this user making too many transactions?)
4. User behavior patterns (does this match normal behavior?)
5. Transaction context (does the reason make sense?)

Respond ONLY with a JSON object:
{
    "approved": true/false,
    "riskScore": 0.0-1.0,
    "reason": "brief explanation",
    "warnings": ["warning1", "warning2"],
    "requiresConfirmation": true/false
}

Be strict but fair. Reject only if there's a clear security concern.`;

const QUERY_SYSTEM_PROMPT = `You are a Query Agent for a USDC payment system. Your job is to handle non-payment queries and provide helpful responses.

You can:
1. Answer questions about wallet balance
2. Explain payment history
3. Help with contact management
4. Provide general information about the system
5. Answer questions about USDC, blockchain, etc.

Be helpful, accurate, and concise.`;

/**
 * Guardriel Agent - Risk assessment for payment transactions
 * @param {Object} transactionData - Transaction details
 * @param {Object} userContext - User context and history
 * @returns {Promise<Object>} - Risk assessment result
 */
async function assessPaymentRisk(transactionData, userContext = {}) {
    try {
        const { amount, toAddress, fromAddress, reason } = transactionData;
        const { userId, walletAddress, recentTransactions = [], userBalance } = userContext;

        const messages = [
            createSystemMessage(GUARDRIEL_SYSTEM_PROMPT),
            createUserMessage(`Transaction Details:
- Amount: ${amount} USDC
- From: ${fromAddress}
- To: ${toAddress}
- Reason: ${reason || 'Not provided'}
- User Balance: ${userBalance || 'Unknown'} USDC
- Recent Transactions (last 5): ${JSON.stringify(recentTransactions, null, 2)}

Please assess the risk and approve or reject this transaction.`)
        ];

        const response = await callAI(messages, { temperature: 0.2, max_tokens: 500 });
        
        // Parse JSON response
        let riskResult;
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                riskResult = JSON.parse(jsonMatch[0]);
            } else {
                riskResult = JSON.parse(response);
            }
        } catch (parseError) {
            console.error('[Guardriel] Error parsing response:', parseError);
            // Default to requiring confirmation for safety
            riskResult = {
                approved: true,
                riskScore: 0.6,
                reason: 'Unable to assess risk, requiring confirmation',
                warnings: ['Risk assessment failed, manual confirmation required'],
                requiresConfirmation: true
            };
        }

        console.log('[Guardriel] Risk assessment:', riskResult);
        return riskResult;
    } catch (error) {
        console.error('[Guardriel] Error assessing risk:', error);
        // Safe default - require confirmation
        return {
            approved: true,
            riskScore: 0.7,
            reason: 'Error in risk assessment, requiring confirmation',
            warnings: ['Risk assessment error'],
            requiresConfirmation: true
        };
    }
}

/**
 * Query Agent - Handle non-payment queries
 * @param {string} query - User's query
 * @param {Object} context - Available context data
 * @returns {Promise<string>} - AI response
 */
async function handleQuery(query, context = {}) {
    try {
        const contextInfo = `
Available Context:
- User Balance: ${context.balance || 'Not available'}
- Recent Payments: ${context.recentPayments ? JSON.stringify(context.recentPayments, null, 2) : 'Not available'}
- Contacts Count: ${context.contactsCount || 'Not available'}
- Wallet Address: ${context.walletAddress || 'Not available'}
`;

        const messages = [
            createSystemMessage(QUERY_SYSTEM_PROMPT),
            createUserMessage(`User Query: "${query}"\n\n${contextInfo}\n\nPlease provide a helpful response.`)
        ];

        const response = await callAI(messages, { temperature: 0.7, max_tokens: 1000 });
        return response;
    } catch (error) {
        console.error('[Query Agent] Error handling query:', error);
        return 'I apologize, but I encountered an error processing your query. Please try again.';
    }
}

module.exports = {
    assessPaymentRisk,
    handleQuery
};

