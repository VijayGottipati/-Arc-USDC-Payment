// AI Orchestrator - Coordinates all agents
const { analyzeIntent } = require('./intent-agent');
const { assessPaymentRisk, handleQuery } = require('./risk-agent');
const { analyzeScheduling, createScheduledPayment } = require('./schedule-agent');
const { generateReport } = require('./report-agent');
const { dbHelpers } = require('../database');

/**
 * Resolve recipient name to wallet address
 * Tries: 1) Contact custom name, 2) Contact username, 3) Global username, 4) Direct address
 */
function resolveRecipient(userId, recipientName) {
    // If it's already a wallet address, return it
    if (recipientName && recipientName.startsWith('0x') && recipientName.length === 42) {
        return { success: true, address: recipientName, type: 'address', name: recipientName };
    }
    
    // Try to find in user's contacts by custom name or username
    const contact = dbHelpers.getContactByName(userId, recipientName);
    if (contact && contact.final_wallet_address) {
        return {
            success: true,
            address: contact.final_wallet_address,
            type: 'contact',
            name: contact.custom_name || contact.username || recipientName,
            contactId: contact.id
        };
    }
    
    // Try to find by username in global user database (only username, no sensitive data)
    const user = dbHelpers.getUserByUsername(recipientName);
    if (user && user.wallet_address) {
        return {
            success: true,
            address: user.wallet_address,
            type: 'username',
            name: user.username
        };
    }
    
    return { success: false, error: `Recipient "${recipientName}" not found in contacts or users` };
}

/**
 * Main orchestrator function - processes user prompts through agent pipeline
 * @param {string} userPrompt - User's input
 * @param {Object} userContext - User context (userId, session, etc.)
 * @returns {Promise<Object>} - Final response
 */
