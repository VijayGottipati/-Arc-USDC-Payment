// Report Analysis Agent - Analyzes payment history and generates reports with charts
const { callAI, createSystemMessage, createUserMessage } = require('../ai-service');

const REPORT_SYSTEM_PROMPT = `You are a Report Analysis Agent for payment transactions. Your job is to analyze payment history and provide insights.

IMPORTANT: You have access to the payment history database. Analyze the actual data provided to you and generate meaningful insights. Do not create fake or example data - use only the real data from the database.

Available Chart Types:
1. Daily Spending Trend (line chart) - Shows daily outbound payments over time
2. Monthly Payment Trend (bar chart) - Shows monthly inbound vs outbound payments
3. Top Recipients (doughnut chart) - Shows top recipients by total amount sent

Analyze the payment history data provided and:
1. Calculate key statistics (total transactions, total inbound, total outbound, average amount, largest transaction)
2. Identify spending patterns (daily, weekly, monthly trends)
3. Identify top recipients
4. Analyze payment frequency
5. Compare inbound vs outbound ratio
6. Identify time-based patterns
7. Detect anomalies or unusual activity

Provide insights in a clear, concise format. The chart data will be automatically generated from the payment history, so you don't need to create it - just analyze what's there.

Respond with a JSON object:
{
    "summary": "overall summary based on actual data",
    "statistics": {
        "totalTransactions": number (from actual data),
        "totalInbound": number (from actual data),
        "totalOutbound": number (from actual data),
        "averageAmount": number (calculated from actual data),
        "largestTransaction": number (from actual data),
        "mostActiveDay": string (calculated from actual data)
    },
    "insights": ["insight1 based on actual patterns", "insight2 based on actual data"],
    "recommendations": ["rec1 based on actual analysis", "rec2 based on actual patterns"]
}

Note: Do NOT include chartData in your response - it will be generated automatically from the payment history data.`;

/**
 * Analyze payment history and generate report
 * @param {Array} paymentHistory - Payment history data
 * @returns {Promise<Object>} - Analysis report
 */
async function generateReport(paymentHistory) {
    try {
        // Process payment history for analysis
        const processedData = processPaymentData(paymentHistory);
        
        // Generate chart data first (this will be used by the AI for analysis)
        const chartData = generateChartData(paymentHistory);

        // Prepare context for AI with actual data and available charts
        const analysisContext = {
            paymentHistory: paymentHistory.map(p => ({
                date: p.created_at,
                amount: parseFloat(p.amount),
                type: p.transaction_type,
                to_address: p.to_address,
                from_address: p.from_address
            })),
            statistics: {
                totalTransactions: processedData.totalTransactions,
                totalInbound: processedData.totalInbound,
                totalOutbound: processedData.totalOutbound,
                averageAmount: processedData.averageAmount,
                largestTransaction: processedData.largestTransaction,
                inboundCount: processedData.inboundCount,
                outboundCount: processedData.outboundCount
            },
            chartDataAvailable: {
                dailySpending: chartData.dailySpending.length > 0,
                monthlyTrend: chartData.monthlyTrend.length > 0,
                topRecipients: chartData.topRecipients.length > 0
            },
            chartSummary: {
                dailySpendingCount: chartData.dailySpending.length,
                monthlyTrendCount: chartData.monthlyTrend.length,
                topRecipientsCount: chartData.topRecipients.length,
                dateRange: paymentHistory.length > 0 ? {
                    earliest: paymentHistory[paymentHistory.length - 1].created_at,
                    latest: paymentHistory[0].created_at
                } : null
            }
        };

        const messages = [
            createSystemMessage(REPORT_SYSTEM_PROMPT),
            createUserMessage(`Payment History Analysis Request:

Available Charts:
- Daily Spending Trend: ${chartData.dailySpending.length} data points
- Monthly Payment Trend: ${chartData.monthlyTrend.length} months
- Top Recipients: ${chartData.topRecipients.length} recipients

Payment Statistics:
- Total Transactions: ${processedData.totalTransactions}
- Total Inbound: ${processedData.totalInbound.toFixed(6)} USDC
- Total Outbound: ${processedData.totalOutbound.toFixed(6)} USDC
- Average Amount: ${processedData.averageAmount.toFixed(6)} USDC
- Largest Transaction: ${processedData.largestTransaction.toFixed(6)} USDC
- Inbound Count: ${processedData.inboundCount}
- Outbound Count: ${processedData.outboundCount}

Payment History Sample (first 10):
${JSON.stringify(paymentHistory.slice(0, 10).map(p => ({
    date: p.created_at,
    amount: p.amount,
    type: p.transaction_type,
    to: p.to_address.substring(0, 10) + '...'
})), null, 2)}

Chart Data Summary:
- Daily Spending: ${chartData.dailySpending.slice(0, 5).map(d => `${d.date}: ${d.amount} USDC`).join(', ')}${chartData.dailySpending.length > 5 ? '...' : ''}
- Monthly Trend: ${chartData.monthlyTrend.slice(0, 3).map(m => `${m.month}: In=${m.inbound.toFixed(2)}, Out=${m.outbound.toFixed(2)}`).join(', ')}${chartData.monthlyTrend.length > 3 ? '...' : ''}
- Top Recipients: ${chartData.topRecipients.slice(0, 3).map(r => `${r.recipient}: ${r.amount.toFixed(2)} USDC`).join(', ')}${chartData.topRecipients.length > 3 ? '...' : ''}

Please analyze this actual payment data and generate a comprehensive report with insights and recommendations based on the real patterns you observe. Focus on:
1. Spending patterns and trends
2. Payment frequency and timing
3. Top recipients analysis
4. Inbound vs outbound balance
5. Any anomalies or notable patterns
6. Actionable recommendations`)
        ];

        const response = await callAI(messages, { temperature: 0.5, max_tokens: 2000 });
        
        let report;
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                report = JSON.parse(jsonMatch[0]);
            } else {
                report = JSON.parse(response);
            }
        } catch (parseError) {
            console.error('[Report Agent] Error parsing response:', parseError);
            console.error('[Report Agent] Raw response:', response);
            // Generate basic report from processed data
            report = generateBasicReport(processedData);
        }

        // Add chart data (generated from actual payment history)
        report.chartData = chartData;
        
        // Ensure statistics match actual data
        if (!report.statistics || !report.statistics.totalTransactions) {
            report.statistics = {
                totalTransactions: processedData.totalTransactions,
                totalInbound: processedData.totalInbound,
                totalOutbound: processedData.totalOutbound,
                averageAmount: processedData.averageAmount,
                largestTransaction: processedData.largestTransaction,
                mostActiveDay: 'N/A'
            };
        }
        
        console.log('[Report Agent] Report generated with AI analysis');
        return report;
    } catch (error) {
        console.error('[Report Agent] Error generating report:', error);
        const processedData = processPaymentData(paymentHistory);
        const report = generateBasicReport(processedData);
        report.chartData = generateChartData(paymentHistory);
        return report;
    }
}

