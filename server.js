// Local server for USDC Transfer Application
// Runs without Cloudflare Pages

const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { ethers } = require('ethers');
require('dotenv').config();

// AI API key must be set in environment variables
// Set OPENAI_API_KEY or AI_API_KEY in .env file
if (!process.env.AI_API_KEY && !process.env.OPENAI_API_KEY) {
    console.warn('⚠️  Warning: OPENAI_API_KEY or AI_API_KEY not set in environment variables.');
    console.warn('   AI features will not work without an API key.');
    console.warn('   Please set OPENAI_API_KEY in your .env file.');
}
if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.AI_API_KEY;
}

// Arc Testnet RPC URL
const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';

// Import database
const { db, dbHelpers } = require('./database.js');

// Import email service
const { sendVerificationEmail, sendPasswordResetEmail, sendWalletCreationEmail, sendPaymentNotificationEmail } = require('./email-service.js');

const app = express();

// Create test user in database (if not exists)
(async () => {
    try {
        // Check by email first (since login uses email)
        let testUser = dbHelpers.getUserByEmail('test@example.com');
        if (!testUser) {
            console.log('Creating test user...');
            const testPassword = await bcrypt.hash('test123', 10);
            
            // Create wallet for test user
            const testWallet = ethers.Wallet.createRandom();
            const testWalletAddress = testWallet.address;
            const testWalletPrivateKey = testWallet.privateKey;
            
            const userId = dbHelpers.createUser({
                email: 'test@example.com',
                username: 'testuser',
                password: testPassword,
                first_name: 'Test',
                last_name: 'User',
                gender: null,
                nationality: null,
                phone: null,
                date_of_birth: null,
                email_verified: 1,  // Test user is pre-verified
                verification_code: null,
                verification_code_expires: null,
                wallet_address: testWalletAddress
            });
            // Verify test user is marked as verified
            const verifyStmt = db.prepare('SELECT email_verified FROM users WHERE id = ?');
            const verified = verifyStmt.get(userId);
            if (verified && verified.email_verified !== 1) {
                // Fix it if not verified
                const fixStmt = db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?');
                fixStmt.run(userId);
                console.log('   Fixed: Set email_verified = 1 for test user');
            }
            console.log('✅ Test user created: test@example.com / test123');
            console.log('   User ID:', userId);
            console.log('   Email verified:', verified?.email_verified === 1);
            console.log('   Wallet Address:', testWalletAddress);
            console.log('   ⚠️  TEST USER PRIVATE KEY (SAVE THIS):', testWalletPrivateKey);
            console.log('   ⚠️  WARNING: This private key is shown only once. Save it securely!');
        } else {
            console.log('✅ Test user already exists: test@example.com');
            // Ensure test user is verified (strict check: must be 1)
            if (testUser.email_verified !== 1) {
                const stmt = db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?');
                stmt.run('test@example.com');
                console.log('   Marked test user as verified (email_verified = 1)');
            } else {
                console.log('   Test user is already verified (email_verified = 1)');
            }
            // Create wallet if test user doesn't have one
            if (!testUser.wallet_address) {
                const testWallet = ethers.Wallet.createRandom();
                const testWalletAddress = testWallet.address;
                const testWalletPrivateKey = testWallet.privateKey;
                const updateStmt = db.prepare('UPDATE users SET wallet_address = ? WHERE email = ?');
                updateStmt.run(testWalletAddress, 'test@example.com');
                console.log('   Created wallet for test user:', testWalletAddress);
                console.log('   ⚠️  TEST USER PRIVATE KEY (SAVE THIS):', testWalletPrivateKey);
                console.log('   ⚠️  WARNING: This private key is shown only once. Save it securely!');
            } else {
                console.log('   Wallet Address:', testUser.wallet_address);
            }
        }
    } catch (error) {
        console.error('❌ Error creating test user:', error);
        console.error('   Stack:', error.stack);
    }
})();

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS (before routes)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

// Don't serve static files yet - we'll do that after all routes

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        // For API routes, return JSON error
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized - Please login first'
            });
        }
        // For HTML pages, redirect to login
        return res.redirect('/login.html');
    }
}

// Authentication routes
// POST /api/auth/signup - Create a new user
app.post('/api/auth/signup', async (req, res) => {
    try {
        // Ensure we always return JSON
        res.setHeader('Content-Type', 'application/json');
        
        const {
            email,
            username,
            password,
            firstName,
            lastName,
            gender,
            nationality,
            phone,
            dateOfBirth
        } = req.body;

        // Validate required fields
        if (!email || !username || !password || !firstName || !lastName) {
            return res.status(400).json({
                success: false,
                error: 'Email, username, password, first name, and last name are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // Validate username
        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Username must be at least 3 characters'
            });
        }

        // Validate password
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters'
            });
        }

        // Check if email already exists
        if (dbHelpers.emailExists(email)) {
            return res.status(400).json({
                success: false,
                error: 'An account with this email already exists'
            });
        }

        // Check if username already exists (case-insensitive)
        const normalizedUsername = username.trim();
        if (dbHelpers.usernameExists(normalizedUsername)) {
            return res.status(400).json({
                success: false,
                error: 'Username already taken. Please choose a different username.'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate verification code
        const verificationCode = dbHelpers.generateVerificationCode();
        const verificationCodeExpires = Date.now() + (15 * 60 * 1000); // 15 minutes

        // Create user in database (email_verified defaults to 0 = false, wallet_address will be created after verification)
        let userId;
        try {
            userId = dbHelpers.createUser({
                email: email.toLowerCase().trim(),
                username: normalizedUsername,  // Use normalized username
                password: hashedPassword,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                gender: gender || null,
                nationality: nationality || null,
                phone: phone || null,
                date_of_birth: dateOfBirth || null,
                email_verified: 0,  // Explicitly set to 0 (unverified) for new signups
                verification_code: verificationCode,
                verification_code_expires: verificationCodeExpires,
                wallet_address: null  // Wallet will be created after email verification
            });
        } catch (dbError) {
            // Handle database constraint violations (duplicate username/email)
            if (dbError.message && dbError.message.includes('UNIQUE constraint')) {
                if (dbError.message.includes('username')) {
                    return res.status(400).json({
                        success: false,
                        error: 'Username already taken. Please choose a different username.'
                    });
                } else if (dbError.message.includes('email')) {
                    return res.status(400).json({
                        success: false,
                        error: 'An account with this email already exists'
                    });
                }
            }
            console.error('[SIGNUP] Database error creating user:', dbError);
            throw dbError; // Re-throw to be caught by outer catch
        }

        // Verify user was created with email_verified = 0
        const createdUser = dbHelpers.getUserById(userId);
        if (createdUser && createdUser.email_verified !== 0) {
            console.warn('[SIGNUP] Warning: User created but email_verified is not 0:', createdUser.email_verified);
            // Fix it
            const fixStmt = db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?');
            fixStmt.run(userId);
        }
        console.log('[SIGNUP] User created with ID:', userId, 'Username:', normalizedUsername, 'Email verified:', createdUser?.email_verified === 1);

        // Send verification email
        const emailResult = await sendVerificationEmail(email, verificationCode, firstName);
        let message = 'Account created successfully. ';
        if (emailResult.success) {
            message += 'Please check your email for verification code. Your wallet will be created after email verification.';
        } else if (emailResult.codeShownInConsole) {
            message += 'Email not configured. Please check the verification page for your code.';
        } else {
            message += 'Please check your email for verification code.';
            console.warn('Failed to send verification email, but user created:', emailResult.error);
        }

        res.json({
            success: true,
            message: message,
            userId: userId,
            emailSent: emailResult.success,
            verificationCode: emailResult.codeShownInConsole ? verificationCode : undefined,  // Return code if email not configured
            note: 'Your wallet will be created automatically after you verify your email.'
        });
        } catch (error) {
        console.error('Error signing up:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create account: ' + error.message
        });
    }
});

