// Frontend JavaScript for Transfer Page
const API_BASE_URL = '';

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
    await loadContacts();
    startBalancePolling();

    // Check if "to" parameter is present in URL
    const urlParams = new URLSearchParams(window.location.search);
    const toAddress = urlParams.get('to');
    if (toAddress) {
        // Auto-select the contact/address
        await autoSelectRecipient(toAddress);
    }

    // Initialize username search
    const usernameSearchInput = document.getElementById('usernameSearch');
    if (usernameSearchInput) {
        usernameSearchInput.addEventListener('input', function(e) {
            clearTimeout(window.searchTimeout);
            const searchTerm = e.target.value.trim();
            
            if (searchTerm.length < 2) {
                const resultsDiv = document.getElementById('usernameSearchResults');
                if (resultsDiv) {
                    resultsDiv.style.display = 'none';
                }
                return;
            }

            window.searchTimeout = setTimeout(async () => {
                await searchUsersForTransfer(searchTerm);
            }, 300);
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
        // User info not needed on transfer page, but we check authentication
    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

// Handle logout
window.handleLogout = async function() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        });
        
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Error logging out:', error);
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

// Load contacts for dropdown (show all with scrolling)
async function loadContacts() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts`, {
            credentials: 'include'
        });

        if (response.status === 401 || response.status === 403) {
            return;
        }

        const data = await response.json();

        if (data.success && data.contacts) {
            const contactSelect = document.getElementById('contactSelect');
            if (!contactSelect) return;

            // Clear existing options
            contactSelect.innerHTML = '<option value="">-- Select a contact --</option>';

            // Add ALL contacts to dropdown
            if (data.contacts.length === 0) {
                const noContactsOption = document.createElement('option');
                noContactsOption.value = '';
                noContactsOption.textContent = '-- No contacts found. Add contacts first. --';
                noContactsOption.disabled = true;
                contactSelect.appendChild(noContactsOption);
            } else {
                data.contacts.forEach(contact => {
                    const displayName = contact.custom_name || contact.username || 'Unknown';
                    const walletAddr = contact.wallet_address || contact.contact_wallet_address;
                    
                    if (walletAddr) {
                        const option = document.createElement('option');
                        option.value = walletAddr;
                        option.textContent = `${displayName} (${walletAddr.substring(0, 8)}...${walletAddr.substring(walletAddr.length - 6)})`;
                        option.dataset.contactName = displayName;
                        contactSelect.appendChild(option);
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

// Auto-select recipient from URL parameter
async function autoSelectRecipient(toAddress) {
    if (!toAddress) return;

    // Wait a bit for contacts to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Try to find in contacts first
    const contactSelect = document.getElementById('contactSelect');
    if (contactSelect) {
        for (let i = 0; i < contactSelect.options.length; i++) {
            const option = contactSelect.options[i];
            const optionAddress = option.value || option.dataset.address;
            if (optionAddress && optionAddress.toLowerCase() === toAddress.toLowerCase()) {
                // Switch to contact selection first
                const recipientTypeSelect = document.getElementById('recipientType');
                if (recipientTypeSelect) {
                    recipientTypeSelect.value = 'contact';
                    if (typeof handleRecipientTypeChange === 'function') {
                        handleRecipientTypeChange();
                    }
                }
                
                // Wait for UI to update
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Select the contact
                contactSelect.value = option.value;
                
                // Trigger change event to update UI
                if (typeof handleContactSelect === 'function') {
                    handleContactSelect();
                }
                return;
            }
        }
    }

    // If not found in contacts, use direct address input
    const recipientTypeSelect = document.getElementById('recipientType');
    if (recipientTypeSelect) {
        recipientTypeSelect.value = 'address';
        if (typeof handleRecipientTypeChange === 'function') {
            handleRecipientTypeChange();
        }
        
        // Wait for UI to update
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const toAddressInput = document.getElementById('toAddress');
        if (toAddressInput) {
            toAddressInput.value = toAddress;
        }
    }
}

// Handle recipient type change
window.handleRecipientTypeChange = function() {
    const recipientTypeSelect = document.getElementById('recipientType');
    if (!recipientTypeSelect) return;
    
    const recipientType = recipientTypeSelect.value;
    const contactSelectGroup = document.getElementById('contactSelectGroup');
    const usernameSearchGroup = document.getElementById('usernameSearchGroup');
    const addressInputGroup = document.getElementById('addressInputGroup');
    const toAddressInput = document.getElementById('toAddress');
    const contactSelect = document.getElementById('contactSelect');
    const usernameSearch = document.getElementById('usernameSearch');
    const usernameSearchResults = document.getElementById('usernameSearchResults');

    // Hide all groups first
    if (contactSelectGroup) contactSelectGroup.style.display = 'none';
    if (usernameSearchGroup) usernameSearchGroup.style.display = 'none';
    if (addressInputGroup) addressInputGroup.style.display = 'none';

    // Clear required attribute
    if (toAddressInput) {
        toAddressInput.removeAttribute('required');
    }

    // Show/hide groups based on selection
    if (recipientType === 'contact') {
        // Show contact dropdown
        if (contactSelectGroup) contactSelectGroup.style.display = 'block';
        
        // Clear other inputs but preserve contact selection
        if (usernameSearch) usernameSearch.value = '';
        if (usernameSearchResults) usernameSearchResults.style.display = 'none';
        
        // Load contacts if not already loaded
        if (contactSelect && contactSelect.options.length <= 1) {
            loadContacts();
        }
    } else if (recipientType === 'search') {
        // Show search
        if (usernameSearchGroup) usernameSearchGroup.style.display = 'block';
        
        // Clear other inputs
        if (contactSelect) contactSelect.value = '';
        if (toAddressInput) toAddressInput.value = '';
    } else if (recipientType === 'address') {
        // Show address input
        if (addressInputGroup) addressInputGroup.style.display = 'block';
        
        // Clear other inputs
        if (contactSelect) contactSelect.value = '';
        if (usernameSearch) usernameSearch.value = '';
        if (usernameSearchResults) usernameSearchResults.style.display = 'none';
        
        if (toAddressInput) {
            toAddressInput.setAttribute('required', 'required');
        }
    }
}

// Handle contact select
window.handleContactSelect = function() {
    const contactSelect = document.getElementById('contactSelect');
    const toAddressHidden = document.getElementById('toAddressHidden');
    
    if (contactSelect && contactSelect.value) {
        const selectedOption = contactSelect.options[contactSelect.selectedIndex];
        const walletAddress = contactSelect.value;
        const contactName = selectedOption.dataset.contactName || selectedOption.textContent;
        
        // Store the selected wallet address in hidden field
        if (toAddressHidden) {
            toAddressHidden.value = walletAddress;
        }
        
        console.log('Selected contact:', contactName, 'Wallet:', walletAddress);
        
        // Show visual feedback on the select element
        if (contactSelect) {
            contactSelect.style.borderColor = '#28a745';
            contactSelect.style.boxShadow = '0 0 0 3px rgba(40, 167, 69, 0.1)';
            setTimeout(() => {
                if (contactSelect.style) {
                    contactSelect.style.borderColor = '';
                    contactSelect.style.boxShadow = '';
                }
            }, 2000);
        }
    } else {
        // Clear the address if no contact is selected
        if (toAddressHidden) {
            toAddressHidden.value = '';
        }
    }
}

// Search users by username (limit to 5)
async function searchUsersForTransfer(searchTerm) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/users/search?q=${encodeURIComponent(searchTerm)}&limit=5`, {
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            const resultsDiv = document.getElementById('usernameSearchResults');
            if (!resultsDiv) return;

            if (data.users && data.users.length > 0) {
                // Limit to 5 results
                const usersToShow = data.users.slice(0, 5);
                let html = '<div style="padding: 12px 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-weight: bold; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;">';
                html += '<span>🔍 Search Results (max 5):</span>';
                if (data.total && data.total > 5) {
                    html += '<span style="font-size: 11px; opacity: 0.9;">Showing first 5</span>';
                }
                html += '</div>';
                
                usersToShow.forEach((user, index) => {
                    if (user.wallet_address) {
                        const isLast = index === usersToShow.length - 1;
                        html += `<div class="search-result-item" onclick="selectUserForTransfer('${user.wallet_address}', '${user.username}')" style="border-radius: ${isLast ? '0 0 8px 8px' : '0'};">`;
                        html += `<strong style="color: #333; font-size: 14px;">${user.username}</strong>`;
                        if (user.first_name || user.last_name) {
                            html += ` <span style="color: #666; font-size: 13px;">- ${user.first_name || ''} ${user.last_name || ''}</span>`.trim();
                        }
                        html += ` <span style="color: #667eea; font-size: 11px; font-family: monospace; display: block; margin-top: 5px;">${user.wallet_address.substring(0, 10)}...${user.wallet_address.substring(user.wallet_address.length - 8)}</span>`;
                        html += `</div>`;
                    }
                });
                resultsDiv.innerHTML = html;
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; border-radius: 8px;">🔍 No users found</div>';
                resultsDiv.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error searching users:', error);
    }
}

window.selectUserForTransfer = function(walletAddress, username) {
    const toAddressInput = document.getElementById('toAddress');
    if (toAddressInput) {
        toAddressInput.value = walletAddress;
    }
    document.getElementById('usernameSearchResults').style.display = 'none';
    document.getElementById('usernameSearch').value = username;
}

// Start polling for balance updates
function startBalancePolling() {
    // Update balances immediately
    updateBalance();
    
    // Then update every 5 seconds
    window.balanceUpdateInterval = setInterval(updateBalance, 5000);
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
    }
}

