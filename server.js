const express = require('express');
const { connectToDB } = require('./config/db.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const testRoutes = require('./routes/userRoute.js');

// Routes
app.use('/api', testRoutes);

// Initialize database connection and start server
async function startServer() {
  try {
    // Test database connection on startup
    await connectToDB();
    
    // Start the server
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
