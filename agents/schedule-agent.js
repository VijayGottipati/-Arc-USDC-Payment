// Schedule Agent - Manages recurring, conditional, and scheduled payments
const { callAI, createSystemMessage, createUserMessage } = require('../ai-service');
const Database = require('better-sqlite3');
const path = require('path');
const { ethers } = require('ethers');

const dbPath = path.join(__dirname, '..', 'scheduled_payments.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create scheduled_payments table
db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        payment_type TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        frequency TEXT,
        condition TEXT,
        start_date TEXT,
        end_date TEXT,
        next_execution_date TEXT,
        last_execution_date TEXT,
        execution_count INTEGER DEFAULT 0,
        max_executions INTEGER,
        status TEXT DEFAULT 'active',
        private_key_required INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_user_id ON scheduled_payments(user_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_payments(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_next_execution ON scheduled_payments(next_execution_date);
`);

const SCHEDULE_SYSTEM_PROMPT = `You are a Schedule Agent for payment transactions. Your job is to analyze payment requests and determine if they should be scheduled.

Payment Types:
1. SINGLE - One-time payment (execute immediately or at specific time)
2. RECURRING - Repeating payment (daily, weekly, monthly, etc.)
3. CONDITIONAL - Payment based on conditions (e.g., "when balance > 1000", "on first of month")

For recurring payments, extract:
- frequency: "daily", "weekly", "monthly", "yearly"
- start_date: When to start
- end_date: When to end (optional)
- max_executions: Maximum number of times to execute (optional)

For conditional payments, extract:
- condition: The condition that must be met
- check_interval: How often to check the condition

Respond ONLY with a JSON object:
{
    "shouldSchedule": true/false,
    "paymentType": "SINGLE|RECURRING|CONDITIONAL",
    "frequency": null or "daily|weekly|monthly|yearly",
    "condition": null or condition string,
    "startDate": null or ISO date string,
    "endDate": null or ISO date string,
    "maxExecutions": null or number,
    "executeImmediately": true/false,
    "reasoning": "explanation"
}`;

/**
 * Analyze payment request and determine scheduling
 * @param {Object} paymentData - Payment request data
 * @param {string} userPrompt - Original user prompt
 * @returns {Promise<Object>} - Scheduling analysis
 */
async function analyzeScheduling(paymentData, userPrompt) {
    try {
        // Extract condition from prompt if present
        let conditionType = null;
        let conditionValue = null;
        let condition = null;
        
        // Check for balance conditions: "if I have at least X", "if my balance >= X", etc.
        const balanceConditionMatch = userPrompt.match(/if\s+(?:i\s+have|my\s+balance)\s+(?:at\s+least|>=|>)\s*(\d+\.?\d*)/i);
        if (balanceConditionMatch) {
            conditionType = 'balance';
            conditionValue = parseFloat(balanceConditionMatch[1]);
            condition = `balance >= ${conditionValue}`;
        }
        
        // Check for "every thursday" or specific day patterns
        const thursdayMatch = userPrompt.match(/every\s+thursday/i);
        const dayMatch = userPrompt.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
        
        const messages = [
            createSystemMessage(SCHEDULE_SYSTEM_PROMPT),
            createUserMessage(`Payment Request:
- Amount: ${paymentData.amount} USDC
- To: ${paymentData.recipientName || paymentData.toAddress}
- User Prompt: "${userPrompt}"
${condition ? `- Detected Condition: ${condition}` : ''}
${thursdayMatch || dayMatch ? '- Detected Day Pattern: ' + (dayMatch ? dayMatch[0] : 'every thursday') : ''}

Please analyze if this should be scheduled and determine the payment type. If condition is detected, set paymentType to CONDITIONAL. If day pattern is detected, set frequency to weekly and executeImmediately to true if today matches the day.`)
        ];

        const response = await callAI(messages, { temperature: 0.3, max_tokens: 500 });
        
        let scheduleResult;
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                scheduleResult = JSON.parse(jsonMatch[0]);
            } else {
                scheduleResult = JSON.parse(response);
            }
        } catch (parseError) {
            console.error('[Schedule Agent] Error parsing response:', parseError);
            scheduleResult = {
                shouldSchedule: false,
                paymentType: 'SINGLE',
                executeImmediately: true,
                reasoning: 'Failed to parse scheduling analysis'
            };
        }

        // Override with detected conditions if AI didn't catch them
        if (condition && conditionType && conditionValue) {
            scheduleResult.condition = condition;
            scheduleResult.conditionType = conditionType;
            scheduleResult.conditionValue = conditionValue;
            scheduleResult.paymentType = 'CONDITIONAL';
            scheduleResult.shouldSchedule = true;
        }
        
        // Handle "every thursday" - set to weekly with executeImmediately if today is Thursday
        if (thursdayMatch || (dayMatch && dayMatch[1].toLowerCase() === 'thursday')) {
            const today = new Date();
            const dayOfWeek = today.getDay(); // 0 = Sunday, 4 = Thursday
            scheduleResult.frequency = 'weekly';
            scheduleResult.paymentType = 'RECURRING';
            scheduleResult.shouldSchedule = true;
            scheduleResult.executeImmediately = (dayOfWeek === 4); // Thursday
        } else if (dayMatch) {
            // For other days, set to weekly but don't execute immediately unless it's that day
            scheduleResult.frequency = 'weekly';
            scheduleResult.paymentType = 'RECURRING';
            scheduleResult.shouldSchedule = true;
            scheduleResult.executeImmediately = false;
        }
        
        console.log('[Schedule Agent] Scheduling analysis:', scheduleResult);
        return scheduleResult;
    } catch (error) {
        console.error('[Schedule Agent] Error analyzing scheduling:', error);
        return {
            shouldSchedule: false,
            paymentType: 'SINGLE',
            executeImmediately: true,
            reasoning: 'Error in scheduling analysis'
        };
    }
}

/**
 * Create a scheduled payment
 * @param {Object} paymentData - Payment data
 * @param {Object} scheduleData - Scheduling data from analysis
 * @returns {number} - Scheduled payment ID
 */
function createScheduledPayment(paymentData, scheduleData) {
    const {
        userId,
        toAddress,
        amount,
        paymentType,
        frequency,
        condition,
        conditionType,
        conditionValue,
        startDate,
        endDate,
        maxExecutions,
        executeImmediately
    } = { ...paymentData, ...scheduleData };

    // Build condition string for database
    let conditionStr = condition;
    if (conditionType && conditionValue !== null && conditionValue !== undefined) {
        if (!conditionStr) {
            conditionStr = `${conditionType} >= ${conditionValue}`;
        }
    }
    
    // Calculate next execution date
    let nextExecutionDate = null;
    
    if (paymentType === 'RECURRING' && frequency) {
        // If executeImmediately is true, start today
        if (executeImmediately) {
            nextExecutionDate = new Date().toISOString();
        } else if (startDate) {
            const start = new Date(startDate);
            // If start date is in the past or today, use today
            if (start <= new Date()) {
                nextExecutionDate = new Date().toISOString();
            } else {
                nextExecutionDate = start.toISOString();
            }
        } else {
            // Calculate next occurrence based on frequency
            nextExecutionDate = calculateNextExecutionDate(frequency);
        }
    } else if (paymentType === 'CONDITIONAL') {
        // For conditional, start checking immediately
        nextExecutionDate = new Date().toISOString();
    } else if (paymentType === 'SINGLE' && startDate) {
        nextExecutionDate = new Date(startDate).toISOString();
    } else if (executeImmediately) {
        // Execute immediately
        nextExecutionDate = new Date().toISOString();
    } else {
        // Default: execute immediately
        nextExecutionDate = new Date().toISOString();
    }

    const stmt = db.prepare(`
        INSERT INTO scheduled_payments (
            user_id, payment_type, to_address, amount,
            frequency, condition, start_date, end_date,
            next_execution_date, max_executions, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        userId,
        paymentType,
        toAddress,
        amount.toString(),
        frequency || null,
        conditionStr || null,
        startDate || null,
        endDate || null,
        nextExecutionDate,
        maxExecutions || null,
        'active'
    );

    return result.lastInsertRowid;
}

/**
 * Calculate next execution date based on frequency
 */
function calculateNextExecutionDate(frequency, fromDate = null) {
    const baseDate = fromDate ? new Date(fromDate) : new Date();
    let nextDate = new Date(baseDate);

    switch (frequency.toLowerCase()) {
        case 'daily':
            nextDate.setDate(baseDate.getDate() + 1);
            break;
        case 'weekly':
            nextDate.setDate(baseDate.getDate() + 7);
            break;
        case 'monthly':
            nextDate.setMonth(baseDate.getMonth() + 1);
            break;
        case 'yearly':
            nextDate.setFullYear(baseDate.getFullYear() + 1);
            break;
        default:
            nextDate.setDate(baseDate.getDate() + 1);
    }

    return nextDate.toISOString();
}

/**
 * Get scheduled payments ready for execution
 * @param {number} userId - User ID
 * @returns {Array} - Scheduled payments ready to execute
 */
function getReadyPayments(userId = null) {
    const now = new Date().toISOString();
    let query = `
        SELECT * FROM scheduled_payments
        WHERE status = 'active'
        AND next_execution_date <= ?
    `;
    const params = [now];

    if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
    }

    const stmt = db.prepare(query);
    return stmt.all(...params);
}

/**
 * Update scheduled payment after execution
 * @param {number} paymentId - Payment ID
 * @param {boolean} executed - Whether payment was executed successfully
 * @param {string} errorMessage - Error message if execution failed
 * @param {string} transactionId - Transaction hash if executed successfully
 */
function updateAfterExecution(paymentId, executed = true, errorMessage = null, transactionId = null) {
    const payment = db.prepare('SELECT * FROM scheduled_payments WHERE id = ?').get(paymentId);
    if (!payment) {
        console.error(`[Schedule Agent] Payment ${paymentId} not found`);
        return false;
    }

    const now = new Date().toISOString();
    let nextExecutionDate = null;
    let status = payment.status;
    let executionCount = (payment.execution_count || 0) + (executed ? 1 : 0);

    // Check if max executions reached
    if (payment.max_executions && executionCount >= payment.max_executions) {
        status = 'completed';
        console.log(`[Schedule Agent] Payment ${paymentId} reached max executions (${payment.max_executions})`);
    } else if (payment.payment_type === 'RECURRING' && payment.frequency) {
        // For recurring payments, calculate next execution date based on last execution
        if (executed) {
            // Use current time as base for next execution
            nextExecutionDate = calculateNextExecutionDate(payment.frequency, now);
            status = 'active'; // Keep active for next execution
            console.log(`[Schedule Agent] Recurring payment ${paymentId} executed, next execution: ${nextExecutionDate}`);
        } else {
            // If execution failed, retry later (check again in 5 minutes)
            nextExecutionDate = new Date(Date.now() + 5 * 60000).toISOString();
            status = 'active'; // Keep active to retry
            console.log(`[Schedule Agent] Recurring payment ${paymentId} failed, will retry at: ${nextExecutionDate}`);
        }
    } else if (payment.payment_type === 'CONDITIONAL') {
        // For conditional payments, if executed once, mark as completed
        // Conditional payments execute once when condition is met
        if (executed) {
            status = 'completed';
            nextExecutionDate = null;
            console.log(`[Schedule Agent] Conditional payment ${paymentId} executed successfully, marking as completed`);
        } else {
            // If condition not yet met or execution failed, keep checking
            // Check again in 1 minute for conditions, 5 minutes for execution failures
            const retryDelay = errorMessage && errorMessage.includes('Insufficient balance') ? 5 * 60000 : 60000;
            nextExecutionDate = new Date(Date.now() + retryDelay).toISOString();
            status = 'active'; // Keep active to check condition again
            console.log(`[Schedule Agent] Conditional payment ${paymentId} condition not met or failed, will check again at: ${nextExecutionDate}`);
        }
    } else {
        // For single payments, mark as completed or failed
        if (executed) {
            status = 'completed';
            console.log(`[Schedule Agent] Single payment ${paymentId} executed successfully`);
        } else {
            status = 'failed';
            console.log(`[Schedule Agent] Single payment ${paymentId} failed: ${errorMessage || 'Unknown error'}`);
        }
    }

    // Check end date
    if (payment.end_date && new Date(now) > new Date(payment.end_date)) {
        status = 'completed';
        nextExecutionDate = null;
        console.log(`[Schedule Agent] Payment ${paymentId} reached end date`);
    }

    const stmt = db.prepare(`
        UPDATE scheduled_payments
        SET last_execution_date = ?,
            next_execution_date = ?,
            execution_count = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);

    stmt.run(executed ? now : null, nextExecutionDate, executionCount, status, paymentId);
    console.log(`[Schedule Agent] Updated scheduled payment ${paymentId}: status=${status}, nextExecution=${nextExecutionDate}, executions=${executionCount}, tx=${transactionId || 'N/A'}`);
    return true;
}

/**
 * Get user's scheduled payments
 */
function getUserScheduledPayments(userId) {
    const stmt = db.prepare(`
        SELECT * FROM scheduled_payments
        WHERE user_id = ?
        ORDER BY created_at DESC
    `);
    return stmt.all(userId);
}

/**
 * Delete scheduled payment
 */
function deleteScheduledPayment(userId, paymentId) {
    const stmt = db.prepare('DELETE FROM scheduled_payments WHERE id = ? AND user_id = ?');
    const result = stmt.run(paymentId, userId);
    return result.changes > 0;
}

module.exports = {
    analyzeScheduling,
    createScheduledPayment,
    getReadyPayments,
    updateAfterExecution,
    getUserScheduledPayments,
    deleteScheduledPayment,
    db
};