// Transfer funds
async function transferUSDC() {
    const recipientType = document.getElementById('recipientType').value;
    const toAddressInput = document.getElementById('toAddress');
    const contactSelect = document.getElementById('contactSelect');
    const amountInput = document.getElementById('amount');
    const privateKeyInput = document.getElementById('privateKey');
    const sendBtn = document.getElementById('sendBtn');

    let toAddress = '';
    
    // Get recipient address based on type
    if (recipientType === 'contact') {
        toAddress = contactSelect.value.trim();
    } else if (recipientType === 'search' || recipientType === 'address') {
        toAddress = toAddressInput ? toAddressInput.value.trim() : '';
    }

    const amount = parseFloat(amountInput.value);
    const privateKey = privateKeyInput.value.trim();

    // Validate inputs
    if (!toAddress) {
        showStatus('Please select or enter a recipient address', 'error');
        return;
    }

    // Validate Ethereum address format
    if (!toAddress.startsWith('0x') || toAddress.length !== 42) {
        showStatus('Invalid recipient address format. Address must start with 0x and be 42 characters long.', 'error');
        return;
    }

    // Prevent sending to yourself
    if (window.userWalletAddress && toAddress.toLowerCase() === window.userWalletAddress.toLowerCase()) {
        showStatus('You cannot send money to yourself', 'error');
        return;
    }

    if (isNaN(amount) || amount <= 0) {
        showStatus('Please enter a valid amount greater than 0', 'error');
        return;
    }

    if (!privateKey) {
        showStatus('Please enter your private key to authorize the transaction', 'error');
        return;
    }

    // Validate private key format
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
        showStatus('Invalid private key format. Private key must start with 0x and be 66 characters long.', 'error');
        return;
    }

    try {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="loading"></span> Sending...';
        showStatus('Processing transfer...', 'info');

        const response = await fetch(`${API_BASE_URL}/api/transfer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                toAddress: toAddress,
                amount: amount,
                privateKey: privateKey
            })
        });
        
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login.html';
            return;
        }

        const data = await response.json();

        if (data.success) {
            showStatus(
                `Transfer successful! ${formatAmount(amount)} USDC sent to ${toAddress.substring(0, 10)}... Transaction: ${data.txHash}`,
                'success'
            );
            
            // Clear form
            if (toAddressInput) toAddressInput.value = '';
            amountInput.value = '';
            privateKeyInput.value = '';
            document.getElementById('contactSelect').value = '';
            document.getElementById('usernameSearch').value = '';
            document.getElementById('usernameSearchResults').style.display = 'none';
            
            // Immediately update balance
            await updateBalance();
            
            // Keep updating for a bit to catch confirmations
            setTimeout(updateBalance, 2000);
            setTimeout(updateBalance, 5000);
            
            // Redirect to dashboard after 3 seconds
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
        } else {
            showStatus('Transfer failed: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error transferring funds:', error);
        showStatus('Transfer failed: ' + error.message, 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Payment';
    }
}

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

// Stop polling when page unloads
window.addEventListener('beforeunload', function() {
    if (window.balanceUpdateInterval) {
        clearInterval(window.balanceUpdateInterval);
    }
});

