// Frontend JavaScript for USDC Transfer
// Works with user's individual wallet

// Use relative URLs for Cloudflare Pages (works both locally and in production)
const API_BASE_URL = '';

let balanceUpdateInterval = null;

// Initialize on page load
window.addEventListener('load', async function() {
    // Check authentication first
    const authCheck = await checkAuthentication();
    if (!authCheck) {
        window.location.href = '/login.html';
        return;
    }
    
    // Load user info and start the app
    loadUserInfo();
    loadWalletAddress();
    startBalancePolling();
    loadDashboardStats();
    loadPaymentHistoryCard();
    loadFrequentContacts();
    loadAnalysisSummary();
    loadNotifications();
    startNotificationPolling();
    
    // Initialize AI query input
    const aiQueryInput = document.getElementById('aiQueryInput');
    if (aiQueryInput) {
        aiQueryInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendAIQuery();
            }
        });
    }
});

// Check if user is authenticated
async function checkAuthentication() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/check`, {
            credentials: 'include'
        });
        const data = await response.json();
        return data.authenticated;
    } catch (error) {
        console.error('Error checking authentication:', error);
        return false;
    }
}

// Load user info
async function loadUserInfo() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/check`, {
            credentials: 'include'
        });
        const data = await response.json();
        if (data.authenticated && data.user) {
            const usernameDisplay = document.getElementById('usernameDisplay');
            if (usernameDisplay) {
                const displayName = data.user.firstName && data.user.lastName 
                    ? `${data.user.firstName} ${data.user.lastName}`
                    : data.user.username || data.user.email;
                usernameDisplay.textContent = `Welcome, ${displayName}`;
            }
        }
    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

// Handle logout (make it globally accessible)
window.handleLogout = async function() {
    try {
        console.log('Logging out...');
        const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        });
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (data.success) {
                console.log('Logout successful');
                window.location.href = '/login.html';
                return;
            }
        }
        
        // If we get here, logout might have worked but response wasn't JSON
        console.log('Logging out (redirecting anyway)');
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Error logging out:', error);
        // Redirect anyway
        window.location.href = '/login.html';
    }
};

// Load user's wallet address from backend
async function loadWalletAddress() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/wallet`, {
            credentials: 'include'
        });
        
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html';
            return;
        }
        
        if (response.status === 404) {
            showStatus('Wallet not found. Please contact support.', 'error');
            return;
        }
        
        const data = await response.json();
        
        if (data.success && data.walletAddress) {
            const walletAddressElement = document.getElementById('walletAddress');
            if (walletAddressElement) {
                walletAddressElement.textContent = data.walletAddress;
            }
            // Store wallet address for validation
            window.userWalletAddress = data.walletAddress;
        }
    } catch (error) {
        console.error('Error loading wallet address:', error);
        showStatus('Error loading wallet address', 'error');
    }
}

// Transfer functionality moved to transfer.html - this file is for dashboard only

// Start polling for balance updates
function startBalancePolling() {
    // Update balances immediately
    updateBalance();
    
    // Then update every 5 seconds
    balanceUpdateInterval = setInterval(updateBalance, 5000);
}

// Format amount for display
function formatAmount(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return '0';
    
    // Format with up to 6 decimal places, remove trailing zeros
    let formatted = num.toFixed(6);
    // Remove trailing zeros
    formatted = formatted.replace(/\.?0+$/, '');
    
    return formatted;
}

// Update user's wallet balance from backend
async function updateBalance() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/balance`, {
            credentials: 'include'
        });
        
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html';
            return;
        }
        
        if (response.status === 404) {
            document.getElementById('walletBalance').textContent = 'Wallet not found';
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            const balanceElement = document.getElementById('walletBalance');
            if (balanceElement) {
                balanceElement.textContent = formatAmount(data.balance) + ' USDC';
            }
        }
    } catch (error) {
        console.error('Error updating balance:', error);
        // Don't show error on every poll, just log it
    }
}

// Transfer functionality moved to transfer.html page
// This file only handles dashboard functionality

