// --- GLOBAL STATE ---
let socket;
let currentUser = null;
let currentUserAvatar = 'https://i.imgur.com/6VBx3io.png';
let currentTarget = 'global';
let isDM = false;
let isServerChannel = false;
let currentChannelId = null;
let isLoginMode = true;

// --- HELPER: Escape HTML to prevent XSS ---
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- AUTHENTICATION ---
function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById('auth-title').innerText = isLoginMode ? 'Login' : 'Sign Up';
  document.getElementById('auth-btn').innerText = isLoginMode ? 'Login' : 'Sign Up';
  document.querySelector('.toggle-auth').innerText = isLoginMode 
    ? 'Need an account? Sign Up' 
    : 'Have an account? Login';
}

async function handleAuth() {
  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  
  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';

  if (!username || !password) return alert('Please fill in all fields.');

  const endpoint = isLoginMode ? '/api/login' : '/api/signup';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Authentication failed');

    currentUser = data.username || username;
    await fetchMyProfile();

    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');

    const userDisplay = document.getElementById('user-display');
    if (userDisplay) {
      userDisplay.innerText = `@${currentUser}`;
      userDisplay.onclick = () => openProfileModal(currentUser);
    }

    initSocket();
    loadUserServers();
  } catch (err) {
    console.error('Auth Error:', err);
    alert('Failed to connect to authentication server.');
  }
}

// --- WEBSOCKET INITIALIZATION ---
function initSocket() {
  socket = io();

  socket.emit('user_connected', currentUser);

  socket.on('update_online_users', (onlineUsers) => {
    const list = document.getElementById('users-list');
    if (!list) return;
    list.innerHTML = '';
    onlineUsers.forEach(user => {
      if (user === currentUser) return;
      const li = document.createElement('li');
      li.innerHTML = `<span onclick="openProfileModal('${escapeHTML(user)}')">${escapeHTML(user)}</span> <div class="status-indicator"></div>`;
      li.onclick = (e) => {
        if (e.target.tagName !== 'SPAN') switchTarget(user, true, false);
      };
      list.appendChild(li);
    });
  });

  socket.on('update_friends', (friends) => {
    const list = document.getElementById('friends-list');
    if (!list) return;
    list.innerHTML = '';
    if (!friends || friends.length === 0) {
      list.innerHTML = `<li style="color: #a0a0a0; font-size: 0.85em;">No friends added yet</li>`;
      return;
    }
    friends.forEach(friend => {
      const li = document.createElement('li');
      li.innerHTML = `<span>👤 ${escapeHTML(friend)}</span>`;
      li.onclick = () => switchTarget(friend, true, false);
      list.appendChild(li);
    });
  });

  socket.on('friend_added', (friend) => alert(`You are now friends with ${friend}!`));
  socket.on('friend_error', (msg) => alert(msg));

  socket.on('chat_history', ({ messages }) => {
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = '';
    if (messages) messages.forEach(appendMessageToUI);
  });

  socket.on('receive_message', (msg) => appendMessageToUI(msg));
  socket.on('receive_channel_message', (msg) => appendMessageToUI(msg));
  
  socket.on('profile_updated', (updatedUser) => {
    if (updatedUser.username === currentUser) {
      currentUserAvatar = updatedUser.avatar || currentUserAvatar;
    }
  });
}

// --- PROFILE ACTIONS ---
async function fetchMyProfile() {
  try {
    const res = await fetch(`/api/profile/${currentUser}`);
    const data = await res.json();
    if (data.avatar) currentUserAvatar = data.avatar;
  } catch (err) {
    console.error('Error fetching profile:', err);
  }
}

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
      currentUserAvatar = avatarUrl;
      alert("Profile picture updated!");
    }
  } catch (err) {
    console.error("Error updating profile picture:", err);
  }
}

async function saveProfileChanges() {
  const bio = document.getElementById('edit-bio-input')?.value || '';
  const status = document.getElementById('edit-status-input')?.value || '';
  const avatar = document.getElementById('edit-avatar-input')?.value || '';
  const banner = document.getElementById('edit-banner-input')?.value || '';

  try {
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, bio, avatar, banner, status })
    });

    const data = await res.json();
    if (data.success) {
      if (avatar) currentUserAvatar = avatar;
      alert('Profile updated!');
      openProfileModal(currentUser);
    }
  } catch (err) {
    console.error('Error updating profile:', err);
  }
}

