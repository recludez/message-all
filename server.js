const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const users = {};        
const activeUsers = {};  
const messages = { global: [] };

// --- Authentication APIs ---
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users[username]) return res.status(400).json({ error: 'User already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  users[username] = { passwordHash, friends: [] };
  res.json({ success: true, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user) return res.status(400).json({ error: 'User not found' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(400).json({ error: 'Invalid password' });

  if (!user.friends) user.friends = [];

  res.json({ success: true, username });
});

// --- Real-time WebSockets ---
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('user_connected', (username) => {
    currentUser = username;
    activeUsers[socket.id] = username;
    socket.join('global');

    if (users[currentUser] && !users[currentUser].friends) {
      users[currentUser].friends = [];
    }

    broadcastOnlineUsers();
    sendFriendList(socket);
    socket.emit('chat_history', { room: 'global', messages: messages['global'] || [] });
  });

  socket.on('add_friend', (targetUsername) => {
    if (!currentUser) return;
    if (targetUsername === currentUser) {
      return socket.emit('friend_error', 'You cannot friend yourself!');
    }
    if (!users[targetUsername]) {
      return socket.emit('friend_error', 'User does not exist!');
    }

    const myFriends = users[currentUser].friends;
    if (myFriends.includes(targetUsername)) {
      return socket.emit('friend_error', 'User is already your friend!');
    }

    myFriends.push(targetUsername);

    if (!users[targetUsername].friends) users[targetUsername].friends = [];
    if (!users[targetUsername].friends.includes(currentUser)) {
      users[targetUsername].friends.push(currentUser);
    }

    socket.emit('friend_added', targetUsername);
    sendFriendList(socket);

    const targetSocketId = Object.keys(activeUsers).find(id => activeUsers[id] === targetUsername);
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) sendFriendList(targetSocket);
    }
  });

  socket.on('send_message', ({ target, text, isDM }) => {
    if (!currentUser || !text.trim()) return;

    const msgData = {
      sender: currentUser,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      target,
      isDM
    };

    if (isDM) {
      const targetSocketId = Object.keys(activeUsers).find(id => activeUsers[id] === target);
      const dmRoomId = [currentUser, target].sort().join('_');
      if (!messages[dmRoomId]) messages[dmRoomId] = [];
      messages[dmRoomId].push(msgData);

      if (targetSocketId) {
        io.to(targetSocketId).emit('receive_message', msgData);
      }
      socket.emit('receive_message', msgData);
    } else {
      if (!messages[target]) messages[target] = [];
      messages[target].push(msgData);
      io.to(target).emit('receive_message', msgData);
    }
  });

  socket.on('get_dm_history', (targetUser) => {
    const dmRoomId = [currentUser, targetUser].sort().join('_');
    socket.emit('chat_history', {
      room: targetUser,
      messages: messages[dmRoomId] || []
    });
  });

  socket.on('disconnect', () => {
    delete activeUsers[socket.id];
    broadcastOnlineUsers();
  });

  function broadcastOnlineUsers() {
    const onlineList = Array.from(new Set(Object.values(activeUsers)));
    io.emit('update_online_users', onlineList);
  }

  function sendFriendList(userSocket) {
    const username = activeUsers[userSocket.id];
    if (username && users[username]) {
      userSocket.emit('update_friends', users[username].friends || []);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
