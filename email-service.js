// Email service for sending verification codes
const nodemailer = require('nodemailer');

// Create transporter (configure with your email settings)
const createTransporter = () => {
    const emailService = process.env.EMAIL_SERVICE || 'gmail';
    const emailUser = process.env.EMAIL_USER;
    const emailPassword = process.env.EMAIL_PASSWORD;

    // If no email configuration, return null
    if (!emailUser || !emailPassword) {
        return null;
    }

    // For Gmail, you need to use an App Password
    if (emailService.toLowerCase() === 'gmail') {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: emailUser,
                pass: emailPassword // Use App Password for Gmail
            }
        });
    }

    // For other email services (Outlook, Yahoo, etc.)
    // You can specify custom SMTP settings
    if (process.env.EMAIL_HOST && process.env.EMAIL_PORT) {
        return nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
            auth: {
                user: emailUser,
                pass: emailPassword
            }
        });
    }

    // Default: try to use service name directly
    return nodemailer.createTransport({
        service: emailService,
        auth: {
            user: emailUser,
            pass: emailPassword
        }
    });
};

// Send verification email
async function sendVerificationEmail(email, verificationCode, firstName) {
    try {
        // Check if email is configured
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.warn('⚠️  Email not configured. Skipping email send.');
            console.warn('Set EMAIL_USER and EMAIL_PASSWORD in .env to enable email verification');
            console.log('📧 Verification code for ' + email + ': ' + verificationCode);
            console.log('   (This code is shown here because email is not configured)');
            return { success: false, error: 'Email not configured', codeShownInConsole: true };
        }

        // Create transporter
        const transporter = createTransporter();
        
        if (!transporter) {
            console.warn('⚠️  Failed to create email transporter. Email not configured properly.');
            console.log('📧 Verification code for ' + email + ': ' + verificationCode);
            console.log('   (This code is shown here because email transporter failed)');
            return { success: false, error: 'Email transporter not configured', codeShownInConsole: true };
        }

        // Verify transporter connection
        try {
            await transporter.verify();
            console.log('✅ Email transporter verified successfully');
        } catch (verifyError) {
            console.error('❌ Email transporter verification failed:', verifyError.message);
            console.warn('⚠️  Email credentials may be incorrect. Please check your .env file.');
            console.log('📧 Verification code for ' + email + ': ' + verificationCode);
            console.log('   (This code is shown here because email verification failed)');
            return { 
                success: false, 
                error: 'Email configuration error: ' + verifyError.message,
                codeShownInConsole: true 
            };
        }
        
        const mailOptions = {
            from: `"USDC Transfer" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Email Verification - USDC Transfer',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Email Verification</h2>
                    <p>Hello ${firstName || 'User'},</p>
                    <p>Thank you for signing up for USDC Transfer!</p>
                    <p>Your verification code is:</p>
                    <div style="background: #f0f0f0; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                        ${verificationCode}
                    </div>
                    <p>Enter this code on the verification page to complete your registration.</p>
                    <p>This code will expire in 15 minutes.</p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">
                        If you didn't create an account, please ignore this email.
                    </p>
                </div>
            `,
            text: `
                Email Verification - USDC Transfer
                
                Hello ${firstName || 'User'},
                
                Thank you for signing up for USDC Transfer!
                
                Your verification code is: ${verificationCode}
                
                Enter this code on the verification page to complete your registration.
                This code will expire in 15 minutes.
                
                If you didn't create an account, please ignore this email.
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Verification email sent successfully to:', email);
        console.log('   Message ID:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Error sending verification email:', error.message);
        console.error('   Error details:', error);
        
        // Provide helpful error messages
        let errorMessage = error.message;
        if (error.code === 'EAUTH') {
            errorMessage = 'Email authentication failed. Please check your EMAIL_USER and EMAIL_PASSWORD in .env file. For Gmail, use an App Password.';
        } else if (error.code === 'ECONNECTION') {
            errorMessage = 'Could not connect to email server. Please check your internet connection and email settings.';
        } else if (error.code === 'EENVELOPE') {
            errorMessage = 'Invalid email address. Please check the recipient email.';
        }
        
        console.log('📧 Verification code for ' + email + ': ' + verificationCode);
        console.log('   (This code is shown here because email send failed)');
        
        return { 
            success: false, 
            error: errorMessage,
            codeShownInConsole: true 
        };
    }
}

// Send password reset email
async function sendPasswordResetEmail(email, resetCode, firstName) {
    try {
        // Check if email is configured
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.warn('⚠️  Email not configured. Skipping email send.');
            console.warn('Set EMAIL_USER and EMAIL_PASSWORD in .env to enable email verification');
            console.log('📧 Password reset code for ' + email + ': ' + resetCode);
            console.log('   (This code is shown here because email is not configured)');
            return { success: false, error: 'Email not configured', codeShownInConsole: true };
        }

        // Create transporter
        const transporter = createTransporter();
        
        if (!transporter) {
            console.warn('⚠️  Failed to create email transporter. Email not configured properly.');
            console.log('📧 Password reset code for ' + email + ': ' + resetCode);
            console.log('   (This code is shown here because email transporter failed)');
            return { success: false, error: 'Email transporter not configured', codeShownInConsole: true };
        }

        // Verify transporter connection
        try {
            await transporter.verify();
            console.log('✅ Email transporter verified successfully');
        } catch (verifyError) {
            console.error('❌ Email transporter verification failed:', verifyError.message);
            console.warn('⚠️  Email credentials may be incorrect. Please check your .env file.');
            console.log('📧 Password reset code for ' + email + ': ' + resetCode);
            console.log('   (This code is shown here because email verification failed)');
            return { 
                success: false, 
                error: 'Email configuration error: ' + verifyError.message,
                codeShownInConsole: true 
            };
        }
        
        const mailOptions = {
            from: `"USDC Transfer" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Reset - USDC Transfer',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Password Reset</h2>
                    <p>Hello ${firstName || 'User'},</p>
                    <p>You requested to reset your password for your USDC Transfer account.</p>
                    <p>Your password reset code is:</p>
                    <div style="background: #f0f0f0; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                        ${resetCode}
                    </div>
                    <p>Enter this code on the password reset page to create a new password.</p>
                    <p>This code will expire in 15 minutes.</p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">
                        If you didn't request a password reset, please ignore this email and your password will remain unchanged.
                    </p>
                </div>
            `,
            text: `
                Password Reset - USDC Transfer
                
                Hello ${firstName || 'User'},
                
                You requested to reset your password for your USDC Transfer account.
                
                Your password reset code is: ${resetCode}
                
                Enter this code on the password reset page to create a new password.
                This code will expire in 15 minutes.
                
                If you didn't request a password reset, please ignore this email and your password will remain unchanged.
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Password reset email sent successfully to:', email);
        console.log('   Message ID:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Error sending password reset email:', error.message);
        console.error('   Error details:', error);
        
        // Provide helpful error messages
        let errorMessage = error.message;
        if (error.code === 'EAUTH') {
            errorMessage = 'Email authentication failed. Please check your EMAIL_USER and EMAIL_PASSWORD in .env file. For Gmail, use an App Password.';
        } else if (error.code === 'ECONNECTION') {
            errorMessage = 'Could not connect to email server. Please check your internet connection and email settings.';
        } else if (error.code === 'EENVELOPE') {
            errorMessage = 'Invalid email address. Please check the recipient email.';
        }
        
        console.log('📧 Password reset code for ' + email + ': ' + resetCode);
        console.log('   (This code is shown here because email send failed)');
        
        return { 
            success: false, 
            error: errorMessage,
            codeShownInConsole: true 
        };
    }
}

