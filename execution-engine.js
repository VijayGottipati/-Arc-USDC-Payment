// Execution Engine - Executes scheduled payments automatically
const { ethers } = require('ethers');
const { dbHelpers } = require('./database');
const { sendPaymentNotificationEmail } = require('./email-service');

const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';
const NATIVE_DECIMALS = 18;

/**
 * Execution Result
 */
class ExecutionResult {
    constructor(success, transactionId = null, status = 'pending', error = null, raw = {}) {
        this.success = success;
        this.transactionId = transactionId;
        this.status = status;
        this.error = error;
        this.raw = raw;
    }
}

/**
 * Execution Engine - Handles automatic payment execution
 */
class ExecutionEngine {
    /**
     * Execute a scheduled payment
     * @param {Object} scheduledPayment - Scheduled payment record
     * @param {string} privateKey - User's private key (encrypted or plain)
     * @returns {Promise<ExecutionResult>} - Execution result
     */
    async execute(scheduledPayment, privateKey) {
        try {
            console.log('[Execution Engine] Executing payment:', scheduledPayment.id);

            // Get user information
            const user = dbHelpers.getUserById(scheduledPayment.user_id);
            if (!user || !user.wallet_address) {
                return new ExecutionResult(
                    false,
                    null,
                    'failed',
                    'User or wallet not found',
                    {}
                );
            }

            // Validate private key
            let wallet;
            try {
                wallet = new ethers.Wallet(privateKey);
            } catch (error) {
                return new ExecutionResult(
                    false,
                    null,
                    'failed',
                    'Invalid private key format',
                    { error: error.message }
                );
            }

            // Verify private key matches wallet address
            if (wallet.address.toLowerCase() !== user.wallet_address.toLowerCase()) {
                return new ExecutionResult(
                    false,
                    null,
                    'failed',
                    'Private key does not match wallet address',
                    {}
                );
            }

            // Parse amount
            const amount = parseFloat(scheduledPayment.amount);
            if (amount <= 0) {
                return new ExecutionResult(
                    false,
                    null,
                    'failed',
                    'Invalid amount',
                    {}
                );
            }

            // Validate recipient address
            if (!ethers.utils.isAddress(scheduledPayment.to_address)) {
                return new ExecutionResult(
                    false,
                    null,
                    'failed',
                    'Invalid recipient address',
                    {}
                );
            }

            // Check if transferring to self
            if (wallet.address.toLowerCase() === scheduledPayment.to_address.toLowerCase()) {
                return new ExecutionResult(
                    false,
                    null,
                    'failed',
                    'Cannot transfer to own wallet',
                    {}
                );
            }

            // Initialize provider and connect wallet
            const provider = new ethers.providers.JsonRpcProvider(ARC_TESTNET_RPC_URL);
            const connectedWallet = wallet.connect(provider);

            // Convert amount to Wei
            const amountWei = ethers.utils.parseUnits(amount.toString(), NATIVE_DECIMALS);

            // Check balance
            const balance = await connectedWallet.getBalance();
            const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, NATIVE_DECIMALS));

            // Estimate gas
            let estimatedGasCost = ethers.BigNumber.from(0);
            try {
                const gasEstimate = await connectedWallet.estimateGas({
                    to: scheduledPayment.to_address,
                    value: amountWei
                });

                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || await provider.getGasPrice();
                estimatedGasCost = gasEstimate.mul(gasPrice);
            } catch (gasError) {
                console.warn('[Execution Engine] Could not estimate gas:', gasError.message);
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || await provider.getGasPrice();
                estimatedGasCost = ethers.BigNumber.from(21000 * 2).mul(gasPrice);
            }

            // Check if balance is sufficient
            const totalRequired = amountWei.add(estimatedGasCost);

            if (balance.lt(totalRequired)) {
                const availableAfterGas = balance.sub(estimatedGasCost);
                const availableFormatted = parseFloat(ethers.utils.formatUnits(availableAfterGas, NATIVE_DECIMALS));
                const gasCostFormatted = parseFloat(ethers.utils.formatEther(estimatedGasCost));

                return new ExecutionResult(
                    false,
                    null,
                    'failed',
                    `Insufficient balance. Available: ${balanceFormatted.toFixed(6)}, Requested: ${amount}, Estimated gas: ${gasCostFormatted.toFixed(6)}. Maximum transferable: ${availableFormatted.toFixed(6)}`,
                    {
                        balance: balanceFormatted,
                        required: amount,
                        gasCost: gasCostFormatted,
                        available: availableFormatted
                    }
                );
            }

            // Prepare transaction
            const feeData = await provider.getFeeData();

            const txRequest = {
                to: scheduledPayment.to_address,
                value: amountWei
            };

            // Set gas limit
            try {
                const gasEstimate = await connectedWallet.estimateGas(txRequest);
                txRequest.gasLimit = gasEstimate.mul(120).div(100); // 20% buffer
            } catch (estimateError) {
                txRequest.gasLimit = 21000;
            }