// POST /api/auth/login - Login user
app.post('/api/auth/login', async (req, res, next) => {
    try {
        console.log('[LOGIN] Request received:', req.method, req.path);
        console.log('[LOGIN] Body:', req.body);
        console.log('[LOGIN] Content-Type:', req.headers['content-type']);
        
        // Ensure we always return JSON
        res.setHeader('Content-Type', 'application/json');
        
        const { email, password } = req.body;

        if (!email || !password) {
            console.log('[LOGIN] Missing credentials');
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        console.log('[LOGIN] Checking user:', normalizedEmail);
        
        // Get user by email from database
        let user;
        try {
            user = dbHelpers.getUserByEmail(normalizedEmail);
            console.log('[LOGIN] Database query result:', user ? `Found user ID ${user.id}` : 'User not found');
        } catch (dbError) {
            console.error('[LOGIN] Database error:', dbError);
            return res.status(500).json({
                success: false,
                error: 'Database error. Please try again later.'
            });
        }
        
        if (!user) {
            console.log('[LOGIN] User not found:', normalizedEmail);
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }
        
        console.log('[LOGIN] User found:', {
            id: user.id,
            email: user.email,
            username: user.username,
            email_verified: user.email_verified,
            is_verified: user.email_verified === 1
        });

        // Verify password first (before checking verification status)
        console.log('[LOGIN] Verifying password');
        let passwordMatch;
        try {
            passwordMatch = await bcrypt.compare(password, user.password);
            console.log('[LOGIN] Password match:', passwordMatch);
        } catch (bcryptError) {
            console.error('[LOGIN] Bcrypt error:', bcryptError);
            return res.status(500).json({
                success: false,
                error: 'Error verifying password. Please try again later.'
            });
        }
        
        if (!passwordMatch) {
            console.log('[LOGIN] Password mismatch for user:', normalizedEmail);
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if email is verified - STRICT CHECK: must be exactly 1 (true)
        if (user.email_verified !== 1) {
            console.log('[LOGIN] Login blocked: Email not verified. email_verified =', user.email_verified);
            console.log('[LOGIN] Password correct, but email not verified. Sending verification code...');
            
            // Generate new verification code
            const verificationCode = dbHelpers.generateVerificationCode();
            const verificationCodeExpires = Date.now() + (15 * 60 * 1000); // 15 minutes

            // Update verification code in database
            dbHelpers.updateVerificationCode(normalizedEmail, verificationCode, verificationCodeExpires);

            // Send verification email
            const emailResult = await sendVerificationEmail(normalizedEmail, verificationCode, user.first_name);
            
            console.log('[LOGIN] Verification code sent for unverified user:', normalizedEmail);

            // Return response indicating need for verification
            const responseData = {
                success: false,
                needsVerification: true,
                email: normalizedEmail,
                message: 'Please verify your email before logging in. A verification code has been sent to your email.',
                emailSent: emailResult.success
            };

            // If email not configured, include code in response
            if (emailResult.codeShownInConsole) {
                responseData.verificationCode = verificationCode;
                responseData.message = 'Please verify your email. Your verification code is shown on the verification page.';
            }

            return res.status(403).json(responseData);
        }

        console.log('[LOGIN] Email verification check passed. User is verified.');

        // Create session
        console.log('[LOGIN] Creating session');
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name
        };
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error('[LOGIN] Session save error:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        console.log('[LOGIN] Success for user:', user.username);
        return res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name
            }
        });
        } catch (error) {
        console.error('[LOGIN] Error:', error);
        // Ensure we return JSON even on error
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                error: 'Failed to login: ' + error.message
            });
        }
        next(error);
    }
});

// POST /api/auth/logout - Logout user
app.post('/api/auth/logout', (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to logout'
                });
            }
        res.json({
            success: true,
                message: 'Logout successful'
            });
        });
    } catch (error) {
        console.error('Error in logout:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to logout'
        });
    }
});