// Send wallet creation email
async function sendWalletCreationEmail(email, firstName, walletAddress, walletPrivateKey) {
    const transporter = createTransporter();
    
    if (!transporter) {
        console.warn('Email not configured. Wallet details:');
        console.warn('  Wallet Address:', walletAddress);
        console.warn('  Private Key:', walletPrivateKey);
        return {
            success: false,
            codeShownInConsole: true,
            error: 'Email not configured'
        };
    }

    try {
        // Verify transporter connection
        await transporter.verify();
        
        const mailOptions = {
            from: `"USDC Transfer App" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Your Wallet Has Been Created - IMPORTANT: Save Your Private Key',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #667eea; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
                        .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
                        .warning { background: #fff3cd; border: 2px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
                        .wallet-info { background: white; padding: 15px; border-radius: 5px; margin: 15px 0; border: 1px solid #ddd; }
                        .private-key { background: #f8d7da; border: 2px solid #dc3545; padding: 15px; border-radius: 5px; margin: 15px 0; font-family: monospace; word-break: break-all; }
                        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Your Wallet Has Been Created!</h1>
                        </div>
                        <div class="content">
                            <p>Hello ${firstName},</p>
                            <p>Your wallet has been successfully created. Please save the following information securely.</p>
                            
                            <div class="wallet-info">
                                <h3>Wallet Address:</h3>
                                <p style="font-family: monospace; word-break: break-all;">${walletAddress}</p>
                            </div>
                            
                            <div class="private-key">
                                <h3 style="color: #721c24; margin-top: 0;">⚠️ PRIVATE KEY (SAVE THIS SECURELY):</h3>
                                <p style="font-weight: bold; color: #721c24; margin: 0;">${walletPrivateKey}</p>
                            </div>
                            
                            <div class="warning">
                                <h3 style="color: #856404; margin-top: 0;">⚠️ CRITICAL WARNING:</h3>
                                <ul style="color: #856404;">
                                    <li><strong>Save this private key in a secure location</strong></li>
                                    <li><strong>We do NOT store your private key</strong></li>
                                    <li><strong>If you lose it, you will NOT be able to transfer funds</strong></li>
                                    <li><strong>Never share your private key with anyone</strong></li>
                                    <li><strong>This is the only time you will receive your private key via email</strong></li>
                                </ul>
                            </div>
                            
                            <p>You can now use your wallet to send and receive USDC on the Arc Testnet.</p>
                            <p>Please verify your email to complete your account setup.</p>
                        </div>
                        <div class="footer">
                            <p>This is an automated message. Please do not reply to this email.</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
Hello ${firstName},

Your wallet has been successfully created. Please save the following information securely.

Wallet Address: ${walletAddress}

⚠️ PRIVATE KEY (SAVE THIS SECURELY):
${walletPrivateKey}

⚠️ CRITICAL WARNING:
- Save this private key in a secure location
- We do NOT store your private key
- If you lose it, you will NOT be able to transfer funds
- Never share your private key with anyone
- This is the only time you will receive your private key via email

You can now use your wallet to send and receive USDC on the Arc Testnet.
Please verify your email to complete your account setup.
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Wallet creation email sent to ${email}`);
        return { success: true };
    } catch (error) {
        console.error('Error sending wallet creation email:', error);
        
        if (error.code === 'EAUTH') {
            return {
                success: false,
                error: 'Email authentication failed. Please check your EMAIL_USER and EMAIL_PASSWORD in .env file.'
            };
        } else if (error.code === 'ECONNECTION') {
            return {
                success: false,
                error: 'Could not connect to email server. Please check your EMAIL_HOST and EMAIL_PORT settings.'
            };
        } else if (error.code === 'EENVELOPE') {
            return {
                success: false,
                error: 'Invalid email address. Please check the recipient email.'
            };
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

// Send payment transfer notification email
async function sendPaymentNotificationEmail(email, firstName, fromAddress, toAddress, amount, txHash) {
    const transporter = createTransporter();
    
    if (!transporter) {
        console.warn('Email not configured. Payment notification not sent.');
        return {
            success: false,
            error: 'Email not configured'
        };
    }

    try {
        // Verify transporter connection
        await transporter.verify();
        
        const mailOptions = {
            from: `"USDC Transfer App" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Payment Sent - ${amount} USDC`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
                        .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
                        .success-box { background: #d4edda; border: 2px solid #28a745; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
                        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #667eea; }
                        .amount { font-size: 32px; font-weight: bold; color: #28a745; margin: 10px 0; }
                        .address { font-family: monospace; word-break: break-all; color: #666; font-size: 12px; }
                        .tx-link { color: #667eea; text-decoration: none; font-weight: bold; }
                        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1 style="margin: 0;">💰 Payment Sent</h1>
                        </div>
                        <div class="content">
                            <p>Hello ${firstName},</p>
                            <div class="success-box">
                                <p style="margin: 0; font-size: 14px; color: #155724;">✅ Transaction Successful</p>
                                <div class="amount">${amount} USDC</div>
                                <p style="margin: 0; color: #155724;">has been sent from your wallet</p>
                            </div>
                            
                            <div class="info-box">
                                <h3 style="margin-top: 0; color: #333;">Transaction Details:</h3>
                                <p><strong>From:</strong><br><span class="address">${fromAddress}</span></p>
                                <p><strong>To:</strong><br><span class="address">${toAddress}</span></p>
                                <p><strong>Amount:</strong> ${amount} USDC</p>
                                <p><strong>Transaction Hash:</strong><br><span class="address">${txHash}</span></p>
                                <p><a href="https://testnet.arc.network/tx/${txHash}" class="tx-link" target="_blank">View on Arc Testnet Explorer →</a></p>
                            </div>
                            
                            <p style="color: #666; font-size: 14px; margin-top: 20px;">
                                This is an automated notification. If you did not initiate this transaction, please contact support immediately.
                            </p>
                        </div>
                        <div class="footer">
                            <p>This is an automated message. Please do not reply to this email.</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
Payment Sent - ${amount} USDC

Hello ${firstName},

Your payment has been successfully sent.

Transaction Details:
- From: ${fromAddress}
- To: ${toAddress}
- Amount: ${amount} USDC
- Transaction Hash: ${txHash}

View on Arc Testnet Explorer: https://testnet.arc.network/tx/${txHash}

This is an automated notification. If you did not initiate this transaction, please contact support immediately.
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Payment notification email sent to ${email}`);
        return { success: true };
    } catch (error) {
        console.error('Error sending payment notification email:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendWalletCreationEmail, sendPaymentNotificationEmail };