            // Set gas price/fees
            if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
                txRequest.maxFeePerGas = feeData.maxFeePerGas;
                txRequest.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
                txRequest.type = 2;
            } else if (feeData.gasPrice) {
                txRequest.gasPrice = feeData.gasPrice;
            }

            // Send transaction
            console.log('[Execution Engine] Sending transaction from', wallet.address, 'to', scheduledPayment.to_address, 'amount:', amount);
            const tx = await connectedWallet.sendTransaction(txRequest);
            console.log('[Execution Engine] Transaction sent:', tx.hash);

            // Wait for confirmation
            const receipt = await tx.wait();
            console.log('[Execution Engine] Transaction confirmed:', receipt.transactionHash);

            // Save payment history as outbound
            try {
                dbHelpers.addPaymentHistory(
                    scheduledPayment.user_id,
                    wallet.address,
                    scheduledPayment.to_address,
                    amount,
                    receipt.transactionHash,
                    'outbound'
                );
                console.log('[Execution Engine] Outbound payment history saved');

                // Create notification for outbound payment
                try {
                    const recipientUser = dbHelpers.getUserByWalletAddress(scheduledPayment.to_address);
                    const recipientName = recipientUser ? recipientUser.username : scheduledPayment.to_address.substring(0, 10) + '...';
                    dbHelpers.createNotification(
                        scheduledPayment.user_id,
                        'payment_outbound',
                        'Automatic Payment Sent',
                        `Your scheduled payment of ${amount} USDC to ${recipientName} was sent automatically`
                    );
                } catch (notifError) {
                    console.error('[Execution Engine] Error creating outbound notification:', notifError);
                }

                // Check if recipient is a registered user and create inbound notification
                try {
                    const recipientUser = dbHelpers.getUserByWalletAddress(scheduledPayment.to_address);
                    if (recipientUser) {
                        const senderUser = dbHelpers.getUserById(scheduledPayment.user_id);
                        const senderName = senderUser ? senderUser.username : wallet.address.substring(0, 10) + '...';
                        dbHelpers.createNotification(
                            recipientUser.id,
                            'payment_inbound',
                            'Payment Received',
                            `You received ${amount} USDC from ${senderName}`
                        );

                        // Also save as inbound payment history for recipient
                        dbHelpers.addPaymentHistory(
                            recipientUser.id,
                            wallet.address,
                            scheduledPayment.to_address,
                            amount,
                            receipt.transactionHash,
                            'inbound'
                        );

                        // Send email notification to recipient
                        try {
                            await sendPaymentNotificationEmail(
                                recipientUser.email,
                                recipientUser.username,
                                amount,
                                senderName,
                                receipt.transactionHash,
                                'inbound'
                            );
                        } catch (emailError) {
                            console.error('[Execution Engine] Error sending recipient email:', emailError);
                        }
                    }
                } catch (inboundError) {
                    console.error('[Execution Engine] Error handling inbound payment:', inboundError);
                }

                // Send email notification to sender
                try {
                    await sendPaymentNotificationEmail(
                        user.email,
                        user.username,
                        amount,
                        scheduledPayment.to_address.substring(0, 10) + '...',
                        receipt.transactionHash,
                        'outbound'
                    );
                } catch (emailError) {
                    console.error('[Execution Engine] Error sending sender email:', emailError);
                }
            } catch (historyError) {
                console.error('[Execution Engine] Error saving payment history:', historyError);
            }

            return new ExecutionResult(
                true,
                receipt.transactionHash,
                'executed',
                null,
                {
                    transactionHash: receipt.transactionHash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString(),
                    amount: amount,
                    from: wallet.address,
                    to: scheduledPayment.to_address
                }
            );
        } catch (error) {
            console.error('[Execution Engine] Error executing payment:', error);
            return new ExecutionResult(
                false,
                null,
                'failed',
                error.message || 'Execution failed',
                { error: error.message, stack: error.stack }
            );
        }
    }

    /**
     * Verify balance before execution
     * @param {string} walletAddress - Wallet address
     * @param {number} requiredAmount - Required amount
     * @returns {Promise<Object>} - Balance check result
     */
    async verifyBalance(walletAddress, requiredAmount) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(ARC_TESTNET_RPC_URL);
            const balance = await provider.getBalance(walletAddress);
            const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, NATIVE_DECIMALS));

            // Estimate gas cost (rough estimate)
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || await provider.getGasPrice();
            const estimatedGasCost = ethers.BigNumber.from(21000 * 2).mul(gasPrice);
            const gasCostFormatted = parseFloat(ethers.utils.formatEther(estimatedGasCost));

            const totalRequired = requiredAmount + gasCostFormatted;
            const isSufficient = balanceFormatted >= totalRequired;

            return {
                success: true,
                balance: balanceFormatted,
                required: requiredAmount,
                gasCost: gasCostFormatted,
                totalRequired: totalRequired,
                isSufficient: isSufficient,
                available: balanceFormatted - gasCostFormatted
            };
        } catch (error) {
            console.error('[Execution Engine] Error verifying balance:', error);
            return {
                success: false,
                error: error.message,
                isSufficient: false
            };
        }
    }
}

module.exports = {
    ExecutionEngine,
    ExecutionResult
};

