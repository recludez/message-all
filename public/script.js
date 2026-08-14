// --- HELPER: Escape HTML to prevent XSS ---
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- PROFILE: Update PFP ---
async function updatePFP(avatarUrl) {
  try {
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        avatar: avatarUrl
      })
    });

    const data = await res.json();
    if (data.success) {
      currentUserAvatar = avatarUrl; // Update local state
      alert("Profile picture updated!");
    }
  } catch (err) {
    console.error("Error updating profile picture:", err);
  }
}

// --- MESSAGING: Send Message Helper ---
function sendMessage(messageText, targetChat, isDM) {
  if (!messageText.trim()) return;

  socket.emit('send_message', {
    target: targetChat,
    text: messageText,
    isDM: isDM,
    avatar: currentUserAvatar || 'https://i.imgur.com/6VBx3io.png'
  });
}

// --- UI: Render Message in Chat ---
function appendMessageToUI(msg) {
  const chatBox = document.getElementById('chat-messages');
  if (!chatBox) return;

  const msgElement = document.createElement('div');
  msgElement.classList.add('message-row');

  // Build HTML safely using escapeHTML
  msgElement.innerHTML = `
    <img src="${msg.avatar || 'https://i.imgur.com/6VBx3io.png'}" class="chat-pfp" alt="PFP" onclick="openProfileModal('${escapeHTML(msg.sender)}')">
    <div class="message-content">
      <div class="message-header">
        <span class="username" onclick="openProfileModal('${escapeHTML(msg.sender)}')">${escapeHTML(msg.sender)}</span>
        <span class="timestamp">${escapeHTML(msg.timestamp)}</span>
      </div>
      <p class="message-text">${escapeHTML(msg.text)}</p>
    </div>
  `;

  chatBox.appendChild(msgElement);
  chatBox.scrollTop = chatBox.scrollHeight; // Keep chat scrolled to bottom
}
