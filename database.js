// Database setup and utilities
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'users.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create users table
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        gender TEXT,
        nationality TEXT,
        phone TEXT,
        date_of_birth TEXT,
        email_verified INTEGER DEFAULT 0,
        verification_code TEXT,
        verification_code_expires INTEGER,
        wallet_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_verification_code ON users(verification_code);
`);

// Add wallet_address column to existing tables (migration)
// Check if column exists first
try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const hasWalletAddress = tableInfo.some(col => col.name === 'wallet_address');
    
    if (!hasWalletAddress) {
        db.exec(`ALTER TABLE users ADD COLUMN wallet_address TEXT;`);
        console.log('✅ Added wallet_address column to users table');
    } else {
        console.log('✅ wallet_address column already exists');
    }
} catch (error) {
    console.error('Error checking/adding wallet_address column:', error.message);
}

// Create index for wallet_address if it doesn't exist
try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wallet_address ON users(wallet_address);`);
} catch (error) {
    // Index might already exist
    if (!error.message.includes('already exists')) {
        console.log('Note: wallet_address index creation:', error.message);
    }
}

// Create payment_history table (without transaction_type first to avoid migration issues)
db.exec(`
    CREATE TABLE IF NOT EXISTS payment_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// Create indexes (avoiding transaction_type index until column exists)
try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_user_id ON payment_history(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_from_address ON payment_history(from_address);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_to_address ON payment_history(to_address);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_tx_hash ON payment_history(transaction_hash);`);
} catch (error) {
    console.log('Note: payment_history index creation:', error.message);
}

