const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { connectToDB } = require('./config/db.js');

const app = express();

// Configuration constants
const PORT = process.env.PORT || 5000;
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://my-pwa-app-front.vercel.app'
];

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    console.log('Request from origin:', origin);
    
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    
    console.log('CORS blocked origin:', origin);
    console.log('Allowed origins:', ALLOWED_ORIGINS);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

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

// Root route - shows API is running
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend API is running',
    endpoints: {
      users: '/api',
      data: '/api/data',
      ai: '/api/ai',
      grok: '/api/grok',
      health: '/health'
    }
  });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Routes - mount directly on /api, frontend will call /api/"endpoint" for user routes
app.use('/api', userRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/grok', grokRoutes);

// Initialize database connection and start server
async function startServer() {
  try {
    const db = await connectToDB();
    
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n${signal} received, closing server gracefully...`);
      server.close(async () => {
        console.log('HTTP server closed');
        if (db?.client) {
          await db.client.close();
          console.log('MongoDB connection closed');
        }
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
