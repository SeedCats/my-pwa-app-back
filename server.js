const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { connectToDB } = require('./config/db.js');

const app = express();
const PORT = process.env.PORT || 5000;

// Allowed origins
const allowedOrigins = ['http://localhost:5173', 'http://localhost:4173'];

// Only allows this origin to access the server
app.use(cors({
  origin: function (origin, callback) {
    console.log('CORS request from origin:', origin);
    // Allow requests with no origin (like mobile apps, curl, or same-origin)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Cookie parser middleware
app.use(cookieParser());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Import routes
const userRoutes = require('./routes/userRoute.js');
const dataRoutes = require('./routes/data.js');
const aiRoutes = require('./routes/aiChat.js');
const grokRoutes = require('./routes/grokChat.js');

// Routes - mount directly on /api, frontend will call /api/"endpoint" for user routes
app.use('/api', userRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/grok', grokRoutes);

// Initialize database connection and start server
async function startServer() {
  try {
    await connectToDB();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
