// Payment Scheduler - Executes scheduled payments automatically
const cron = require('node-cron');
const { getReadyPayments, updateAfterExecution } = require('./agents/schedule-agent');
const { dbHelpers } = require('./database');
const { ExecutionEngine } = require('./execution-engine');
const { decryptPrivateKey } = require('./crypto-utils');
const { ethers } = require('ethers');

const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';

// Initialize execution engine
const executionEngine = new ExecutionEngine();

/**
 * Execute a scheduled payment automatically
 * @param {Object} scheduledPayment - Scheduled payment record
 * @returns {Promise<boolean>} - Success status
 */
async function executeScheduledPayment(scheduledPayment) {
    try {
        console.log('[Scheduler] Executing scheduled payment:', scheduledPayment.id);

        // Get user's wallet and auto pay status
        const user = dbHelpers.getUserById(scheduledPayment.user_id);
        if (!user || !user.wallet_address) {
            console.error('[Scheduler] User or wallet not found for payment:', scheduledPayment.id);
            updateAfterExecution(scheduledPayment.id, false, 'User or wallet not found');
            return false;
        }

        // Check if automatic payments are enabled
        const autoPayStatus = dbHelpers.getAutoPayStatus(scheduledPayment.user_id);
        if (!autoPayStatus || !autoPayStatus.enabled || !autoPayStatus.encryptedPrivateKey) {
            console.log('[Scheduler] Automatic payments not enabled for user:', scheduledPayment.user_id);
            console.log('[Scheduler] Payment will be skipped. User needs to enable automatic payments.');
            updateAfterExecution(scheduledPayment.id, false, 'Automatic payments not enabled');
            return false;
        }

        // Decrypt private key
        let privateKey;
        try {
            privateKey = decryptPrivateKey(autoPayStatus.encryptedPrivateKey);
        } catch (decryptError) {
            console.error('[Scheduler] Error decrypting private key:', decryptError);
            updateAfterExecution(scheduledPayment.id, false, 'Failed to decrypt private key');
            return false;
        }

        // Verify balance before execution
        const balanceCheck = await executionEngine.verifyBalance(user.wallet_address, parseFloat(scheduledPayment.amount));
        if (!balanceCheck.success || !balanceCheck.isSufficient) {
            console.log('[Scheduler] Insufficient balance for payment:', scheduledPayment.id);
            console.log('[Scheduler] Balance:', balanceCheck.balance, 'Required:', balanceCheck.totalRequired);
            updateAfterExecution(scheduledPayment.id, false, `Insufficient balance: ${balanceCheck.error || 'Balance check failed'}`);
            return false;
        }

        // Execute payment
        const result = await executionEngine.execute(scheduledPayment, privateKey);

        if (result.success) {
            console.log('[Scheduler] Payment executed successfully:', scheduledPayment.id, 'Tx:', result.transactionId);
            updateAfterExecution(scheduledPayment.id, true, null, result.transactionId);
            return true;
        } else {
            console.error('[Scheduler] Payment execution failed:', scheduledPayment.id, 'Error:', result.error);
            updateAfterExecution(scheduledPayment.id, false, result.error);
            return false;
        }
    } catch (error) {
        console.error('[Scheduler] Error executing scheduled payment:', error);
        updateAfterExecution(scheduledPayment.id, false, error.message);
        return false;
    }
}

/**
 * Check conditional payments
 */
async function checkConditionalPayments() {
    try {
        const conditionalPayments = getReadyPayments().filter(
            p => p.payment_type === 'CONDITIONAL' && p.status === 'active'
        );

        for (const payment of conditionalPayments) {
            // Evaluate condition
            const shouldExecute = await evaluateCondition(payment.condition, payment.user_id);
            
            if (shouldExecute) {
                console.log('[Scheduler] Condition met for payment:', payment.id, 'Executing...');
                // Execute the payment automatically if auto pay is enabled
                await executeScheduledPayment(payment);
            } else {
                // Condition not met yet, update next execution date to check again soon
                const { updateAfterExecution } = require('./agents/schedule-agent');
                updateAfterExecution(payment.id, false, 'Condition not met', null);
            }
        }
    } catch (error) {
        console.error('[Scheduler] Error checking conditional payments:', error);
    }
}

/**
 * Evaluate condition - checks balance conditions
 */
async function evaluateCondition(condition, userId) {
    try {
        if (!condition) return false;
        
        // Get user's wallet address
        const { dbHelpers } = require('./database');
        const user = dbHelpers.getUserById(userId);
        if (!user || !user.wallet_address) {
            console.log('[Scheduler] User or wallet not found for condition evaluation');
            return false;
        }
        
        // Get current balance
        const { ethers } = require('ethers');
        const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';
        const provider = new ethers.providers.JsonRpcProvider(ARC_TESTNET_RPC_URL);
        const balance = await provider.getBalance(user.wallet_address);
        const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, 18));
        
        console.log('[Scheduler] Current balance:', balanceFormatted, 'USDC');
        console.log('[Scheduler] Condition:', condition);
        
        // Parse condition (e.g., "balance >= 10", "balance > 5")
        // Support: balance >= X, balance > X, balance <= X, balance < X
        const balanceMatch = condition.match(/balance\s*(>=|>|<=|<)\s*(\d+\.?\d*)/i);
        if (balanceMatch) {
            const operator = balanceMatch[1];
            const threshold = parseFloat(balanceMatch[2]);
            
            let result = false;
            switch (operator) {
                case '>=':
                    result = balanceFormatted >= threshold;
                    break;
                case '>':
                    result = balanceFormatted > threshold;
                    break;
                case '<=':
                    result = balanceFormatted <= threshold;
                    break;
                case '<':
                    result = balanceFormatted < threshold;
                    break;
            }
            
            console.log('[Scheduler] Condition evaluation:', balanceFormatted, operator, threshold, '=', result);
            return result;
        }
        
        // If condition format not recognized, return false for safety
        console.log('[Scheduler] Condition format not recognized:', condition);
        return false;
    } catch (error) {
        console.error('[Scheduler] Error evaluating condition:', error);
        return false;
    }
}

/**
 * Run scheduler tick - checks and executes due payments
 * This is called periodically by cron
 */
async function runSchedulerTick() {
    try {
        const readyPayments = getReadyPayments();
        console.log('[Scheduler] Tick: Found', readyPayments.length, 'payments ready for execution');

        const processed = [];

        for (const payment of readyPayments) {
            if (payment.payment_type === 'SINGLE' || payment.payment_type === 'RECURRING') {
                const result = await executeScheduledPayment(payment);
                processed.push({
                    paymentId: payment.id,
                    success: result,
                    type: payment.payment_type
                });
            }
        }

        // Check conditional payments
        await checkConditionalPayments();

        return {
            processed: processed.length,
            payments: processed
        };
    } catch (error) {
        console.error('[Scheduler] Error in scheduler tick:', error);
        return {
            processed: 0,
            error: error.message
        };
    }
}

/**
 * Start the scheduler
 */
function startScheduler() {
    // Check for ready payments every minute
    cron.schedule('* * * * *', async () => {
        await runSchedulerTick();
    });

    // Also check conditional payments every 30 seconds
    cron.schedule('*/30 * * * * *', async () => {
        try {
            await checkConditionalPayments();
        } catch (error) {
            console.error('[Scheduler] Error checking conditional payments:', error);
        }
    });

    console.log('[Scheduler] Payment scheduler started (checking every minute, conditional payments every 30 seconds)');
}

module.exports = {
    startScheduler,
    executeScheduledPayment,
    checkConditionalPayments,
    runSchedulerTick
};