/**
 * Process payment history data for analysis
 */
function processPaymentData(paymentHistory) {
    const inbound = paymentHistory.filter(p => p.transaction_type === 'inbound');
    const outbound = paymentHistory.filter(p => p.transaction_type === 'outbound');
    
    const totalInbound = inbound.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const totalOutbound = outbound.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    
    const amounts = paymentHistory.map(p => parseFloat(p.amount));
    const averageAmount = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
    const largestTransaction = amounts.length > 0 ? Math.max(...amounts) : 0;

    // Group by date
    const byDate = {};
    paymentHistory.forEach(p => {
        const date = new Date(p.created_at).toISOString().split('T')[0];
        if (!byDate[date]) {
            byDate[date] = { inbound: 0, outbound: 0, count: 0 };
        }
        if (p.transaction_type === 'inbound') {
            byDate[date].inbound += parseFloat(p.amount);
        } else {
            byDate[date].outbound += parseFloat(p.amount);
        }
        byDate[date].count++;
    });

    return {
        totalTransactions: paymentHistory.length,
        totalInbound: totalInbound,
        totalOutbound: totalOutbound,
        averageAmount: averageAmount,
        largestTransaction: largestTransaction,
        byDate: byDate,
        inboundCount: inbound.length,
        outboundCount: outbound.length
    };
}

/**
 * Generate basic report if AI fails
 */
function generateBasicReport(processedData) {
    return {
        summary: `You have ${processedData.totalTransactions} total transactions. Total inbound: ${processedData.totalInbound.toFixed(2)} USDC, Total outbound: ${processedData.totalOutbound.toFixed(2)} USDC.`,
        statistics: {
            totalTransactions: processedData.totalTransactions,
            totalInbound: processedData.totalInbound,
            totalOutbound: processedData.totalOutbound,
            averageAmount: processedData.averageAmount,
            largestTransaction: processedData.largestTransaction,
            mostActiveDay: 'N/A'
        },
        insights: [
            `You've sent ${processedData.outboundCount} payments and received ${processedData.inboundCount} payments.`,
            `Average transaction amount: ${processedData.averageAmount.toFixed(2)} USDC.`
        ],
        recommendations: [
            'Review your payment patterns regularly.',
            'Keep track of recurring payments.'
        ],
        chartData: {}
    };
}

/**
 * Generate chart data from payment history
 */
function generateChartData(paymentHistory) {
    // Daily spending chart
    const dailySpending = {};
    paymentHistory.forEach(p => {
        const date = new Date(p.created_at).toISOString().split('T')[0];
        if (!dailySpending[date]) {
            dailySpending[date] = 0;
        }
        if (p.transaction_type === 'outbound') {
            dailySpending[date] += parseFloat(p.amount);
        }
    });

    const dailySpendingArray = Object.entries(dailySpending)
        .map(([date, amount]) => ({ date, amount: parseFloat(amount.toFixed(6)) }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Top recipients
    const recipients = {};
    paymentHistory.forEach(p => {
        if (p.transaction_type === 'outbound') {
            const recipient = p.to_address;
            if (!recipients[recipient]) {
                recipients[recipient] = { amount: 0, count: 0 };
            }
            recipients[recipient].amount += parseFloat(p.amount);
            recipients[recipient].count++;
        }
    });

    const topRecipients = Object.entries(recipients)
        .map(([recipient, data]) => ({
            recipient: recipient.substring(0, 10) + '...' + recipient.substring(recipient.length - 8),
            address: recipient,
            amount: parseFloat(data.amount.toFixed(6)),
            count: data.count
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10);

    // Monthly trend
    const monthlyTrend = {};
    paymentHistory.forEach(p => {
        const date = new Date(p.created_at);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyTrend[month]) {
            monthlyTrend[month] = { inbound: 0, outbound: 0 };
        }
        if (p.transaction_type === 'inbound') {
            monthlyTrend[month].inbound += parseFloat(p.amount);
        } else {
            monthlyTrend[month].outbound += parseFloat(p.amount);
        }
    });

    const monthlyTrendArray = Object.entries(monthlyTrend)
        .map(([month, data]) => ({
            month,
            inbound: parseFloat(data.inbound.toFixed(6)),
            outbound: parseFloat(data.outbound.toFixed(6))
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

    return {
        dailySpending: dailySpendingArray,
        topRecipients: topRecipients,
        monthlyTrend: monthlyTrendArray
    };
}

module.exports = {
    generateReport,
    generateChartData,
    processPaymentData
};