async function processUserPrompt(userPrompt, userContext) {
    try {
        const { userId, walletAddress } = userContext;

        // Step 1: Intent Agent - Determine what user wants
        console.log('[Orchestrator] Step 1: Analyzing intent...');
        let intentResult;
        try {
            intentResult = await analyzeIntent(userPrompt, userContext);
        } catch (error) {
            console.error('[Orchestrator] Error in Intent Agent:', error);
            return {
                success: false,
                type: 'error',
                message: `Error analyzing your request: ${error.message}. Please try rephrasing your question.`
            };
        }

        // Step 2: Risk Management - Route to appropriate agent
        console.log('[Orchestrator] Step 2: Risk management...');
        let riskResult = null;
        let queryResponse = null;

        if (intentResult.requiresPayment && intentResult.intent === 'SEND_PAYMENT') {
            // Extract payment details from intent or prompt
            let amount = intentResult.parameters.amount;
            let recipientName = intentResult.parameters.recipient;
            
            // If not extracted, try to parse from prompt (fallback)
            if (!amount) {
                const amountMatch = userPrompt.match(/(\d+\.?\d*)\s*(usdc|USDC|usd|USD)/i);
                if (amountMatch) {
                    amount = parseFloat(amountMatch[1]);
                }
            }
            
            // Extract recipient name from prompt if not in intent
            if (!recipientName) {
                // Try to find a name (not a wallet address) in the prompt
                // Look for patterns like "to <name>", "pay <name>", etc.
                const namePatterns = [
                    /(?:to|pay|send to|transfer to)\s+([a-zA-Z0-9_]+)/i,
                    /([a-zA-Z0-9_]+)\s+(?:1|2|3|4|5|6|7|8|9|10|\d+\.?\d*)\s*(?:usdc|USDC|usd|USD)/i
                ];
                
                for (const pattern of namePatterns) {
                    const match = userPrompt.match(pattern);
                    if (match && match[1] && !match[1].startsWith('0x')) {
                        recipientName = match[1];
                        break;
                    }
                }
                
                // Also check for wallet address
                const addressMatch = userPrompt.match(/0x[a-fA-F0-9]{40}/i);
                if (addressMatch && !recipientName) {
                    recipientName = addressMatch[0];
                }
            }
            
            // Validate amount
            if (!amount || isNaN(amount) || amount <= 0) {
                return {
                    success: false,
                    type: 'payment_error',
                    message: 'Please specify a valid amount. For example: "Send 10 USDC to kani"',
                    intent: intentResult
                };
            }
            
            // Resolve recipient name to wallet address
            if (!recipientName) {
                return {
                    success: false,
                    type: 'payment_error',
                    message: 'Please specify a recipient. You can use a contact name, username, or wallet address. For example: "Send 10 USDC to kani"',
                    intent: intentResult
                };
            }
            
            const recipient = resolveRecipient(userId, recipientName);
            if (!recipient.success) {
                return {
                    success: false,
                    type: 'payment_error',
                    message: recipient.error || `Recipient "${recipientName}" not found. Please check the name or use a wallet address.`,
                    intent: intentResult
                };
            }
            
            // Prevent sending to yourself
            if (recipient.address.toLowerCase() === walletAddress.toLowerCase()) {
                return {
                    success: false,
                    type: 'payment_error',
                    message: 'You cannot send money to yourself.',
                    intent: intentResult
                };
            }
            
            // Route to Guardriel Agent for payment risk assessment
            const paymentData = {
                amount: amount,
                toAddress: recipient.address,
                recipientName: recipient.name,
                fromAddress: walletAddress,
                reason: userPrompt
            };

            // Get user's recent transactions for context
            const recentTransactions = dbHelpers.getPaymentHistory(userId, null).slice(0, 5);
            const user = dbHelpers.getUserById(userId);
            
            // Get user balance for risk assessment
            let userBalance = '0';
            try {
                userBalance = await getBalance(user.wallet_address);
            } catch (error) {
                console.error('[Orchestrator] Error fetching balance for risk assessment:', error);
            }
            
            let riskResult;
            try {
                riskResult = await assessPaymentRisk(paymentData, {
                    userId,
                    walletAddress: user.wallet_address,
                    recentTransactions,
                    userBalance: userBalance
                });
            } catch (error) {
                console.error('[Orchestrator] Error in Risk Assessment:', error);
                return {
                    success: false,
                    type: 'error',
                    message: `Error assessing payment risk: ${error.message}. Please try again.`
                };
            }

            if (!riskResult.approved) {
                return {
                    success: false,
                    type: 'payment_rejected',
                    message: `Payment rejected: ${riskResult.reason}`,
                    warnings: riskResult.warnings,
                    intent: intentResult
                };
            }

            // Step 3: Schedule Agent - Check if payment should be scheduled
            if (riskResult.approved) {
                console.log('[Orchestrator] Step 3: Scheduling analysis...');
                let scheduleResult;
                try {
                    scheduleResult = await analyzeScheduling(paymentData, userPrompt);
                } catch (error) {
                    console.error('[Orchestrator] Error in Schedule Agent:', error);
                    // Continue with immediate execution if scheduling fails
                    scheduleResult = {
                        shouldSchedule: false,
                        paymentType: 'SINGLE',
                        executeImmediately: true
                    };
                }

                // Check if this should be scheduled
                if (scheduleResult.shouldSchedule && (scheduleResult.paymentType === 'RECURRING' || scheduleResult.paymentType === 'CONDITIONAL')) {
                    // For conditional payments, check current balance first if condition is about balance
                    if (scheduleResult.paymentType === 'CONDITIONAL' && (scheduleResult.conditionType === 'balance' || scheduleResult.condition)) {
                        try {
                            const currentBalance = parseFloat(await getBalance(walletAddress));
                            const threshold = scheduleResult.conditionValue || 0;
                            
                            if (currentBalance >= threshold) {
                                // Condition already met, can execute immediately or schedule for future check
                                console.log('[Orchestrator] Conditional payment - condition already met (balance:', currentBalance, '>=', threshold, '), scheduling for execution');
                            } else {
                                console.log('[Orchestrator] Conditional payment - condition not yet met (balance:', currentBalance, '<', threshold, '), will execute when condition is met');
                            }
                        } catch (error) {
                            console.error('[Orchestrator] Error checking balance for conditional payment:', error);
                        }
                    }
                    
                    // Create scheduled payment
                    const scheduleId = createScheduledPayment(
                        {
                            userId,
                            toAddress: paymentData.toAddress,
                            amount: paymentData.amount
                        },
                        scheduleResult
                    );

                    let scheduleMessage = `✅ Payment scheduled successfully!\n\n`;
                    scheduleMessage += `Payment Details:\n`;
                    scheduleMessage += `- Amount: ${paymentData.amount} USDC\n`;
                    scheduleMessage += `- Recipient: ${paymentData.recipientName || paymentData.toAddress.substring(0, 10)}...${paymentData.toAddress.substring(paymentData.toAddress.length - 8)}\n`;
                    scheduleMessage += `- Type: ${scheduleResult.paymentType}\n`;
                    
                    if (scheduleResult.paymentType === 'RECURRING') {
                        scheduleMessage += `- Frequency: ${scheduleResult.frequency || 'N/A'}\n`;
                        if (scheduleResult.executeImmediately) {
                            scheduleMessage += `- First payment: Today/Now\n`;
                        }
                    } else if (scheduleResult.paymentType === 'CONDITIONAL') {
                        scheduleMessage += `- Condition: ${scheduleResult.condition || 'N/A'}\n`;
                        scheduleMessage += `- Will execute when condition is met\n`;
                    }
                    
                    scheduleMessage += `\nYour payment will be executed automatically according to the schedule.`;

                    return {
                        success: true,
                        type: 'payment_scheduled',
                        message: scheduleMessage,
                        scheduleId: scheduleId,
                        scheduleData: scheduleResult,
                        intent: intentResult,
                        risk: riskResult
                    };
                } else if (scheduleResult.executeImmediately || !scheduleResult.shouldSchedule || scheduleResult.paymentType === 'SINGLE') {
                    // Execute payment immediately
                    return {
                        success: true,
                        type: 'payment_ready',
                        message: 'Payment approved and ready to execute.',
                        paymentData: paymentData,
                        intent: intentResult,
                        risk: riskResult,
                        schedule: scheduleResult
                    };
                } else {
                    // Require confirmation
                    return {
                        success: true,
                        type: 'payment_confirmation_required',
                        message: 'Payment requires confirmation before execution.',
                        paymentData: paymentData,
                        warnings: riskResult.warnings,
                        intent: intentResult,
                        risk: riskResult
                    };
                }
            }
        } else {
            // Route to Query Agent for non-payment queries
            console.log('[Orchestrator] Routing to Query Agent...');
            
            // Check if this is a query-only request (from dashboard AI query agent)
            const isQueryOnly = userPrompt.includes('QUERY ONLY') || userPrompt.includes('DO NOT PERFORM ANY ACTIONS');
            
            // Gather context
            const user = dbHelpers.getUserById(userId);
            let balance = '0';
            try {
                if (user && user.wallet_address) {
                    balance = await getBalance(user.wallet_address);
                }
            } catch (error) {
                console.error('[Orchestrator] Error fetching balance:', error);
            }
            
            const recentPayments = dbHelpers.getPaymentHistory(userId, null).slice(0, 5);
            const contacts = dbHelpers.getContacts(userId);

            const context = {
                balance: balance,
                recentPayments: recentPayments,
                contactsCount: contacts.length,
                walletAddress: user ? user.wallet_address : null
            };

            // For query-only requests, modify the prompt to emphasize query-only
            const queryPrompt = isQueryOnly ? userPrompt.replace(/\(QUERY ONLY[^)]*\)/gi, '').trim() + ' (Note: This is a query-only request. Do not perform any actions, only provide information and answers.)' : userPrompt;
            
            let queryResponse;
            try {
                queryResponse = await handleQuery(queryPrompt, context);
            } catch (error) {
                console.error('[Orchestrator] Error in Query Agent:', error);
                return {
                    success: false,
                    type: 'error',
                    message: `Error processing your query: ${error.message}. Please try again.`
                };
            }
            
            // If query-only and intent requires payment, return error
            if (isQueryOnly && (intentResult.requiresPayment || intentResult.intent === 'SEND_PAYMENT' || intentResult.intent === 'SCHEDULE_PAYMENT')) {
                return {
                    success: false,
                    type: 'query_only_error',
                    message: 'This is a query-only agent. I can only answer questions and provide information, not perform actions like sending payments. Please use the full AI Assistant for actions.',
                    intent: intentResult
                };
            }

            // Handle specific intents
            if (intentResult.intent === 'GET_BALANCE') {
                return {
                    success: true,
                    type: 'balance',
                    message: queryResponse,
                    balance: balance,
                    intent: intentResult
                };
            } else if (intentResult.intent === 'GET_PAYMENT_HISTORY') {
                const filter = intentResult.parameters.filter || 'all';
                const history = dbHelpers.getPaymentHistory(userId, filter === 'all' ? null : filter);
                return {
                    success: true,
                    type: 'payment_history',
                    message: queryResponse,
                    history: history,
                    filter: filter,
                    intent: intentResult
                };
            } else if (intentResult.intent === 'ANALYZE_REPORT') {
                const history = dbHelpers.getPaymentHistory(userId, null);
                const report = await generateReport(history);
                return {
                    success: true,
                    type: 'report',
                    message: queryResponse,
                    report: report,
                    intent: intentResult
                };
            } else if (intentResult.intent === 'CANCEL_PAYMENT') {
                // Handle cancel payment intent
                const { getUserScheduledPayments, deleteScheduledPayment } = require('./schedule-agent');
                const scheduledPayments = getUserScheduledPayments(userId);
                
                if (scheduledPayments.length === 0) {
                    return {
                        success: false,
                        type: 'cancel_error',
                        message: 'You have no scheduled payments to cancel.',
                        intent: intentResult
                    };
                }
                
                // Try to extract payment ID from prompt
                const paymentIdMatch = userPrompt.match(/(?:payment|id)\s*(\d+)/i) || userPrompt.match(/cancel\s+(\d+)/i);
                let paymentId = paymentIdMatch ? parseInt(paymentIdMatch[1]) : null;
                
                // If payment ID found, cancel it
                if (paymentId) {
                    const deleted = deleteScheduledPayment(userId, paymentId);
                    if (deleted) {
                        return {
                            success: true,
                            type: 'cancel_success',
                            message: `Scheduled payment #${paymentId} has been cancelled and deleted successfully.`,
                            intent: intentResult
                        };
                    } else {
                        return {
                            success: false,
                            type: 'cancel_error',
                            message: `Payment #${paymentId} not found or could not be cancelled.`,
                            intent: intentResult
                        };
                    }
                }
                
                // Otherwise, return list of scheduled payments
                return {
                    success: true,
                    type: 'cancel_payment',
                    message: `You have ${scheduledPayments.length} scheduled payment(s). Please specify which one to cancel by payment ID.\n\nScheduled Payments:\n${scheduledPayments.map(p => `- ID: ${p.id}, Amount: ${p.amount} USDC, Type: ${p.payment_type}${p.frequency ? ', Frequency: ' + p.frequency : ''}${p.condition ? ', Condition: ' + p.condition : ''}`).join('\n')}`,
                    scheduledPayments: scheduledPayments.map(p => ({
                        id: p.id,
                        amount: p.amount,
                        to_address: p.to_address,
                        payment_type: p.payment_type,
                        frequency: p.frequency,
                        condition: p.condition,
                        next_execution_date: p.next_execution_date,
                        status: p.status
                    })),
                    intent: intentResult
                };
            } else {
                return {
                    success: true,
                    type: 'query',
                    message: queryResponse,
                    intent: intentResult
                };
            }
        }
    } catch (error) {
        console.error('[Orchestrator] Unexpected error:', error);
        console.error('[Orchestrator] Error stack:', error.stack);
        
        // Provide a user-friendly error message
        let errorMessage = 'An unexpected error occurred while processing your request.';
        
        if (error.message) {
            if (error.message.includes('AI service error')) {
                errorMessage = 'The AI service is temporarily unavailable. Please try again in a moment.';
            } else if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
                errorMessage = 'Connection timeout. Please check your internet connection and try again.';
            } else if (error.message.includes('API key')) {
                errorMessage = 'AI service configuration error. Please contact support.';
            } else {
                errorMessage = `Error: ${error.message}`;
            }
        }
        
        return {
            success: false,
            type: 'error',
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        };
    }
}

/**
 * Get wallet balance (helper function)
 */
async function getBalance(walletAddress) {
    try {
        const { ethers } = require('ethers');
        const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';
        const provider = new ethers.providers.JsonRpcProvider(ARC_TESTNET_RPC_URL);
        const balance = await provider.getBalance(walletAddress);
        const balanceFormatted = ethers.utils.formatUnits(balance, 18);
        return balanceFormatted;
    } catch (error) {
        console.error('[Orchestrator] Error getting balance:', error);
        return null;
    }
}

module.exports = {
    processUserPrompt
};

