const express = require('express');
const { connectToDB } = require('../config/db.js');
const { generateToken, authenticate, removeToken, revokeAllUserTokens } = require('../config/auth.js');

const router = express.Router();

// POST /api/login - Log in with token generation
router.post('/login', async (req, res) => {
    try {
        console.log('Login attempt:', req.body);
        
        const { email, password } = req.body;
        const db = await connectToDB();

        const user = await db.collection("user").findOne({ 
            email: email, 
            password: password 
        });
        
        if (!user) {
            return res.status(401).json({ 
                success: false,
                message: 'Login Failed, please check your credentials!' 
            });
        }

        // Generate token for the user
        const token = await generateToken({_id: user._id, email: user.email,});

        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    role: user.role || 'user'
                },
                token: token
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false,
            message: error.message 
        });
    }
});

// POST /api/logout - Log out and remove token
router.post('/logout', authenticate, async (req, res) => {
    try {
        // Extract token from the authenticate middleware
        // The token is already validated by authenticate middleware
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') 
            ? authHeader.split(' ')[1] 
            : null;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'No token provided for logout'
            });
        }

        console.log('Logging out user:', req.user.email);
        console.log('Removing token for user ID:', req.user._id);

        // Remove token from database using the removeToken function from auth.js
        await removeToken(token);

        res.status(200).json({
            success: true,
            message: 'Logged out successfully'
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Error during logout',
            error: error.message
        });
    }
});

module.exports = router;