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
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('FATAL ERROR: MONGO_URI environment variable is not defined on Render.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas!'))
  .catch(err => console.error('MongoDB Startup Connection Error:', err));

// --- Schemas & Models ---

// 1. User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  friends: [{ type: String }],
  bio: { type: String, default: "Hey there! I am using ChatApp." },
  avatar: { type: String, default: "https://i.imgur.com/6VBx3io.png" },
  banner: { type: String, default: "" },
  status: { type: String, default: "Online" },
  customStatus: { type: String, default: "" }
});

const User = mongoose.model('User', userSchema);

// 2. Server Schema (Community Hubs)
const serverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: String, required: true },
  members: [{ type: String }],
  channels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }]
});

const ServerModel = mongoose.model('Server', serverSchema);

// 3. Channel Schema (Rooms within a Server)
const channelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server', required: true }
});

const Channel = mongoose.model('Channel', channelSchema);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const activeUsers = {};  // { socketId: username }
const messages = { global: [] }; // In-memory message store for global & DMs

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

// --- Profile APIs ---

app.get('/api/profile/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }, 'username bio avatar banner status customStatus');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/profile/update', async (req, res) => {
  const { username, bio, avatar, banner, status, customStatus } = req.body;
  try {
    const updatedUser = await User.findOneAndUpdate(
      { username },
      { bio, avatar, banner, status, customStatus },
      { new: true, fields: 'username bio avatar banner status customStatus' }
    );
    
    io.emit('profile_updated', updatedUser);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error('PROFILE UPDATE ERROR:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// --- Server & Channel APIs ---

// Create a new Server with a default 'general' channel
app.post('/api/servers/create', async (req, res) => {
  const { name, owner } = req.body;
  if (!name || !owner) return res.status(400).json({ error: 'Server name and owner are required' });

  try {
    const newServer = new ServerModel({ name, owner, members: [owner] });
    await newServer.save();

    const defaultChannel = new Channel({ name: 'general', serverId: newServer._id });
    await defaultChannel.save();

    newServer.channels.push(defaultChannel._id);
    await newServer.save();

    res.json({ success: true, server: newServer, defaultChannel });
  } catch (err) {
    console.error('CREATE SERVER ERROR:', err);
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// Get all servers a user belongs to
app.get('/api/servers/user/:username', async (req, res) => {
  try {
    const userServers = await ServerModel.find({ members: req.params.username }).populate('channels');
    res.json(userServers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user servers' });
  }
});

// Create a new channel inside an existing server
app.post('/api/servers/:serverId/channels', async (req, res) => {
  const { name } = req.body;
  const { serverId } = req.params;

  try {
    const channel = new Channel({ name, serverId });
    await channel.save();

    await ServerModel.findByIdAndUpdate(serverId, { $push: { channels: channel._id } });

    io.to(`server_${serverId}`).emit('channel_created', channel);
    res.json({ success: true, channel });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// --- Real-Time WebSockets ---

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

  // Join a Discord-style Channel Room
  socket.on('join_channel', (channelId) => {
    socket.join(`channel_${channelId}`);
    socket.emit('chat_history', {
      room: channelId,
      messages: messages[`channel_${channelId}`] || []
    });
  });

  // Send message to a Channel
  socket.on('send_channel_message', ({ channelId, text }) => {
    if (!currentUser || !text.trim()) return;

    const msgData = {
      sender: currentUser,
      text,
      channelId,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const roomId = `channel_${channelId}`;
    if (!messages[roomId]) messages[roomId] = [];
    messages[roomId].push(msgData);

    io.to(roomId).emit('receive_channel_message', msgData);
  });

  // Add Friend Logic
  socket.on('add_friend', async (targetUsername) => {
    if (!currentUser) return;
    if (targetUsername === currentUser) {
      return socket.emit('friend_error', 'You cannot friend yourself!');
    }

    try {
      const me = await User.findOne({ username: currentUser });
      const target = await User.findOne({ username: targetUsername });

      if (!target) return socket.emit('friend_error', 'User does not exist!');
      if (me.friends.includes(targetUsername)) return socket.emit('friend_error', 'User is already your friend!');

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
        if (targetSocket) await sendFriendList(targetSocket, targetUsername);
      }
    } catch (err) {
      console.error('FRIEND ADD ERROR LOG:', err);
      socket.emit('friend_error', 'Database error adding friend');
    }
  });

  // Global & DM Message Handling
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

      if (targetSocketId) io.to(targetSocketId).emit('receive_message', msgData);
      socket.emit('receive_message', msgData);
    } else {
      if (!messages['global']) messages['global'] = [];
      messages['global'].push(msgData);
      
      io.to('global').emit('receive_message', msgData);
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