async function openProfileModal(username) {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/profile/${username}`);
    const data = await res.json();

    document.getElementById('profile-card-username').innerText = data.username || username;
    document.getElementById('profile-card-bio').innerText = data.bio || 'No bio set yet!';
    document.getElementById('profile-card-status').innerText = data.status || 'Online';
    document.getElementById('profile-card-avatar').src = data.avatar || 'https://i.imgur.com/6VBx3io.png';

    const editSection = document.getElementById('edit-profile-section');
    if (editSection) {
      if (username === currentUser) {
        editSection.classList.remove('hidden');
        if (document.getElementById('edit-bio-input')) document.getElementById('edit-bio-input').value = data.bio || '';
        if (document.getElementById('edit-status-input')) document.getElementById('edit-status-input').value = data.status || '';
        if (document.getElementById('edit-avatar-input')) document.getElementById('edit-avatar-input').value = data.avatar || '';
      } else {
        editSection.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Error opening profile:', err);
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.classList.add('hidden');
}

// --- NAVIGATION & CHAT TARGET SWITCHING ---
function switchTarget(target, dmFlag = false, channelFlag = false, channelId = null) {
  currentTarget = target;
  isDM = dmFlag;
  isServerChannel = channelFlag;
  currentChannelId = channelId;

  const chatHeader = document.getElementById('chat-title');
  if (chatHeader) {
    if (isServerChannel) chatHeader.innerText = `# ${target}`;
    else if (isDM) chatHeader.innerText = `@${target}`;
    else chatHeader.innerText = `# ${target}`;
  }

  const box = document.getElementById('chat-messages');
  if (box) box.innerHTML = '';

  if (isServerChannel && channelId) {
    socket.emit('join_channel', channelId);
  } else if (isDM) {
    socket.emit('get_dm_history', currentTarget);
  } else {
    socket.emit('user_connected', currentUser);
  }
}

// --- MESSAGING ---
function sendMessage(messageText, targetChat, dmFlag) {
  const text = messageText || document.getElementById('message-input')?.value.trim();
  const target = targetChat || currentTarget;
  const dm = dmFlag !== undefined ? dmFlag : isDM;

  if (!text || !socket) return;

  if (isServerChannel && currentChannelId) {
    socket.emit('send_channel_message', {
      channelId: currentChannelId,
      text
    });
  } else {
    socket.emit('send_message', {
      target: target,
      text: text,
      isDM: dm,
      avatar: currentUserAvatar
    });
  }

  const input = document.getElementById('message-input');
  if (input) input.value = '';
}

// --- UI: Render Message in Chat ---
function appendMessageToUI(msg) {
  const chatBox = document.getElementById('chat-messages');
  if (!chatBox) return;

  // Filter messages for current room view
  if (isDM && msg.target !== currentTarget && msg.sender !== currentTarget) return;
  if (!isDM && !isServerChannel && msg.isDM) return;

  const msgElement = document.createElement('div');
  msgElement.classList.add('message-row');

  msgElement.innerHTML = `
    <img src="${msg.avatar || 'https://i.imgur.com/6VBx3io.png'}" class="chat-pfp" alt="PFP" onclick="openProfileModal('${escapeHTML(msg.sender)}')">
    <div class="message-content">
      <div class="message-header">
        <span class="username" onclick="openProfileModal('${escapeHTML(msg.sender)}')">${escapeHTML(msg.sender)}</span>
        <span class="timestamp">${escapeHTML(msg.timestamp || '')}</span>
      </div>
      <p class="message-text">${escapeHTML(msg.text)}</p>
    </div>
  `;

  chatBox.appendChild(msgElement);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// --- FRIEND & COMMUNITY SERVER ACTIONS ---
function addFriend() {
  const input = document.getElementById('friend-input');
  const target = input ? input.value.trim() : '';
  if (!target || !socket) return;
  socket.emit('add_friend', target);
  if (input) input.value = '';
}

async function loadUserServers() {
  try {
    const res = await fetch(`/api/servers/user/${currentUser}`);
    const servers = await res.json();
    const list = document.getElementById('servers-list');
    if (!list) return;

    list.innerHTML = '';
    servers.forEach(srv => {
      const li = document.createElement('li');
      li.innerText = `🛡️ ${srv.name}`;
      li.onclick = () => {
        if (srv.channels && srv.channels.length > 0) {
          switchTarget(srv.channels[0].name, false, true, srv.channels[0]._id);
        }
      };
      list.appendChild(li);
    });
  } catch (err) {
    console.error('Error loading servers:', err);
  }
}
