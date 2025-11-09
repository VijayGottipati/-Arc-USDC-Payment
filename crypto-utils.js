// Crypto utilities for encrypting/decrypting private keys
const crypto = require('crypto');

// Use a secret key from environment or default (for development only)
// In production, this should be a strong, randomly generated key stored securely
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Get encryption key from environment or generate a master key
 */
function getEncryptionKey() {
    // In production, use a proper key derivation function (PBKDF2)
    // For now, use a simple hash of the master key
    return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

/**
 * Encrypt a private key
 * @param {string} text - Private key to encrypt
 * @returns {string} - Encrypted private key (hex string)
 */
function encryptPrivateKey(text) {
    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(IV_LENGTH);
        const salt = crypto.randomBytes(SALT_LENGTH);
        
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const tag = cipher.getAuthTag();
        
        // Combine salt + iv + tag + encrypted
        const combined = Buffer.concat([
            salt,
            iv,
            tag,
            Buffer.from(encrypted, 'hex')
        ]);
        
        return combined.toString('hex');
    } catch (error) {
        console.error('[Crypto Utils] Error encrypting private key:', error);
        throw new Error('Failed to encrypt private key');
    }
}

/**
 * Decrypt a private key
 * @param {string} encryptedText - Encrypted private key (hex string)
 * @returns {string} - Decrypted private key
 */
function decryptPrivateKey(encryptedText) {
    try {
        const key = getEncryptionKey();
        const combined = Buffer.from(encryptedText, 'hex');
        
        // Extract components
        const salt = combined.slice(0, SALT_LENGTH);
        const iv = combined.slice(SALT_LENGTH, TAG_POSITION);
        const tag = combined.slice(TAG_POSITION, ENCRYPTED_POSITION);
        const encrypted = combined.slice(ENCRYPTED_POSITION);
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(encrypted, null, 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('[Crypto Utils] Error decrypting private key:', error);
        throw new Error('Failed to decrypt private key');
    }
}

module.exports = {
    encryptPrivateKey,
    decryptPrivateKey
};

