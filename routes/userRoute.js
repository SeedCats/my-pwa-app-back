const express = require('express');
const { connectToDB } = require('../config/db.js');
const { generateToken, authenticate, removeToken, revokeAllUserTokens } = require('../config/auth.js');

const router = express.Router();

// POST /api/register - Register new user
router.post('/user/register', async (req, res) => {
    try {
        console.log('Registration attempt:', req.body);

        const { name, email, password } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, and password are required'
            });
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address'
            });
        }

        // Password length validation
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        const db = await connectToDB();

        // Check if user already exists
        const existingUser = await db.collection("user").findOne({ email: email });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'User already exists with this email'
            });
        }

        // Create new user
        const newUser = {
            name: name,
            email: email,
            password: password, // In production, hash this password
            role: 'user',
            token: "", // Initialize empty token
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection("user").insertOne(newUser);

        if (result.insertedId) {
            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                data: {
                    user: {
                        id: result.insertedId,
                        name: name,
                        email: email,
                        role: 'user'
                    },
                    token: "" // No token on registration
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to create user'
            });
        }

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
});

// DELETE /api/delete - Delete user account (requires password confirmation)
router.delete('/user/delete', authenticate, async (req, res) => {
    try {
        console.log('Account deletion attempt for user:', req.user.email);

        const { password } = req.body;

        // Validation
        if (!password) {
            return res.status(400).json({
                success: false,
                message: 'Password is required to delete account'
            });
        }

        const db = await connectToDB();
        const { ObjectId } = require('../config/db.js');

        // Verify user's password before deletion
        const user = await db.collection("user").findOne({
            _id: new ObjectId(req.user._id),
            password: password
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid password. Account deletion cancelled.'
            });
        }

        // Delete the user account directly from database
        const deleteResult = await db.collection("user").deleteOne({
            _id: new ObjectId(req.user._id)
        });

        if (deleteResult.deletedCount === 1) {
            res.status(200).json({
                success: true,
                message: 'Account deleted successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to delete account. Please try again.'
            });
        }

    } catch (error) {
        console.error('Account deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting account',
            error: error.message
        });
    }
});

// PUT /api/user/profile - Update user profile (name and email only)
router.put('/user/profile', authenticate, async (req, res) => {
    try {
        console.log('Profile update attempt for user:', req.user.email);

        const { name, email } = req.body;

        // Validation
        if (!name && !email) {
            return res.status(400).json({
                success: false,
                message: 'At least one field (name or email) is required to update'
            });
        }

        const db = await connectToDB();
        const { ObjectId } = require('../config/db.js');

        // Prepare update object
        const updateData = {
            updatedAt: new Date()
        };

        // Add fields to update
        if (name) {
            if (name.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Name cannot be empty'
                });
            }
            updateData.name = name.trim();
        }

        if (email) {
            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide a valid email address'
                });
            }

            // Check if email already exists (excluding current user)
            const existingUser = await db.collection("user").findOne({ 
                email: email,
                _id: { $ne: new ObjectId(req.user._id) }
            });

            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already exists'
                });
            }

            updateData.email = email.toLowerCase();
        }

        // Update user profile
        const updateResult = await db.collection("user").updateOne(
            { _id: new ObjectId(req.user._id) },
            { $set: updateData }
        );

        if (updateResult.modifiedCount === 1) {
            // Get updated user data
            const updatedUser = await db.collection("user").findOne(
                { _id: new ObjectId(req.user._id) },
                { projection: { password: 0, token: 0 } }
            );

            res.status(200).json({
                success: true,
                message: 'Profile updated successfully',
                data: {
                    user: {
                        id: updatedUser._id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        role: updatedUser.role,
                        updatedAt: updatedUser.updatedAt
                    }
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to update profile'
            });
        }

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating profile',
            error: error.message
        });
    }
});

// PUT /api/user/password - Update user password only
router.put('/user/password', authenticate, async (req, res) => {
    try {
        console.log('Password update attempt for user:', req.user.email);

        const { currentPassword, newPassword } = req.body;

        // Validation
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password and new password are required'
            });
        }

        // New password length validation
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters long'
            });
        }

        // Check if new password is different from current
        if (currentPassword === newPassword) {
            return res.status(400).json({
                success: false,
                message: 'New password must be different from current password'
            });
        }

        const db = await connectToDB();
        const { ObjectId } = require('../config/db.js');

        // Verify current password
        const user = await db.collection("user").findOne({
            _id: new ObjectId(req.user._id),
            password: currentPassword
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Update password
        const updateResult = await db.collection("user").updateOne(
            { _id: new ObjectId(req.user._id) },
            { 
                $set: { 
                    password: newPassword,
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.modifiedCount === 1) {
            res.status(200).json({
                success: true,
                message: 'Password updated successfully',
                data: {
                    updatedAt: new Date().toISOString()
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to update password'
            });
        }

    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating password',
            error: error.message
        });
    }
});

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
        const token = await generateToken({ _id: user._id, email: user.email, });

        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    name: user.name,
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