// POST /api/auth/verify-email - Verify email with code
app.post('/api/auth/verify-email', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const { email, verificationCode } = req.body;

        if (!email || !verificationCode) {
            return res.status(400).json({
                success: false,
                error: 'Email and verification code are required'
            });
        }

        const verifiedEmail = dbHelpers.verifyEmail(verificationCode);
        if (!verifiedEmail) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired verification code'
            });
        }

        // Auto-login after verification using the email from verification
        const normalizedEmail = verifiedEmail.toLowerCase().trim();
        const user = dbHelpers.getUserByEmail(normalizedEmail);
        if (!user) {
            console.error('[VERIFY] User not found after verification:', normalizedEmail);
            return res.status(500).json({
                success: false,
                error: 'Verification succeeded but user not found. Please try logging in.'
            });
        }

        // Double-check that email is now verified
        if (user.email_verified !== 1) {
            console.error('[VERIFY] Error: User email_verified is not 1 after verification:', user.email_verified);
            return res.status(500).json({
                success: false,
                error: 'Verification failed. Please try again or contact support.'
            });
        }

        console.log('[VERIFY] User verified successfully:', {
            id: user.id,
            email: user.email,
            username: user.username,
            email_verified: user.email_verified
        });

        // Create wallet for user after verification
        let walletAddress = user.wallet_address;
        let walletPrivateKey = null;
        let walletEmailSent = false;
        
        if (!walletAddress) {
            console.log('[VERIFY] Creating wallet for verified user:', user.email);
            const { ethers } = require('ethers');
            const wallet = ethers.Wallet.createRandom();
            walletAddress = wallet.address;
            walletPrivateKey = wallet.privateKey;

            // Update user with wallet address
            try {
                const updateStmt = db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?');
                updateStmt.run(walletAddress, user.id);
                console.log('[VERIFY] Wallet created and saved for user:', walletAddress);
            } catch (updateError) {
                console.error('[VERIFY] Error updating wallet address:', updateError);
                return res.status(500).json({
                    success: false,
                    error: 'Verification succeeded but failed to create wallet. Please contact support.'
                });
            }

            // Send wallet creation email
            try {
                const walletEmailResult = await sendWalletCreationEmail(user.email, user.first_name || 'User', walletAddress, walletPrivateKey);
                walletEmailSent = walletEmailResult.success;
                if (walletEmailResult.success) {
                    console.log('[VERIFY] Wallet creation email sent to:', user.email);
                } else {
                    console.warn('[VERIFY] Failed to send wallet creation email:', walletEmailResult.error);
                }
            } catch (emailError) {
                console.error('[VERIFY] Error sending wallet creation email:', emailError);
                walletEmailSent = false;
            }
        } else {
            console.log('[VERIFY] User already has wallet:', walletAddress);
        }

        // Create session
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name
        };
        
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error('[VERIFY] Session save error:', err);
                    reject(err);
                } else {
                    console.log('[VERIFY] Session created for verified user:', user.username);
                    resolve();
                }
            });
        });

        // Prepare response
        const responseData = {
            success: true,
            message: 'Email verified successfully. Your wallet has been created!',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name
            },
            wallet: {
                address: walletAddress
            },
            walletEmailSent: walletEmailSent
        };

        // If wallet was just created and email not sent, include private key in response
        if (walletPrivateKey && !walletEmailSent) {
            responseData.wallet.privateKey = walletPrivateKey;
            responseData.warning = '⚠️ IMPORTANT: Save your private key securely! If you lose it, you will NOT be able to transfer funds from your wallet. We do NOT store your private key.';
        } else if (walletPrivateKey && walletEmailSent) {
            responseData.message += ' Please check your email for your wallet details and private key.';
        }

        res.json(responseData);
    } catch (error) {
        console.error('Error verifying email:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify email: ' + error.message
        });
    }
});

// POST /api/auth/resend-verification - Resend verification code
app.post('/api/auth/resend-verification', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = dbHelpers.getUserByEmail(normalizedEmail);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Check if already verified
        if (user.email_verified === 1) {
            return res.status(400).json({
                success: false,
                error: 'Email is already verified'
            });
        }

        // Generate new verification code
        const verificationCode = dbHelpers.generateVerificationCode();
        const verificationCodeExpires = Date.now() + (15 * 60 * 1000); // 15 minutes

        // Update verification code in database
        dbHelpers.updateVerificationCode(normalizedEmail, verificationCode, verificationCodeExpires);

        // Send verification email
        const emailResult = await sendVerificationEmail(normalizedEmail, verificationCode, user.first_name);
        
        console.log('[RESEND] Verification code resent for:', normalizedEmail);

        if (emailResult.success) {
    res.json({
        success: true,
                message: 'Verification code sent to your email',
                emailSent: true
            });
        } else if (emailResult.codeShownInConsole) {
            // Email not configured - return code to display on page
            res.json({
                success: true,
                message: 'Email not configured. Your verification code is shown below.',
                emailSent: false,
                verificationCode: verificationCode
            });
        } else {
            // Email send failed
            res.json({
                success: false,
                error: 'Failed to send email. Please try again later.',
                emailSent: false
            });
        }
    } catch (error) {
        console.error('Error resending verification code:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resend verification code: ' + error.message
        });
    }
});

// POST /api/auth/forgot-password - Send password reset code
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = dbHelpers.getUserByEmail(normalizedEmail);
        
        if (!user) {
            // Don't reveal if user exists or not for security
            return res.json({
                success: true,
                message: 'If an account exists with this email, a password reset code has been sent.'
            });
        }

        // Generate password reset code
        const resetCode = dbHelpers.generateVerificationCode();
        const resetCodeExpires = Date.now() + (15 * 60 * 1000); // 15 minutes

        // Update verification code in database
        dbHelpers.updateVerificationCode(normalizedEmail, resetCode, resetCodeExpires);

        // Send password reset email
        const emailResult = await sendPasswordResetEmail(normalizedEmail, resetCode, user.first_name);
        
        console.log('[FORGOT-PASSWORD] Reset code sent for:', normalizedEmail);

        if (emailResult.success) {
            res.json({
                success: true,
                message: 'Password reset code sent to your email',
                emailSent: true
            });
        } else if (emailResult.codeShownInConsole) {
            // Email not configured - return code to display on page
            res.json({
                success: true,
                message: 'Email not configured. Your reset code is shown on the reset page.',
                emailSent: false,
                verificationCode: resetCode
            });
        } else {
            // Email send failed
            res.json({
                success: true,
                message: 'If an account exists with this email, a password reset code has been sent.',
                emailSent: false
            });
        }
    } catch (error) {
        console.error('Error in forgot password:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process password reset request: ' + error.message
        });
    }
});

// POST /api/auth/reset-password - Reset password with verification code
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const { email, verificationCode, newPassword } = req.body;

        if (!email || !verificationCode || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Email, verification code, and new password are required'
            });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters'
            });
        }
        
        const normalizedEmail = email.toLowerCase().trim();
        
        // Verify reset code
        const verifiedEmail = dbHelpers.verifyResetCode(verificationCode);
        if (!verifiedEmail || verifiedEmail !== normalizedEmail) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired verification code'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        const updated = dbHelpers.updatePassword(normalizedEmail, hashedPassword);
        if (!updated) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update password. Please try again.'
            });
        }

        console.log('[RESET-PASSWORD] Password reset successful for:', normalizedEmail);
                
                res.json({
                    success: true,
            message: 'Password reset successfully. Please login with your new password.'
                });
            } catch (error) {
        console.error('Error resetting password:', error);
                res.status(500).json({
                    success: false,
            error: 'Failed to reset password: ' + error.message
        });
    }
});

// Wallet configuration removed - each user has their own wallet