// Show status message
function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    if (!statusDiv) return;
    
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
    statusDiv.style.display = 'block';
    
    // Auto-hide success messages after 8 seconds
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.className = 'status';
            statusDiv.style.display = 'none';
        }, 8000);
    }
}

// Load dashboard statistics
async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/payment-history`, {
            credentials: 'include'
        });

        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html';
        return;
    }

        const data = await response.json();

        if (data.success && data.history) {
            // Calculate total transactions
            const totalTransactions = data.history.length;
            document.getElementById('totalTransactions').textContent = totalTransactions;

            // Calculate total transferred (outbound only)
            const totalTransferred = data.history
                .filter(p => p.transaction_type === 'outbound')
                .reduce((sum, p) => sum + parseFloat(p.amount), 0);
            
            document.getElementById('totalTransferred').textContent = formatAmount(totalTransferred) + ' USDC';
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

// Load payment history card (latest 5)
async function loadPaymentHistoryCard() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/payment-history?limit=5`, {
            credentials: 'include'
        });

        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html';
        return;
    }

        const data = await response.json();

        if (data.success) {
            const historyCard = document.getElementById('paymentHistoryCard');
            if (!historyCard) return;

            if (data.history && data.history.length > 0) {
                let historyHTML = '';
                data.history.forEach(payment => {
                    const date = new Date(payment.created_at);
                    const dateStr = date.toLocaleDateString();
                    const transactionType = payment.transaction_type || 'outbound';
                    const typeIcon = transactionType === 'inbound' ? '📥' : '📤';
                    const typeColor = transactionType === 'inbound' ? '#28a745' : '#667eea';

                    historyHTML += `<div class="payment-history-item">`;
                    historyHTML += `<div><span style="color: ${typeColor}; margin-right: 8px;">${typeIcon}</span>${dateStr}</div>`;
                    historyHTML += `<div class="amount" style="color: ${typeColor};">${formatAmount(payment.amount)} USDC</div>`;
                    historyHTML += `</div>`;
                });
                historyCard.innerHTML = historyHTML;
            } else {
                historyCard.innerHTML = '<p class="empty-state">📭 No payment history found.</p>';
            }
        }
    } catch (error) {
        console.error('Error loading payment history card:', error);
        const historyCard = document.getElementById('paymentHistoryCard');
        if (historyCard) {
            historyCard.innerHTML = '<p class="empty-state">Error loading payment history.</p>';
        }
    }
}

// Load frequently used contacts (5 most used)
async function loadFrequentContacts() {
    try {
        // First get payment history to determine frequently used contacts
        const historyResponse = await fetch(`${API_BASE_URL}/api/payment-history`, {
            credentials: 'include'
        });

        if (historyResponse.status === 401 || historyResponse.status === 403) {
            window.location.href = '/login.html';
            return;
        }

        const historyData = await historyResponse.json();

        // Get all contacts
        const contactsResponse = await fetch(`${API_BASE_URL}/api/contacts`, {
            credentials: 'include'
        });

        if (contactsResponse.status === 401 || contactsResponse.status === 403) {
        return;
    }

        const contactsData = await contactsResponse.json();

        if (historyData.success && contactsData.success) {
            const frequentContactsCard = document.getElementById('frequentContactsCard');
            if (!frequentContactsCard) return;

            // Count payment frequency by wallet address
            const contactUsage = {};
            historyData.history
                .filter(p => p.transaction_type === 'outbound')
                .forEach(payment => {
                    const addr = payment.to_address.toLowerCase();
                    contactUsage[addr] = (contactUsage[addr] || 0) + 1;
                });

            // Map contacts with usage count
            const contactsWithUsage = contactsData.contacts.map(contact => {
                const walletAddr = (contact.contact_wallet_address || contact.wallet_address || '').toLowerCase();
                return {
                    ...contact,
                    usageCount: contactUsage[walletAddr] || 0,
                    displayName: contact.custom_name || contact.username || 'Unknown',
                    walletAddress: walletAddr
                };
            });

            // Sort by usage count (descending) and take top 5
            const frequentContacts = contactsWithUsage
                .filter(c => c.usageCount > 0)
                .sort((a, b) => b.usageCount - a.usageCount)
                .slice(0, 5);

            if (frequentContacts.length > 0) {
                let contactsHTML = '';
                frequentContacts.forEach(contact => {
                    const shortAddr = contact.walletAddress.substring(0, 8) + '...' + contact.walletAddress.substring(contact.walletAddress.length - 6);
                    contactsHTML += `<div class="contact-item" onclick="redirectToTransfer('${contact.walletAddress}')">`;
                    contactsHTML += `<div><div class="contact-name">${contact.displayName}</div><div class="contact-address">${shortAddr}</div></div>`;
                    contactsHTML += `<div style="color: #667eea; font-size: 12px;">${contact.usageCount} payments</div>`;
                    contactsHTML += `</div>`;
                });
                frequentContactsCard.innerHTML = contactsHTML;
            } else {
                frequentContactsCard.innerHTML = '<p class="empty-state">👥 No frequently used contacts found. Start making payments to see them here!</p>';
            }
        }
    } catch (error) {
        console.error('Error loading frequent contacts:', error);
        const frequentContactsCard = document.getElementById('frequentContactsCard');
        if (frequentContactsCard) {
            frequentContactsCard.innerHTML = '<p class="empty-state">Error loading contacts.</p>';
        }
    }
}

