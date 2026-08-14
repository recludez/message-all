// Function to save profile updates (including PFP)
async function updatePFP(avatarUrl) {
  const res = await fetch('/api/profile/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentUser,
      avatar: avatarUrl // e.g. "https://i.imgur.com/6VBx3io.png"
    })
  });

  const data = await res.json();
  if (data.success) {
    alert("Profile picture updated!");
  }
}

// Example sending message with PFP attached
socket.emit('send_message', {
  target: activeChat,
  text: messageText,
  isDM: isCurrentChatDM,
  avatar: currentUserAvatar || 'https://i.imgur.com/6VBx3io.png' // Fallback image if none set
});

function appendMessageToUI(msg) {
  const chatBox = document.getElementById('chat-messages');

  // Create message container
  const msgElement = document.createElement('div');
  msgElement.classList.add('message-row');

  // Build the message HTML with Avatar
  msgElement.innerHTML = `
    <img src="${msg.avatar || 'https://i.imgur.com/6VBx3io.png'}" class="chat-pfp" alt="PFP">
    <div class="message-content">
      <div class="message-header">
        <span class="username" onclick="openProfileModal('${msg.sender}')">${msg.sender}</span>
        <span class="timestamp">${msg.timestamp}</span>
      </div>
      <p class="message-text">${msg.text}</p>
    </div>
  `;

  chatBox.appendChild(msgElement);
}
