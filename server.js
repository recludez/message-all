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

// In-memory data store (replace with DB like MongoDB or PostgreSQL for production)
const users = {};       // { username: { passwordHash } }
const activeUsers = {};  // { socketId: username }
const messages = {
  global: []            // Default group chat
};

// --- Authentication APIs ---
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users[username]) return res.status(400).json({ error: 'User already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  users[username] = { passwordHash };
  res.json({ success: true, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user) return res.status(400).json({ error: 'User not found' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(400).json({ error: 'Invalid password' });

  res.json({ success: true, username });
});

// --- Real-time WebSockets ---
io.on('connection', (socket) => {
  let currentUser = null;

  // User authenticates over socket connection
  socket.on('user_connected', (username) => {
    currentUser = username;
    activeUsers[socket.id] = username;
    socket.join('global'); // Join global group by default

    broadcastOnlineUsers();
    
    // Send existing global history
    socket.emit('chat_history', { room: 'global', messages: messages['global'] || [] });
  });

  // Handle messages (Group or Direct Message)
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
      // Find socket of target user
      const targetSocketId = Object.keys(activeUsers).find(
        (id) => activeUsers[id] === target
      );

      // Unique room identifier for 1-on-1 DM history
      const dmRoomId = [currentUser, target].sort().join('_');
      if (!messages[dmRoomId]) messages[dmRoomId] = [];
      messages[dmRoomId].push(msgData);

      // Send to recipient if online
      if (targetSocketId) {
        io.to(targetSocketId).emit('receive_message', msgData);
      }
      // Echo back to sender
      socket.emit('receive_message', msgData);
    } else {
      // Group Chat
      if (!messages[target]) messages[target] = [];
      messages[target].push(msgData);
      
      io.to(target).emit('receive_message', msgData);
    }
  });

  // Fetch private chat history
  socket.on('get_dm_history', (targetUser) => {
    const dmRoomId = [currentUser, targetUser].sort().join('_');
    socket.emit('chat_history', {
      room: targetUser,
      messages: messages[dmRoomId] || []
    });
  });

  // User disconnects
  socket.on('disconnect', () => {
    delete activeUsers[socket.id];
    broadcastOnlineUsers();
  });

  function broadcastOnlineUsers() {
    const onlineList = Array.from(new Set(Object.values(activeUsers)));
    io.emit('update_online_users', onlineList);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