// Add transaction_type column to existing tables (migration)
try {
    const tableInfo = db.prepare("PRAGMA table_info(payment_history)").all();
    const hasTransactionType = tableInfo.some(col => col.name === 'transaction_type');
    
    if (!hasTransactionType) {
        db.exec(`ALTER TABLE payment_history ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'outbound';`);
        // Update existing records to be outbound (they were all sent)
        db.exec(`UPDATE payment_history SET transaction_type = 'outbound' WHERE transaction_type IS NULL OR transaction_type = '';`);
        // Create index
        db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_type ON payment_history(transaction_type);`);
        console.log('✅ Added transaction_type column to payment_history table');
    } else {
        console.log('✅ transaction_type column already exists');
    }
} catch (error) {
    console.log('Note: transaction_type column migration:', error.message);
}

// Create contacts table
db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        contact_user_id INTEGER,
        contact_wallet_address TEXT,
        custom_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, contact_user_id),
        UNIQUE(user_id, contact_wallet_address)
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_contact_user_id ON contacts(contact_user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_wallet_address ON contacts(contact_wallet_address);
`);

// Create notifications table
db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
`);

// Add automatic payment authorization fields to users table (migration)
try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const hasAutoPayEnabled = tableInfo.some(col => col.name === 'auto_pay_enabled');
    const hasEncryptedPrivateKey = tableInfo.some(col => col.name === 'encrypted_private_key');
    
    if (!hasAutoPayEnabled) {
        db.exec(`ALTER TABLE users ADD COLUMN auto_pay_enabled INTEGER DEFAULT 0;`);
        console.log('✅ Added auto_pay_enabled column to users table');
    }
    
    if (!hasEncryptedPrivateKey) {
        db.exec(`ALTER TABLE users ADD COLUMN encrypted_private_key TEXT;`);
        console.log('✅ Added encrypted_private_key column to users table');
    }
} catch (error) {
    console.log('Note: Auto payment authorization migration:', error.message);
}

// Helper functions
const dbHelpers = {
    // Check if email exists
    emailExists: (email) => {
        const stmt = db.prepare('SELECT id FROM users WHERE email = ?');
        const result = stmt.get(email);
        return !!result;
    },

    // Check if username exists (case-insensitive)
    usernameExists: (username) => {
        const stmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
        const result = stmt.get(username);
        return !!result;
    },

    // Create user
    createUser: (userData) => {
        const {
            email,
            username,
            password,
            first_name,
            last_name,
            gender,
            nationality,
            phone,
            date_of_birth,
            verification_code,
            verification_code_expires,
            email_verified = 0,  // Default to 0 (unverified) unless explicitly set
            wallet_address = null
        } = userData;

        const stmt = db.prepare(`
            INSERT INTO users (
                email, username, password, first_name, last_name,
                gender, nationality, phone, date_of_birth,
                email_verified, verification_code, verification_code_expires, wallet_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            email,
            username,
            password,
            first_name,
            last_name,
            gender || null,
            nationality || null,
            phone || null,
            date_of_birth || null,
            email_verified,  // Explicitly set to 0 for new signups
            verification_code,
            verification_code_expires,
            wallet_address || null
        );

        return result.lastInsertRowid;
    },

    // Get user by email
    getUserByEmail: (email) => {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        return stmt.get(email);
    },

    // Get user by username
    getUserByUsername: (username) => {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username);
    },

    // Get user by ID
    getUserById: (id) => {
        const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
        return stmt.get(id);
    },

    // Verify email - returns user email if successful, null otherwise
    verifyEmail: (verificationCode) => {
        // First, find the user with this verification code (must be unverified)
        const findStmt = db.prepare(`
            SELECT email, email_verified FROM users 
            WHERE verification_code = ? 
            AND verification_code_expires > ?
        `);
        const now = Date.now();
        const user = findStmt.get(verificationCode, now);
        
        if (!user) {
            console.log('[DB] Verification code not found or expired');
            return null; // Invalid or expired code
        }

        // Check if already verified
        if (user.email_verified === 1) {
            console.log('[DB] User already verified:', user.email);
            return null; // Already verified
        }
        
        // Update user to mark as verified (set email_verified = 1)
        const updateStmt = db.prepare(`
            UPDATE users 
            SET email_verified = 1, 
                verification_code = NULL,
                verification_code_expires = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE verification_code = ? 
            AND verification_code_expires > ?
            AND email_verified = 0
        `);
        const result = updateStmt.run(verificationCode, now);
        
        if (result.changes > 0) {
            console.log('[DB] Email verified for user:', user.email, 'email_verified set to 1');
            // Verify the update worked
            const verifyStmt = db.prepare('SELECT email_verified FROM users WHERE email = ?');
            const updated = verifyStmt.get(user.email);
            if (updated && updated.email_verified === 1) {
                return user.email; // Return email for session creation
            } else {
                console.error('[DB] Error: Email verification update failed for:', user.email);
                return null;
            }
        } else {
            console.log('[DB] Verification failed: No rows updated. Code may be invalid, expired, or already verified.');
            return null;
        }
    },

    // Update verification code
    updateVerificationCode: (email, code, expires) => {
        const stmt = db.prepare(`
            UPDATE users 
            SET verification_code = ?,
                verification_code_expires = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
        `);
        stmt.run(code, expires, email);
    },

    // Generate verification code
    generateVerificationCode: () => {
        return crypto.randomInt(100000, 999999).toString();
    },

    // Check if user is verified (helper function)
    isUserVerified: (email) => {
        const stmt = db.prepare('SELECT email_verified FROM users WHERE email = ?');
        const result = stmt.get(email);
        return result && result.email_verified === 1;
    },

    // Verify reset code and return email if valid
    verifyResetCode: (verificationCode) => {
        // Find user with this verification code (for password reset)
        const findStmt = db.prepare(`
            SELECT email FROM users 
            WHERE verification_code = ? 
            AND verification_code_expires > ?
        `);
        const now = Date.now();
        const user = findStmt.get(verificationCode, now);
        
        if (!user) {
            console.log('[DB] Reset code not found or expired');
            return null;
        }
        
        return user.email;
    },

    // Update user password
    updatePassword: (email, hashedPassword) => {
        const stmt = db.prepare(`
            UPDATE users 
            SET password = ?,
                verification_code = NULL,
                verification_code_expires = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
        `);
        const result = stmt.run(hashedPassword, email);
        return result.changes > 0;
    },

    // Update user profile (all fields except wallet_address and email)
    updateUserProfile: (userId, userData) => {
        const {
            username,
            first_name,
            last_name,
            gender,
            nationality,
            phone,
            date_of_birth
        } = userData;

        const stmt = db.prepare(`
            UPDATE users 
            SET username = ?,
                first_name = ?,
                last_name = ?,
                gender = ?,
                nationality = ?,
                phone = ?,
                date_of_birth = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        
        const result = stmt.run(
            username,
            first_name,
            last_name,
            gender || null,
            nationality || null,
            phone || null,
            date_of_birth || null,
            userId
        );
        
        return result.changes > 0;
    },

    // Delete user account
    deleteUser: (userId) => {
        // Delete user will cascade to contacts and payment_history
        const stmt = db.prepare('DELETE FROM users WHERE id = ?');
        const result = stmt.run(userId);
        return result.changes > 0;
    },

    // Add payment history
    addPaymentHistory: (userId, fromAddress, toAddress, amount, txHash, transactionType = 'outbound') => {
        const stmt = db.prepare(`
            INSERT INTO payment_history (user_id, from_address, to_address, amount, transaction_hash, transaction_type)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(userId, fromAddress, toAddress, amount.toString(), txHash, transactionType);
        return result.lastInsertRowid;
    },

    // Get payment history for user
    getPaymentHistory: (userId, filterType = null) => {
        let query = `
            SELECT * FROM payment_history
            WHERE user_id = ?
        `;
        const params = [userId];
        
        if (filterType && (filterType === 'inbound' || filterType === 'outbound')) {
            query += ` AND transaction_type = ?`;
            params.push(filterType);
        }
        
        query += ' ORDER BY created_at DESC';
        const stmt = db.prepare(query);
        return stmt.all(...params);
    },

    // Add contact
    addContact: (userId, contactUserId, contactWalletAddress, customName) => {
        const stmt = db.prepare(`
            INSERT INTO contacts (user_id, contact_user_id, contact_wallet_address, custom_name)
            VALUES (?, ?, ?, ?)
        `);
        try {
            const result = stmt.run(userId, contactUserId || null, contactWalletAddress || null, customName || null);
            return result.lastInsertRowid;
        } catch (error) {
            if (error.message.includes('UNIQUE constraint')) {
                throw new Error('Contact already exists');
            }
            throw error;
        }
    },

    // Get contacts for user
    getContacts: (userId) => {
        const stmt = db.prepare(`
            SELECT 
                c.id,
                c.contact_user_id,
                c.contact_wallet_address,
                c.custom_name,
                u.username,
                u.first_name,
                u.last_name,
                u.wallet_address,
                c.created_at
            FROM contacts c
            LEFT JOIN users u ON c.contact_user_id = u.id
            WHERE c.user_id = ?
            ORDER BY c.custom_name ASC, u.username ASC, c.contact_wallet_address ASC
        `);
        return stmt.all(userId);
    },

    // Check if contact exists
    contactExists: (userId, contactUserId, contactWalletAddress) => {
        if (contactUserId) {
            const stmt = db.prepare('SELECT id FROM contacts WHERE user_id = ? AND contact_user_id = ?');
            const result = stmt.get(userId, contactUserId);
            return !!result;
        } else if (contactWalletAddress) {
            const stmt = db.prepare('SELECT id FROM contacts WHERE user_id = ? AND contact_wallet_address = ?');
            const result = stmt.get(userId, contactWalletAddress);
            return !!result;
        }
        return false;
    },

    // Update contact custom name
    updateContactName: (userId, contactId, customName) => {
        const stmt = db.prepare(`
            UPDATE contacts 
            SET custom_name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `);
        const result = stmt.run(customName || null, contactId, userId);
        return result.changes > 0;
    },

    // Delete contact
    deleteContact: (userId, contactId) => {
        const stmt = db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?');
        const result = stmt.run(contactId, userId);
        return result.changes > 0;
    },

    // Search users by username
    searchUsersByUsername: (searchTerm, excludeUserId) => {
        const stmt = db.prepare(`
            SELECT id, username, first_name, last_name, wallet_address, email
            FROM users
            WHERE LOWER(username) LIKE LOWER(?) 
            AND id != ?
            AND email_verified = 1
            LIMIT 20
        `);
        return stmt.all(`%${searchTerm}%`, excludeUserId || 0);
    },

    // Get user by wallet address
    getUserByWalletAddress: (walletAddress) => {
        const stmt = db.prepare('SELECT * FROM users WHERE wallet_address = ?');
        return stmt.get(walletAddress);
    },

    // Get contact by custom name or username (case-insensitive, for current user only)
    getContactByName: (userId, name) => {
        // First try to find by custom name (exact match, case-insensitive)
        const stmt1 = db.prepare(`
            SELECT 
                c.id,
                c.custom_name,
                u.username,
                c.contact_wallet_address,
                u.wallet_address,
                COALESCE(c.contact_wallet_address, u.wallet_address) as final_wallet_address
            FROM contacts c
            LEFT JOIN users u ON c.contact_user_id = u.id
            WHERE c.user_id = ? AND LOWER(c.custom_name) = LOWER(?)
        `);
        let contact = stmt1.get(userId, name);
        
        // If not found by custom name, try to find by username in contacts
        if (!contact) {
            const stmt2 = db.prepare(`
                SELECT 
                    c.id,
                    c.custom_name,
                    u.username,
                    c.contact_wallet_address,
                    u.wallet_address,
                    COALESCE(c.contact_wallet_address, u.wallet_address) as final_wallet_address
                FROM contacts c
                LEFT JOIN users u ON c.contact_user_id = u.id
                WHERE c.user_id = ? AND LOWER(u.username) = LOWER(?)
            `);
            contact = stmt2.get(userId, name);
        }
        
        return contact;
    },

    // Check if custom name conflicts with existing custom names or usernames
    checkContactNameConflict: (userId, customName, excludeContactId = null) => {
        // Check if custom name already exists in user's contacts (excluding current contact)
        let stmt1;
        if (excludeContactId) {
            stmt1 = db.prepare(`
                SELECT id FROM contacts 
                WHERE user_id = ? AND LOWER(custom_name) = LOWER(?) AND id != ?
            `);
            if (stmt1.get(userId, customName, excludeContactId)) {
                return { conflict: true, reason: 'Custom name already exists in your contacts' };
            }
        } else {
            stmt1 = db.prepare(`
                SELECT id FROM contacts 
                WHERE user_id = ? AND LOWER(custom_name) = LOWER(?)
            `);
            if (stmt1.get(userId, customName)) {
                return { conflict: true, reason: 'Custom name already exists in your contacts' };
            }
        }
        
        // Check if custom name conflicts with any username in the system
        const stmt2 = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
        if (stmt2.get(customName)) {
            return { conflict: true, reason: 'Custom name conflicts with an existing username' };
        }
        
        return { conflict: false };
    },

    // Get all usernames (for AI agents, no sensitive data)
    getAllUsernames: () => {
        const stmt = db.prepare('SELECT id, username FROM users ORDER BY username ASC');
        return stmt.all();
    },

    // Notification helpers
    createNotification: (userId, type, title, message) => {
        const stmt = db.prepare(`
            INSERT INTO notifications (user_id, type, title, message)
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(userId, type, title, message);
        return result.lastInsertRowid;
    },

    getNotifications: (userId, unreadOnly = false) => {
        let query = `
            SELECT * FROM notifications
            WHERE user_id = ?
        `;
        const params = [userId];
        
        if (unreadOnly) {
            query += ' AND read = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT 50';
        const stmt = db.prepare(query);
        return stmt.all(...params);
    },

    markNotificationAsRead: (userId, notificationId) => {
        const stmt = db.prepare(`
            UPDATE notifications
            SET read = 1
            WHERE id = ? AND user_id = ?
        `);
        const result = stmt.run(notificationId, userId);
        return result.changes > 0;
    },

    markAllNotificationsAsRead: (userId) => {
        const stmt = db.prepare(`
            UPDATE notifications
            SET read = 1
            WHERE user_id = ? AND read = 0
        `);
        const result = stmt.run(userId);
        return result.changes;
    },

    getUnreadNotificationCount: (userId) => {
        const stmt = db.prepare(`
            SELECT COUNT(*) as count FROM notifications
            WHERE user_id = ? AND read = 0
        `);
        const result = stmt.get(userId);
        return result ? result.count : 0;
    },

    deleteNotification: (userId, notificationId) => {
        const stmt = db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?');
        const result = stmt.run(notificationId, userId);
        return result.changes > 0;
    },

    // Enable automatic payments for user
    enableAutoPay: (userId, encryptedPrivateKey) => {
        const stmt = db.prepare(`
            UPDATE users 
            SET auto_pay_enabled = 1,
                encrypted_private_key = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        const result = stmt.run(encryptedPrivateKey, userId);
        return result.changes > 0;
    },

    // Disable automatic payments for user
    disableAutoPay: (userId) => {
        const stmt = db.prepare(`
            UPDATE users 
            SET auto_pay_enabled = 0,
                encrypted_private_key = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        const result = stmt.run(userId);
        return result.changes > 0;
    },

    // Get user's auto pay status and encrypted private key
    getAutoPayStatus: (userId) => {
        const stmt = db.prepare('SELECT auto_pay_enabled, encrypted_private_key FROM users WHERE id = ?');
        const result = stmt.get(userId);
        return result ? {
            enabled: result.auto_pay_enabled === 1,
            encryptedPrivateKey: result.encrypted_private_key
        } : null;
    }
};

module.exports = { db, dbHelpers };

