const express = require('express');
const { connectToDB } = require('../config/db.js');
const router = express.Router();

// GET /test/users - List all users
router.get('/users', async (req, res) => {
  try {
    const db = await connectToDB();
    
    // Get the user collection
    const userCollection = db.collection('user');
    
    // Find all users
    const users = await userCollection.find({}).toArray();
    
    res.status(200).json({
      message: `Found ${users.length} users`,
      data: {
        count: users.length,
        users: users,
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching users',
      error: error.message
    });
  }
});

module.exports = router;