// GET /api/auth/check - Check if user is authenticated (public endpoint)
app.get('/api/auth/check', (req, res) => {
    if (req.session && req.session.user) {
        res.json({
            success: true,
            authenticated: true,
            user: req.session.user
        });
        } else {
        res.json({
            success: true,
            authenticated: false
        });
    }
});

// Protected API routes
// GET /api/health - Health check (protected)
app.get('/api/health', requireAuth, async (req, res) => {
    try {
        const user = dbHelpers.getUserById(req.session.user.id);
        res.json({
            success: true,
            status: 'OK',
            network: 'Arc Testnet',
            rpcUrl: ARC_TESTNET_RPC_URL,
            userWallet: user ? user.wallet_address : null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/wallet - Get user's wallet address (protected)
app.get('/api/wallet', requireAuth, (req, res) => {
    try {
        const user = dbHelpers.getUserById(req.session.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        if (!user.wallet_address) {
            return res.status(404).json({
                success: false,
                error: 'Wallet not found. Please verify your email to create your wallet.'
            });
        }

        res.json({
            success: true,
            walletAddress: user.wallet_address
        });
    } catch (error) {
        console.error('Error getting wallet:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/balance - Get user's wallet balance (protected)
app.get('/api/balance', requireAuth, async (req, res) => {
    try {
        const user = dbHelpers.getUserById(req.session.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        if (!user.wallet_address) {
            return res.status(404).json({
                success: false,
                error: 'Wallet not found. Please verify your email to create your wallet.'
            });
        }

        const NATIVE_DECIMALS = 18;

        // Initialize provider
        const provider = new ethers.providers.JsonRpcProvider(ARC_TESTNET_RPC_URL);

        // Get balance
        const balance = await provider.getBalance(user.wallet_address);
        
        // Convert from wei to ETH/USDC
        const balanceFormatted = ethers.utils.formatUnits(balance, NATIVE_DECIMALS);
        
        res.json({
            success: true,
            walletAddress: user.wallet_address,
            balance: balanceFormatted
        });
    } catch (error) {
        console.error('Error getting balance:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/transfer - Transfer funds from user's wallet (protected)
app.post('/api/transfer', requireAuth, async (req, res) => {
    try {
        const { toAddress, amount, privateKey } = req.body;
        
        // Validate inputs
        if (!toAddress || !amount || !privateKey) {
                return res.status(400).json({
                    success: false,
                error: 'Missing required fields: toAddress, amount, privateKey'
            });
        }
        
        if (amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Amount must be greater than 0'
            });
        }

        // Validate Ethereum address format
        if (!ethers.utils.isAddress(toAddress)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid recipient address format'
            });
        }

        // Get user's wallet address from database
        const user = dbHelpers.getUserById(req.session.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        if (!user.wallet_address) {
            return res.status(404).json({
                success: false,
                error: 'Wallet not found. Please verify your email to create your wallet.'
            });
        }

        // Validate private key by creating wallet and checking address
        let wallet;
        try {
            wallet = new ethers.Wallet(privateKey);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid private key format'
            });
        }

        // Verify that the private key matches the user's wallet address
        if (wallet.address.toLowerCase() !== user.wallet_address.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'Private key does not match your wallet address. Please enter the correct private key.'
            });
        }

        // Check if transferring to same address
        if (wallet.address.toLowerCase() === toAddress.toLowerCase()) {
            return res.status(400).json({
                success: false,
                error: 'Cannot transfer to your own wallet'
            });
        }
        
        const NATIVE_DECIMALS = 18;
        const amountWei = ethers.utils.parseUnits(amount.toString(), NATIVE_DECIMALS);
        
        // Initialize provider and connect wallet
        const provider = new ethers.providers.JsonRpcProvider(ARC_TESTNET_RPC_URL);
        const connectedWallet = wallet.connect(provider);
            
            // Check balance
        const balance = await connectedWallet.getBalance();
        const balanceFormatted = ethers.utils.formatUnits(balance, NATIVE_DECIMALS);
            
        // Estimate gas
            let estimatedGasCost = ethers.BigNumber.from(0);
            try {
            const gasEstimate = await connectedWallet.estimateGas({
                    to: toAddress,
                    value: amountWei
                });
                
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || await provider.getGasPrice();
                estimatedGasCost = gasEstimate.mul(gasPrice);
            } catch (gasError) {
                console.warn('Could not estimate gas:', gasError.message);
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || await provider.getGasPrice();
                estimatedGasCost = ethers.BigNumber.from(21000 * 2).mul(gasPrice);
            }
            
        // Check if balance is sufficient
            const totalRequired = amountWei.add(estimatedGasCost);
            
            if (balance.lt(totalRequired)) {
                const availableAfterGas = balance.sub(estimatedGasCost);
            const availableFormatted = ethers.utils.formatUnits(availableAfterGas, NATIVE_DECIMALS);
            const gasCostFormatted = ethers.utils.formatEther(estimatedGasCost);
                
                return res.status(400).json({
                    success: false,
                error: `Insufficient balance. Available: ${parseFloat(balanceFormatted).toFixed(6)}, Requested: ${amount}, Estimated gas: ${parseFloat(gasCostFormatted).toFixed(6)}. Maximum transferable: ${parseFloat(availableFormatted).toFixed(6)}`
            });
        }
        
        // Send transaction
        try {
                const feeData = await provider.getFeeData();
                
                const txRequest = {
                    to: toAddress,
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
                
            console.log('[TRANSFER] Sending transaction from', wallet.address, 'to', toAddress, 'amount:', amount);
            const tx = await connectedWallet.sendTransaction(txRequest);
            console.log('[TRANSFER] Transaction sent:', tx.hash);
                
                const receipt = await tx.wait();
            console.log('[TRANSFER] Transaction confirmed:', receipt.transactionHash);
            
            // Save payment history as outbound
            try {
                dbHelpers.addPaymentHistory(
                    req.session.user.id,
                    wallet.address,
                    toAddress,
                    amount,
                    receipt.transactionHash,
                    'outbound'
                );
                console.log('[TRANSFER] Outbound payment history saved');
                
                // Create notification for outbound payment
                try {
                    const recipientUser = dbHelpers.getUserByWalletAddress(toAddress);
                    const recipientName = recipientUser ? recipientUser.username : toAddress.substring(0, 10) + '...';
                    dbHelpers.createNotification(
                        req.session.user.id,
                        'payment_outbound',
                        'Payment Sent',
                        `You sent ${amount} USDC to ${recipientName}`
                    );
                } catch (notifError) {
                    console.error('[TRANSFER] Error creating outbound notification:', notifError);
                }
                
                // Check if this payment matches a scheduled payment and update schedule
                try {
                    const scheduleAgent = require('./agents/schedule-agent');
                    const scheduledPayments = scheduleAgent.getUserScheduledPayments(req.session.user.id);
                    
                    // Find matching scheduled payment (same user, same to address, same amount, active status)
                    const matchingPayment = scheduledPayments.find(sp => 
                        sp.user_id === req.session.user.id &&
                        sp.to_address.toLowerCase() === toAddress.toLowerCase() &&
                        parseFloat(sp.amount) === parseFloat(amount) &&
                        sp.status === 'active'
                    );
                    
                    if (matchingPayment) {
                        console.log('[TRANSFER] Found matching scheduled payment:', matchingPayment.id);
                        
                        // Update the scheduled payment
                        if (matchingPayment.payment_type === 'RECURRING') {
                            // For recurring payments, update execution and schedule next
                            scheduleAgent.updateAfterExecution(matchingPayment.id, true);
                            console.log('[TRANSFER] Recurring payment executed, next execution scheduled');
                        } else if (matchingPayment.payment_type === 'CONDITIONAL') {
                            // For conditional payments, mark as executed and check if condition still met
                            // If condition still met and it's meant to be recurring, schedule next
                            scheduleAgent.updateAfterExecution(matchingPayment.id, true);
                            console.log('[TRANSFER] Conditional payment executed');
                        } else {
                            // For single payments, mark as completed
                            scheduleAgent.updateAfterExecution(matchingPayment.id, true);
                            // The updateAfterExecution will mark it as completed if it's a single payment
                            console.log('[TRANSFER] Single scheduled payment executed and marked as completed');
                        }
                    }
                } catch (scheduleError) {
                    console.error('[TRANSFER] Error updating scheduled payment:', scheduleError);
                    // Don't fail the transaction if schedule update fails
                }
            } catch (historyError) {
                console.error('[TRANSFER] Error saving payment history:', historyError);
                // Don't fail the transaction if history save fails
            }

            // Check if recipient is a registered user and create inbound transaction for them
            try {
                const recipientUser = dbHelpers.getUserByWalletAddress(toAddress);
                if (recipientUser && recipientUser.id !== req.session.user.id) {
                    dbHelpers.addPaymentHistory(
                        recipientUser.id,
                        wallet.address,
                        toAddress,
                        amount,
                        receipt.transactionHash,
                        'inbound'
                    );
                    console.log('[TRANSFER] Inbound payment history saved for recipient:', recipientUser.email);
                    
                    // Create notification for inbound payment
                    try {
                        const senderUser = dbHelpers.getUserById(req.session.user.id);
                        const senderName = senderUser ? senderUser.username : wallet.address.substring(0, 10) + '...';
                        dbHelpers.createNotification(
                            recipientUser.id,
                            'payment_inbound',
                            'Payment Received',
                            `You received ${amount} USDC from ${senderName}`
                        );
                    } catch (notifError) {
                        console.error('[TRANSFER] Error creating inbound notification:', notifError);
                    }
                }
            } catch (inboundError) {
                console.error('[TRANSFER] Error saving inbound payment history:', inboundError);
                // Don't fail the transaction if inbound history save fails
            }

            // Send payment notification email
            try {
                const user = dbHelpers.getUserById(req.session.user.id);
                if (user && user.email) {
                    const emailResult = await sendPaymentNotificationEmail(
                        user.email,
                        user.first_name || 'User',
                        wallet.address,
                        toAddress,
                        amount.toString(),
                        receipt.transactionHash
                    );
                    if (emailResult.success) {
                        console.log('[TRANSFER] Payment notification email sent to:', user.email);
                    } else {
                        console.warn('[TRANSFER] Failed to send payment notification email:', emailResult.error);
                    }
                }
            } catch (emailError) {
                console.error('[TRANSFER] Error sending payment notification email:', emailError);
                // Don't fail the transaction if email send fails
            }
                
                res.json({
                    success: true,
                    txHash: receipt.transactionHash,
                    amount: amount,
                from: wallet.address,
                    to: toAddress,
                    method: 'blockchain'
                });
            } catch (txError) {
                console.error('Transaction error:', txError);
                let errorMessage = txError.message;
                if (txError.error && txError.error.message) {
                    errorMessage = txError.error.message;
                } else if (txError.reason) {
                    errorMessage = txError.reason;
                }
                
            res.status(500).json({
                success: false,
                error: `Transaction failed: ${errorMessage}`
            });
        }
    } catch (error) {
        console.error('Error transferring funds:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/profile - Get user profile (protected)
app.get('/api/profile', requireAuth, (req, res) => {
    try {
        const user = dbHelpers.getUserById(req.session.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Return user profile (exclude password)
        res.json({
            success: true,
            profile: {
                id: user.id,
                email: user.email,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
                gender: user.gender,
                nationality: user.nationality,
                phone: user.phone,
                dateOfBirth: user.date_of_birth,
                walletAddress: user.wallet_address,
                emailVerified: user.email_verified === 1,
                createdAt: user.created_at,
                updatedAt: user.updated_at
            }
        });
    } catch (error) {
        console.error('Error getting profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// PUT /api/profile - Update user profile (protected)
app.put('/api/profile', requireAuth, async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const {
            username,
            firstName,
            lastName,
            gender,
            nationality,
            phone,
            dateOfBirth
        } = req.body;

        const userId = req.session.user.id;
        const currentUser = dbHelpers.getUserById(userId);
        
        if (!currentUser) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Validate required fields
        if (!username || !firstName || !lastName) {
                    return res.status(400).json({
                        success: false,
                error: 'Username, first name, and last name are required'
            });
        }

        // Check if username is being changed and if it's already taken
        const normalizedUsername = username.trim();
        if (normalizedUsername.toLowerCase() !== currentUser.username.toLowerCase()) {
            if (dbHelpers.usernameExists(normalizedUsername)) {
                return res.status(400).json({
                    success: false,
                    error: 'Username already taken. Please choose a different username.'
                });
            }
        }

        // Update user profile (wallet_address and email are not updatable)
        try {
            const updated = dbHelpers.updateUserProfile(userId, {
                username: normalizedUsername,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                gender: gender || null,
                nationality: nationality || null,
                phone: phone || null,
                date_of_birth: dateOfBirth || null
            });

            if (!updated) {
                return res.status(400).json({
                    success: false,
                    error: 'Failed to update profile'
                });
            }

            // Get updated user
            const updatedUser = dbHelpers.getUserById(userId);
            
            // Update session with new user data
            req.session.user = {
                id: updatedUser.id,
                email: updatedUser.email,
                username: updatedUser.username,
                firstName: updatedUser.first_name,
                lastName: updatedUser.last_name
            };

            res.json({
                success: true,
                message: 'Profile updated successfully',
                profile: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    username: updatedUser.username,
                    firstName: updatedUser.first_name,
                    lastName: updatedUser.last_name,
                    gender: updatedUser.gender,
                    nationality: updatedUser.nationality,
                    phone: updatedUser.phone,
                    dateOfBirth: updatedUser.date_of_birth,
                    walletAddress: updatedUser.wallet_address,
                    emailVerified: updatedUser.email_verified === 1,
                    createdAt: updatedUser.created_at,
                    updatedAt: updatedUser.updated_at
                }
            });
        } catch (dbError) {
            if (dbError.message && dbError.message.includes('UNIQUE constraint')) {
                if (dbError.message.includes('username')) {
                    return res.status(400).json({
                        success: false,
                        error: 'Username already taken. Please choose a different username.'
                    });
                }
            }
            throw dbError;
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile: ' + error.message
        });
    }
});

// DELETE /api/profile - Delete user account (protected)
app.delete('/api/profile', requireAuth, (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const userId = req.session.user.id;
        
        // Delete user account (will cascade to contacts and payment_history)
        const deleted = dbHelpers.deleteUser(userId);
        
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
            }
        });

        res.json({
            success: true,
            message: 'Account deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete account: ' + error.message
        });
    }
});

// POST /api/auto-pay/enable - Enable automatic payments (protected)
app.post('/api/auto-pay/enable', requireAuth, async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const userId = req.session.user.id;
        const { privateKey } = req.body;
        
        if (!privateKey) {
            return res.status(400).json({
                success: false,
                error: 'Private key is required'
            });
        }

        // Get user to verify wallet address
        const user = dbHelpers.getUserById(userId);
        if (!user || !user.wallet_address) {
            return res.status(404).json({
                success: false,
                error: 'User wallet not found'
            });
        }

        // Validate private key by creating wallet
        const { ethers } = require('ethers');
        let wallet;
        try {
            wallet = new ethers.Wallet(privateKey);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid private key format'
            });
        }

        // Verify private key matches wallet address
        if (wallet.address.toLowerCase() !== user.wallet_address.toLowerCase()) {
            return res.status(403).json({
                success: false,
                error: 'Private key does not match your wallet address'
            });
        }

        // Encrypt and store private key
        const { encryptPrivateKey } = require('./crypto-utils');
        const encryptedKey = encryptPrivateKey(privateKey);
        
        const enabled = dbHelpers.enableAutoPay(userId, encryptedKey);
        
        if (enabled) {
            res.json({
                success: true,
                message: 'Automatic payments enabled successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to enable automatic payments'
            });
        }
    } catch (error) {
        console.error('Error enabling automatic payments:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to enable automatic payments: ' + error.message
        });
    }
});

// POST /api/auto-pay/disable - Disable automatic payments (protected)
app.post('/api/auto-pay/disable', requireAuth, (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const userId = req.session.user.id;
        
        const disabled = dbHelpers.disableAutoPay(userId);
        
        if (disabled) {
            res.json({
                success: true,
                message: 'Automatic payments disabled successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to disable automatic payments'
            });
        }
    } catch (error) {
        console.error('Error disabling automatic payments:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disable automatic payments: ' + error.message
        });
    }
});

// GET /api/auto-pay/status - Get automatic payment status (protected)
app.get('/api/auto-pay/status', requireAuth, (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const userId = req.session.user.id;
        const status = dbHelpers.getAutoPayStatus(userId);
        
        res.json({
            success: true,
            enabled: status ? status.enabled : false
        });
    } catch (error) {
        console.error('Error getting automatic payment status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get automatic payment status: ' + error.message
        });
    }
});

// POST /api/scheduler/tick - Manually trigger scheduler tick (for testing, protected)
app.post('/api/scheduler/tick', requireAuth, async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const { runSchedulerTick } = require('./scheduler');
        const result = await runSchedulerTick();
        
        res.json({
            success: true,
            processed: result.processed,
            payments: result.payments,
            error: result.error || null
        });
    } catch (error) {
        console.error('Error running scheduler tick:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to run scheduler tick: ' + error.message
        });
    }
});

