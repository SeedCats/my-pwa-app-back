const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { connectToDB } = require('./config/db.js');

const app = express();
const PORT = process.env.PORT || 5000;

// Only allows this origin to access the server
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  credentials: true
}));

// Cookie parser middleware
app.use(cookieParser());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const userRoutes = require('./routes/userRoute.js');
const dataRoutes = require('./routes/data.js');

// Routes - mount directly on /api, frontend will call /api/"endpoint" for user routes
app.use('/api', userRoutes);
app.use('/api/data', dataRoutes);

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
