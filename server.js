const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Configure socket.io with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// MongoDB connection string
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://manojgithub1234:vkBFq6SQ5kultevI@cluster0.b5nih9m.mongodb.net/chatdb?retryWrites=true&w=majority&appName=Cluster0';

// Database connection state
let isDbConnected = false;

// Connect to MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ MongoDB Connected');
  isDbConnected = true;
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  isDbConnected = false;
});

// Monitor database connection
mongoose.connection.on('connected', () => {
  isDbConnected = true;
  io.emit('db_status', true);
  console.log('MongoDB connection established');
});

mongoose.connection.on('disconnected', () => {
  isDbConnected = false;
  io.emit('db_status', false);
  console.log('MongoDB connection lost');
});

mongoose.connection.on('error', (err) => {
  isDbConnected = false;
  io.emit('db_status', false);
  console.error('MongoDB connection error:', err);
});

// Define Message Schema
const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Create Message model
const Message = mongoose.model('Message', messageSchema);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the index.html file for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Track connected clients
let clients = [];

// Generate a random username
function generateUsername() {
  const adjectives = ['Happy', 'Clever', 'Brave', 'Swift', 'Gentle', 'Witty', 'Calm', 'Bright', 'Kind'];
  const nouns = ['Panda', 'Tiger', 'Turtle', 'Eagle', 'Dolphin', 'Wolf', 'Fox', 'Bear', 'Lion'];
  
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNumber = Math.floor(Math.random() * 100);
  
  return `${randomAdjective}${randomNoun}${randomNumber}`;
}

// Send updated user list to all clients
function broadcastUserList() {
  io.emit('users_list', clients.map(client => ({
    id: client.id,
    name: client.name,
    color: client.color
  })));
}

// Socket.IO connection handling
io.on('connection', async (socket) => {
  try {
    // Generate a unique username and random color for the client
    const userName = generateUsername();
    const userColor = '#' + Math.floor(Math.random()*16777215).toString(16);
    
    // Add client to list
    clients.push({ 
      id: socket.id, 
      name: userName,
      color: userColor
    });
    
    // Emit database connection status to the client
    socket.emit('db_status', isDbConnected);
    
    // Emit the username to the client
    socket.emit('user_name', userName);
    
    // Update client count for all users
    io.emit('client_count', clients.length);
    
    // Send updated user list to all clients
    broadcastUserList();
    
    // Handle client joining the chat
    socket.on('join_chat', async () => {
      // Send system message about new user
      const joinMessage = {
        sender: 'System',
        message: `${userName} has joined the chat.`,
        timestamp: new Date()
      };
      
      // Save the system message if database is connected
      if (isDbConnected) {
        try {
          await new Message(joinMessage).save();
        } catch (err) {
          console.error('Error saving join message:', err);
        }
      }
      
      // Broadcast to all clients
      io.emit('receive_message', joinMessage);
      
      // Send previous messages to the new client
      if (isDbConnected) {
        try {
          const previousMessages = await Message.find()
            .sort({ timestamp: 1 })
            .limit(50)
            .lean();
          
          socket.emit('previous_messages', previousMessages);
        } catch (err) {
          console.error('Error fetching previous messages:', err);
          socket.emit('previous_messages', []);
        }
      } else {
        socket.emit('previous_messages', []);
      }
    });
    
    // Handle message from client
    socket.on('send_message', async (data) => {
      try {
        const messageData = {
          sender: data.sender,
          message: data.message,
          timestamp: new Date()
        };
        
        // Create and save the new message if database is connected
        if (isDbConnected) {
          const newMessage = new Message(messageData);
          await newMessage.save();
        }
        
        // Broadcast the message to all clients
        io.emit('receive_message', messageData);
      } catch (err) {
        console.error('Error saving message:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });
    
    // Handle typing indicator
    socket.on('typing', () => {
      socket.broadcast.emit('user_typing', userName);
    });
    
    socket.on('stop_typing', () => {
      socket.broadcast.emit('user_stop_typing');
    });
    
    // Handle client disconnect
    socket.on('disconnect', async () => {
      // Find and remove the client from our list
      const index = clients.findIndex(client => client.id === socket.id);
      if (index !== -1) {
        const disconnectedUser = clients[index];
        clients.splice(index, 1);
        
        // Update client count
        io.emit('client_count', clients.length);
        
        // Update user list
        broadcastUserList();
        
        // Send system message about user leaving
        const leaveMessage = {
          sender: 'System',
          message: `${disconnectedUser.name} has left the chat.`,
          timestamp: new Date()
        };
        
        // Save the message if database is connected
        if (isDbConnected) {
          try {
            await new Message(leaveMessage).save();
          } catch (err) {
            console.error('Error saving disconnect message:', err);
          }
        }
        
        io.emit('receive_message', leaveMessage);
      }
    });
  } catch (err) {
    console.error('Socket connection error:', err);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    server: 'online',
    database: isDbConnected ? 'connected' : 'disconnected',
    clients: clients.length
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Server running on http://localhost:${PORT}`);
});