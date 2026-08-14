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

// Extended user objects to store friend lists
const users = {};        // { username: { passwordHash, friends: [] } }
const activeUsers = {};  // { socketId: username }
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

  // Handle adding friends
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

    // Add target to user's friend list
    myFriends.push(targetUsername);

    // Reciprocate: Add user to target's friend list
    if (!users[targetUsername].friends) users[targetUsername].friends = [];
    if (!users[targetUsername].friends.includes(currentUser)) {
      users[targetUsername].friends.push(currentUser);
    }

    socket.emit('friend_added', targetUsername);
    sendFriendList(socket);

    // Update target user's UI if they are online
    const targetSocketId = Object.keys(activeUsers).find(id => activeUsers[id] === targetUsername);
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) sendFriendList(targetSocket);
    }
  });

  socket.on('send_message', ({ target, text, isDM }) => {
    if (!currentUser || !text.
