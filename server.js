const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Connect to MongoDB Atlas ---
// Make sure to replace YOUR_NEW_PASSWORD with your actual password!
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://gamebuildinginc_db_user:YOUR_NEW_PASSWORD@cluster0.5bglhz8.mongodb.net/Message-All?appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas!'))
  .catch(err => console.error('MongoDB Startup Connection Error:', err));

// --- User Schema & Model ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  friends: [{ type: String }]
});

const User = mongoose.model('User', userSchema);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const activeUsers = {};  // { socketId: username }
const messages = { global: [] };

// --- Authentication APIs ---
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = new User({ username, passwordHash, friends: [] });
    await newUser.save();

    res.json({ success: true, username });
  } catch (err) {
    console.error('SIGNUP ERROR LOG:', err);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });

    res.json({ success: true, username });
  } catch (err) {
    console.error('LOGIN ERROR LOG:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// --- Real-time WebSockets ---
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('user_connected', async (username) => {
    currentUser = username;
    activeUsers[socket.id] = username;
    socket.join('global');

    broadcastOnlineUsers();
    await sendFriendList(socket, currentUser);
    socket.emit('chat_history', { room: 'global', messages: messages['global'] || [] });
  });

  socket.on('add_friend', async (targetUsername) => {
    if (!currentUser) return;
    if (targetUsername === currentUser) {
      return socket.emit('friend_error', 'You cannot friend yourself!');
    }

    try {
      const me = await User.findOne({ username: currentUser });
      const target = await User.findOne({ username: targetUsername });

      if (!target) {
        return socket.emit('friend_error', 'User does not exist!');
      }

      if (me.friends.includes(targetUsername)) {
        return socket.emit('friend_error', 'User is already your friend!');
      }

      me.friends.push(targetUsername);
      await me.save();

      if (!target.friends.includes(currentUser)) {
        target.friends.push(currentUser);
        await target.save();
      }

      socket.emit('friend_added', targetUsername);
      await sendFriendList(socket, currentUser);

      const targetSocketId = Object.keys(activeUsers).find(id => activeUsers[id] === targetUsername);
      if (targetSocketId) {
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          await sendFriendList(targetSocket, targetUsername);
        }
      }
    } catch (err) {
      console.error('FRIEND ADD ERROR LOG:', err);
      socket.emit('friend_error', 'Database error adding friend');
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

  async function sendFriendList(userSocket, username) {
    try {
      const user = await User.findOne({ username });
      if (user) {
        userSocket.emit('update_friends', user.friends || []);
      }
    } catch (err) {
      console.error('Error fetching friends:', err);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
