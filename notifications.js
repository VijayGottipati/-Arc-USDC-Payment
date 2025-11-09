// Shared notification functionality
const API_BASE_URL = '';

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
        if (panel.style.display === 'none' || !panel.style.display) {
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
window.loadNotifications = loadNotifications;
window.startNotificationPolling = startNotificationPolling;

// Stop polling when page unloads
window.addEventListener('beforeunload', function() {
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