// GET /api/payment-history - Get payment history (protected)
app.get('/api/payment-history', requireAuth, (req, res) => {
    try {
        const user = dbHelpers.getUserById(req.session.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Get filter type from query parameter (inbound, outbound, or all)
        const filterType = req.query.filter || null;
        const limit = req.query.limit ? parseInt(req.query.limit) : null;

        console.log('[PAYMENT-HISTORY] Request - userId:', req.session.user.id, 'filterType:', filterType, 'limit:', limit);

        let history = dbHelpers.getPaymentHistory(req.session.user.id, filterType);
        
        console.log('[PAYMENT-HISTORY] Retrieved', history.length, 'transactions with filter:', filterType || 'all');
        
        // Apply limit if specified
        if (limit && limit > 0) {
            history = history.slice(0, limit);
            console.log('[PAYMENT-HISTORY] Limited to', history.length, 'transactions');
        }

        res.json({
            success: true,
            history: history,
            filter: filterType || 'all',
            total: history.length
        });
    } catch (error) {
        console.error('[PAYMENT-HISTORY] Error getting payment history:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/contacts - Get user contacts (protected)
app.get('/api/contacts', requireAuth, (req, res) => {
    try {
        const user = dbHelpers.getUserById(req.session.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        let contacts = dbHelpers.getContacts(req.session.user.id);
        
        // Apply limit if specified (for dropdown display, but default to all)
        if (limit && limit > 0) {
            contacts = contacts.slice(0, limit);
        }

        res.json({
            success: true,
            contacts: contacts,
            total: contacts.length
        });
    } catch (error) {
        console.error('Error getting contacts:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/contacts - Add contact (protected)
app.post('/api/contacts', requireAuth, (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const userId = req.session.user.id;
        const { contactUserId, contactWalletAddress, customName } = req.body;
        
        // Validate input
        if (!contactUserId && !contactWalletAddress) {
            return res.status(400).json({
                success: false,
                error: 'Either contactUserId or contactWalletAddress is required'
            });
        }

        // Prevent adding yourself
        if (contactUserId && parseInt(contactUserId) === userId) {
            return res.status(400).json({
                success: false,
                error: 'You cannot add yourself as a contact'
            });
        }

        // Check if user is trying to add themselves by wallet address
        const currentUser = dbHelpers.getUserById(userId);
        if (contactWalletAddress && currentUser.wallet_address && 
            contactWalletAddress.toLowerCase() === currentUser.wallet_address.toLowerCase()) {
            return res.status(400).json({
                success: false,
                error: 'You cannot add yourself as a contact'
            });
        }

        // Check if contact already exists
        if (dbHelpers.contactExists(userId, contactUserId, contactWalletAddress)) {
            return res.status(400).json({
                success: false,
                error: 'Contact already exists'
            });
        }

        // Check for custom name conflicts (if custom name is provided)
        if (customName && customName.trim()) {
            const nameConflict = dbHelpers.checkContactNameConflict(userId, customName.trim());
            if (nameConflict.conflict) {
                // Create notification about the conflict
                try {
                    const conflictingUser = dbHelpers.getUserByUsername(customName.trim());
                    if (conflictingUser) {
                        dbHelpers.createNotification(
                            userId,
                            'contact_conflict',
                            'Contact Name Conflict',
                            `The name "${customName.trim()}" conflicts with username "${conflictingUser.username}". Please choose a different name.`
                        );
                    } else {
                        dbHelpers.createNotification(
                            userId,
                            'contact_conflict',
                            'Contact Name Conflict',
                            `The name "${customName.trim()}" already exists in your contacts. Please choose a different name.`
                        );
                    }
                } catch (notifError) {
                    console.error('[CONTACTS] Error creating conflict notification:', notifError);
                }
                
                return res.status(400).json({
                    success: false,
                    error: nameConflict.reason
                });
            }
        }

        // Add contact
        const contactId = dbHelpers.addContact(userId, contactUserId, contactWalletAddress, customName ? customName.trim() : null);
        
        res.json({
            success: true,
            message: 'Contact added successfully',
            contactId: contactId
        });
    } catch (error) {
        console.error('Error adding contact:', error);
        if (error.message === 'Contact already exists') {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }
        res.status(500).json({
            success: false,
            error: 'Failed to add contact: ' + error.message
        });
    }
});

// PUT /api/contacts/:id - Update contact name (protected)
app.put('/api/contacts/:id', requireAuth, (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const userId = req.session.user.id;
        const contactId = parseInt(req.params.id);
        const { customName } = req.body;

        // Check for custom name conflicts (if custom name is provided)
        if (customName && customName.trim()) {
            const nameConflict = dbHelpers.checkContactNameConflict(userId, customName.trim(), contactId);
            if (nameConflict.conflict) {
                // Create notification about the conflict
                try {
                    const conflictingUser = dbHelpers.getUserByUsername(customName.trim());
                    if (conflictingUser) {
                        dbHelpers.createNotification(
                            userId,
                            'contact_conflict',
                            'Contact Name Conflict',
                            `The name "${customName.trim()}" conflicts with username "${conflictingUser.username}". Please choose a different name.`
                        );
                    } else {
                        dbHelpers.createNotification(
                            userId,
                            'contact_conflict',
                            'Contact Name Conflict',
                            `The name "${customName.trim()}" already exists in your contacts. Please choose a different name.`
                        );
                    }
                } catch (notifError) {
                    console.error('[CONTACTS] Error creating conflict notification:', notifError);
                }
                
                return res.status(400).json({
                    success: false,
                    error: nameConflict.reason
                });
            }
        }

        const updated = dbHelpers.updateContactName(userId, contactId, customName ? customName.trim() : null);
        
        if (!updated) {
            return res.status(404).json({
                success: false,
                error: 'Contact not found'
            });
        }

        res.json({
            success: true,
            message: 'Contact name updated successfully'
        });
    } catch (error) {
        console.error('Error updating contact:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update contact: ' + error.message
        });
    }
});

// DELETE /api/contacts/:id - Delete contact (protected)
app.delete('/api/contacts/:id', requireAuth, (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json');
        
        const userId = req.session.user.id;
        const contactId = parseInt(req.params.id);

        const deleted = dbHelpers.deleteContact(userId, contactId);
        
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: 'Contact not found'
            });
        }

        res.json({
            success: true,
            message: 'Contact deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete contact: ' + error.message
        });
    }
});

// GET /api/users/search - Search users by username (protected)
app.get('/api/users/search', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const searchTerm = req.query.q || '';
        
        if (!searchTerm || searchTerm.length < 2) {
            return res.json({
                success: true,
                users: []
            });
        }

        const users = dbHelpers.searchUsersByUsername(searchTerm, userId);
        
        res.json({
            success: true,
            users: users
        });
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/users/by-wallet - Get user by wallet address (protected)
app.get('/api/users/by-wallet', requireAuth, (req, res) => {
    try {
        const walletAddress = req.query.address;
        
        if (!walletAddress) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address is required'
            });
        }

        const user = dbHelpers.getUserByWalletAddress(walletAddress);
        
        if (!user) {
            return res.json({
                success: true,
                user: null
            });
        }

        // Don't return password
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
                walletAddress: user.wallet_address,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Error getting user by wallet:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve login and signup pages (public)
app.get('/login.html', (req, res) => {
    // If already logged in, redirect to home
    if (req.session && req.session.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup.html', (req, res) => {
    // If already logged in, redirect to home
    if (req.session && req.session.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/verify-email.html', (req, res) => {
    // If already logged in, redirect to home
    if (req.session && req.session.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'verify-email.html'));
});

// Serve index.html at root (protected)
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve profile.html (protected)
app.get('/profile.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'profile.html'));
});

// Serve contacts.html (protected)
app.get('/contacts.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'contacts.html'));
});

// Serve transfer.html (protected)
app.get('/transfer.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'transfer.html'));
});

// Serve payment-history.html (protected)
app.get('/payment-history.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'payment-history.html'));
});

// Serve ai-chat.html (protected)
app.get('/ai-chat.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'ai-chat.html'));
});