// Redirect to transfer page with selected contact (make it globally accessible)
window.redirectToTransfer = function(walletAddress) {
    window.location.href = `/transfer.html?to=${encodeURIComponent(walletAddress)}`;
};

// Load analysis summary
async function loadAnalysisSummary() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/ai/report`, {
            credentials: 'include'
        });

        if (response.status === 401 || response.status === 403) {
            return;
        }

        const data = await response.json();

        if (data.success && data.report) {
            const analysisDiv = document.getElementById('analysisSummary');
            if (!analysisDiv) return;

            const report = data.report;
            let analysisHTML = '';

            if (report.summary) {
                analysisHTML += `<div class="analysis-summary-item">`;
                analysisHTML += `<strong>📊 Summary</strong>`;
                analysisHTML += `<div>${report.summary}</div>`;
                analysisHTML += `</div>`;
            }

            if (report.statistics) {
                analysisHTML += `<div class="analysis-summary-item">`;
                analysisHTML += `<strong>📈 Key Statistics</strong>`;
                analysisHTML += `<div>Total Transactions: ${report.statistics.totalTransactions || 0}</div>`;
                analysisHTML += `<div>Total Inbound: ${formatAmount(report.statistics.totalInbound || 0)} USDC</div>`;
                analysisHTML += `<div>Total Outbound: ${formatAmount(report.statistics.totalOutbound || 0)} USDC</div>`;
                analysisHTML += `</div>`;
            }

            if (analysisHTML) {
                analysisDiv.innerHTML = analysisHTML;
            } else {
                analysisDiv.innerHTML = '<p class="empty-state">No analysis data available.</p>';
            }
        }
    } catch (error) {
        console.error('Error loading analysis summary:', error);
        const analysisDiv = document.getElementById('analysisSummary');
        if (analysisDiv) {
            analysisDiv.innerHTML = '<p class="empty-state">Error loading analysis.</p>';
        }
    }
}

// Send AI query (query only, no actions)
async function sendAIQuery() {
    const input = document.getElementById('aiQueryInput');
    const message = input.value.trim();
    
    if (!message) return;

    const messagesDiv = document.getElementById('aiQueryMessages');
    
    // Add user message
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-message user';
    userMsg.textContent = message;
    messagesDiv.appendChild(userMsg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    input.value = '';
    const sendBtn = document.getElementById('aiQuerySendBtn');
        sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ message: message + ' (QUERY ONLY - DO NOT PERFORM ANY ACTIONS)' })
        });

        const data = await response.json();

        if (data.success) {
            // Only show query responses, not action responses
            if (data.type === 'query' || data.type === 'balance' || data.type === 'payment_history' || data.type === 'report') {
                const assistantMsg = document.createElement('div');
                assistantMsg.className = 'ai-message assistant';
                assistantMsg.textContent = data.message;
                messagesDiv.appendChild(assistantMsg);
            } else {
                const assistantMsg = document.createElement('div');
                assistantMsg.className = 'ai-message assistant';
                assistantMsg.textContent = 'This is a query-only agent. I can only answer questions, not perform actions. Please use the full AI Assistant for actions.';
                messagesDiv.appendChild(assistantMsg);
            }
        } else {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'ai-message assistant';
            errorMsg.textContent = 'Error: ' + (data.error || 'Failed to get response');
            messagesDiv.appendChild(errorMsg);
        }
    } catch (error) {
        console.error('Error sending AI query:', error);
        const errorMsg = document.createElement('div');
        errorMsg.className = 'ai-message assistant';
        errorMsg.textContent = 'Error: ' + error.message;
        messagesDiv.appendChild(errorMsg);
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

// Load recent payments (latest 5) - kept for backward compatibility
async function loadRecentPayments() {
    await loadPaymentHistoryCard();
}

// Reload recent payments after transfer
async function reloadRecentPayments() {
    await loadRecentPayments();
}

// Notification functions
let notificationPollingInterval = null;

async function loadNotifications() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
            credentials: 'include'
        });

        if (response.status === 401 || response.status === 403) {
            return;
        }

        const data = await response.json();

        if (data.success) {
            // Update badge
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                if (data.unreadCount > 0) {
                    badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }

            // Update notification list
            const notificationList = document.getElementById('notificationList');
            if (notificationList) {
                if (data.notifications && data.notifications.length > 0) {
                    let html = '';
                    data.notifications.forEach(notif => {
                        const date = new Date(notif.created_at);
                        const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const unreadClass = notif.read === 0 ? 'unread' : '';
                        html += `<div class="notification-item ${unreadClass}" onclick="markNotificationAsRead(${notif.id})">`;
                        html += `<button class="notification-delete" onclick="event.stopPropagation(); deleteNotification(${notif.id})">×</button>`;
                        html += `<div class="notification-title">${notif.title}</div>`;
                        html += `<div class="notification-message">${notif.message}</div>`;
                        html += `<div class="notification-time">${timeStr}</div>`;
                        html += `</div>`;
                    });
                    notificationList.innerHTML = html;
                } else {
                    notificationList.innerHTML = '<p class="empty-state" style="padding: 20px; text-align: center; color: #999;">No notifications</p>';
                }
            }
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function startNotificationPolling() {
    // Load notifications immediately
    loadNotifications();
    
    // Then poll every 10 seconds
    notificationPollingInterval = setInterval(loadNotifications, 10000);
}

function toggleNotifications() {
    const panel = document.getElementById('notificationPanel');
    if (panel) {
        if (panel.style.display === 'none') {
            panel.style.display = 'flex';
            loadNotifications(); // Refresh when opening
        } else {
            panel.style.display = 'none';
        }
    }
}

async function markNotificationAsRead(notificationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications/${notificationId}/read`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            await loadNotifications();
        }
    } catch (error) {
        console.error('Error marking notification as read:', error);
    }
}

async function markAllNotificationsAsRead() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            await loadNotifications();
        }
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
    }
}

async function deleteNotification(notificationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications/${notificationId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            await loadNotifications();
        }
    } catch (error) {
        console.error('Error deleting notification:', error);
    }
}

// Make functions globally accessible
window.toggleNotifications = toggleNotifications;
window.markNotificationAsRead = markNotificationAsRead;
window.markAllNotificationsAsRead = markAllNotificationsAsRead;
window.deleteNotification = deleteNotification;

// Stop polling when page unloads
window.addEventListener('beforeunload', function() {
    if (balanceUpdateInterval) {
        clearInterval(balanceUpdateInterval);
    }
    if (notificationPollingInterval) {
        clearInterval(notificationPollingInterval);
    }
});

// Close notification panel when clicking outside
document.addEventListener('click', function(event) {
    const notificationWrapper = document.querySelector('.notification-wrapper');
    const notificationPanel = document.getElementById('notificationPanel');
    if (notificationWrapper && notificationPanel && 
        !notificationWrapper.contains(event.target) && 
        notificationPanel.style.display !== 'none') {
        notificationPanel.style.display = 'none';
    }
});