// Serve analysis page (protected)
app.get('/analysis.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'analysis.html'));
});

// GET /api/notifications - Get user notifications (protected)
app.get('/api/notifications', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const unreadOnly = req.query.unreadOnly === 'true';
        
        const notifications = dbHelpers.getNotifications(userId, unreadOnly);
        const unreadCount = dbHelpers.getUnreadNotificationCount(userId);
        
        res.json({
            success: true,
            notifications: notifications,
            unreadCount: unreadCount
        });
    } catch (error) {
        console.error('[NOTIFICATIONS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/notifications/:id/read - Mark notification as read (protected)
app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const notificationId = parseInt(req.params.id);
        
        const updated = dbHelpers.markNotificationAsRead(userId, notificationId);
        
        if (updated) {
            res.json({
                success: true,
                message: 'Notification marked as read'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Notification not found'
            });
        }
    } catch (error) {
        console.error('[NOTIFICATIONS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/notifications/read-all - Mark all notifications as read (protected)
app.post('/api/notifications/read-all', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const count = dbHelpers.markAllNotificationsAsRead(userId);
        
        res.json({
            success: true,
            message: `Marked ${count} notifications as read`
        });
    } catch (error) {
        console.error('[NOTIFICATIONS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// DELETE /api/notifications/:id - Delete notification (protected)
app.delete('/api/notifications/:id', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const notificationId = parseInt(req.params.id);
        
        const deleted = dbHelpers.deleteNotification(userId, notificationId);
        
        if (deleted) {
            res.json({
                success: true,
                message: 'Notification deleted'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Notification not found'
            });
        }
    } catch (error) {
        console.error('[NOTIFICATIONS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Import AI orchestrator and scheduler (with error handling for optional dependencies)
// IMPORTANT: Import BEFORE defining routes to ensure aiOrchestrator is available
let aiOrchestrator, scheduler;
try {
    aiOrchestrator = require('./agents/ai-orchestrator');
    scheduler = require('./scheduler');
    // Start payment scheduler
    scheduler.startScheduler();
    console.log('✅ AI Agents and Scheduler loaded');
    } catch (error) {
    console.warn('⚠️  AI Agents not available:', error.message);
    console.warn('   Install dependencies: npm install openai node-cron');
}

// AI Chat endpoint - MUST be defined BEFORE static middleware and 404 handler
app.post('/api/ai/chat', requireAuth, async (req, res) => {
    try {
        console.log('[AI Chat] Request received at /api/ai/chat');
        res.setHeader('Content-Type', 'application/json');
        
        if (!aiOrchestrator) {
            console.error('[AI Chat] AI orchestrator not available');
            return res.status(503).json({
                success: false,
                error: 'AI service not available. Please install dependencies: npm install openai node-cron'
            });
        }

        const { message } = req.body;
        if (!message) {
            console.error('[AI Chat] No message in request body');
        }
        
        const userId = req.session?.user?.id;
        if (!userId) {
            console.error('[AI Chat] No user ID in session');
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }
        
        const user = dbHelpers.getUserById(userId);

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        if (!user || !user.wallet_address) {
            return res.status(404).json({
                success: false,
                error: 'User wallet not found'
            });
        }

        const userContext = {
            userId: userId,
            walletAddress: user.wallet_address,
            username: user.username,
            email: user.email
        };

        console.log('[AI Chat] Processing message from user:', userId, 'message:', message.substring(0, 50));
        const result = await aiOrchestrator.processUserPrompt(message, userContext);
        console.log('[AI Chat] Result type:', result.type, 'success:', result.success);

        res.json({
            success: result.success,
            type: result.type,
            message: result.message,
            data: result
        });
    } catch (error) {
        console.error('[AI Chat] Error:', error);
        console.error('[AI Chat] Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Get scheduled payments
app.get('/api/scheduled-payments', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const scheduleAgent = require('./agents/schedule-agent');
        const payments = scheduleAgent.getUserScheduledPayments(userId);

    res.json({
        success: true,
            payments: payments
        });
    } catch (error) {
        console.error('[Scheduled Payments] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete/Cancel scheduled payment
app.delete('/api/scheduled-payments/:id', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const paymentId = parseInt(req.params.id);
        const scheduleAgent = require('./agents/schedule-agent');

        const deleted = scheduleAgent.deleteScheduledPayment(userId, paymentId);
        
        if (deleted) {
            res.json({
                success: true,
                message: 'Scheduled payment cancelled and deleted successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Scheduled payment not found'
            });
        }
    } catch (error) {
        console.error('[Scheduled Payments] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Cancel scheduled payment (also via POST for AI agent)
app.post('/api/scheduled-payments/:id/cancel', requireAuth, (req, res) => {
    try {
        const userId = req.session.user.id;
        const paymentId = parseInt(req.params.id);
        const scheduleAgent = require('./agents/schedule-agent');

        const deleted = scheduleAgent.deleteScheduledPayment(userId, paymentId);
        
        if (deleted) {
            res.json({
                success: true,
                message: 'Scheduled payment cancelled successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Scheduled payment not found'
            });
        }
    } catch (error) {
        console.error('[Scheduled Payments] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get AI report
app.get('/api/ai/report', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const history = dbHelpers.getPaymentHistory(userId, null);
        const reportAgent = require('./agents/report-agent');
        
        const report = await reportAgent.generateReport(history);

        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error('[AI Report] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve static files (AFTER all API routes are defined)
// This will serve login.html, signup.html, frontend.js, etc.
app.use(express.static('.', {
    index: false // Don't auto-serve index.html
}));

// Global error handler for API routes (must return JSON)
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    if (req.path.startsWith('/api/')) {
                return res.status(500).json({
                    success: false,
            error: err.message || 'Internal server error'
        });
    }
    next(err);
});

// 404 handler for API routes (must return JSON)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        console.log('[404] API endpoint not found:', req.method, req.path);
        return res.status(404).json({
            success: false,
            error: 'API endpoint not found: ' + req.method + ' ' + req.path
        });
    }
    next();
});

// Wallet configuration removed - each user has their own wallet created on signup
console.log('✅ Server ready - User wallets are created automatically on signup');

    // Start server
const SERVER_PORT = process.env.PORT || 3000;
    app.listen(SERVER_PORT, '0.0.0.0', () => {
        console.log('='.repeat(50));
    console.log('USDC Transfer Server Started (Local)');
        console.log('='.repeat(50));
        console.log(`Server running on http://localhost:${SERVER_PORT}`);
        console.log(`Server also accessible on http://0.0.0.0:${SERVER_PORT}`);
    console.log('');
    console.log('Network: Arc Testnet');
    console.log(`RPC URL: ${ARC_TESTNET_RPC_URL}`);
    console.log('✅ User wallets are created automatically on signup');
    console.log('✅ All transactions go through Arc Testnet');
    if (aiOrchestrator) {
        console.log('🤖 AI Agents: Enabled');
        console.log('⏰ Payment Scheduler: Started');
    } else {
        console.log('⚠️  AI Agents: Not available (install openai and node-cron)');
    }
        console.log('='.repeat(50));
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${SERVER_PORT} is already in use. Please stop the other server or use a different port.`);
        } else {
            console.error('❌ Server error:', err);
        }
        process.exit(1);
    });

