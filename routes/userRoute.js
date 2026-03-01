const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { generateToken, authenticate, removeToken, revokeAllUserTokens, checkRole } = require('../config/auth.js');

const router = express.Router();

// Validation constants
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const COOKIE_MAX_AGE = {
  REMEMBER: 7 * 24 * 60 * 60 * 1000,  // 7 days
  DEFAULT: 24 * 60 * 60 * 1000         // 1 day
};

const getCookieOptions = (req, remember = false) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const useSecureCookie = isProduction || isHttps;

    return {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: useSecureCookie ? 'none' : 'lax',
        maxAge: remember ? COOKIE_MAX_AGE.REMEMBER : COOKIE_MAX_AGE.DEFAULT
    };
};

const getClearCookieOptions = (req) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const useSecureCookie = isProduction || isHttps;

    return {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: useSecureCookie ? 'none' : 'lax'
    };
};

// Validation helpers
const validateEmail = (email) => EMAIL_REGEX.test(email);
const validatePassword = (password) => password && password.length >= MIN_PASSWORD_LENGTH;

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

        // Email validation
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address'
            });
        }

        // Password validation
        if (!validatePassword(password)) {
            return res.status(400).json({
                success: false,
                message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
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

        // Find admin users and assign one randomly as the healthcare provider (if any exist)
        let assignedProviderId = null;
        let assignedProviderName = null;
        try {
            const admins = await db.collection("user").find({ role: 'admin' }, { projection: { _id: 1, name: 1 } }).toArray();
            if (admins && admins.length > 0) {
                const chosen = admins[Math.floor(Math.random() * admins.length)];
                assignedProviderId = chosen._id; // already an ObjectId
                assignedProviderName = chosen.name;
            } else {
                console.warn('No admin users found to assign as provider for new user:', email);
            }
        } catch (err) {
            console.error('Error fetching admins for provider assignment:', err);
        }

        const newUser = {
            name: name,
            email: email,
            password: password, // In production, hash this password
            role: 'user',
            status: 'On-going',
            statusUpdatedAt: new Date(),
            ...(assignedProviderId ? { providerId: assignedProviderId, providerName: assignedProviderName } : {}),
            token: "", // Initialize empty token
            icon: "", // Initialize empty icon
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection("user").insertOne(newUser);

        if (result.insertedId) {
            // Generate token for the user after registration (include role)
            const token = await generateToken({ _id: result.insertedId, email: email, role: newUser.role });

            // Set HttpOnly cookie (same as login)
            res.cookie('token', token, getCookieOptions(req));

            // If an admin provider was assigned, add this user's id to that admin's UserList
            if (assignedProviderId) {
                try {
                    await db.collection('user').updateOne(
                        { _id: assignedProviderId },
                        { $addToSet: { UserList: result.insertedId } }
                    );
                } catch (err) {
                    console.error('Error updating admin UserList after registration:', err);
                }
            }

            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                data: {
                    user: {
                        id: result.insertedId,
                        name: name,
                        email: email,
                        role: 'user',
                        status: 'On-going',
                        icon: "",
                        providerId: assignedProviderId ? assignedProviderId.toString() : null,
                        providerName: assignedProviderName
                    },
                    token: token
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

// GET /api/admin/assigned-users - Get users assigned to the authenticated admin
router.get('/admin/assigned-users', authenticate, checkRole(['admin']), async (req, res) => {
    try {
        const db = await connectToDB();
        const adminId = new ObjectId(req.user._id);

        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            db.collection('user')
                .find({ providerId: adminId })
                .project({ password: 0, token: 0 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('user').countDocuments({ providerId: adminId })
        ]);

        const formatted = users.map(u => ({
            id: u._id.toString(),
            name: u.name,
            email: u.email,
            role: u.role,
            icon: u.icon || "",
            providerId: u.providerId ? u.providerId.toString() : null,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt
        }));

        res.status(200).json({
            success: true,
            data: {
                users: formatted,
                total,
                page,
                limit
            }
        });
    } catch (err) {
        console.error('Error fetching assigned users:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch assigned users',
            error: err.message
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

        const userId = new ObjectId(req.user._id);

        // Delete all user-related data from all collections
        const deletionResults = await Promise.all([
            // Delete BMI data
            db.collection("bmiData").deleteMany({ userId: userId }),
            // Delete heart rate data
            db.collection("heartrate_daily").deleteMany({ userId: userId }),
            // Delete AI chat conversations
            db.collection("aichats").deleteMany({ userId: userId }),
            // Delete Grok chat conversations
            db.collection("grokchats").deleteMany({ userId: userId }),
            // Delete the user account
            db.collection("user").deleteOne({ _id: userId })
        ]);

        const userDeleteResult = deletionResults[4]; // User deletion is the last operation

        if (userDeleteResult.deletedCount === 1) {
            console.log('Account and all related data deleted for user:', req.user.email);
            console.log('Deletion summary:', {
                bmiRecords: deletionResults[0].deletedCount,
                heartRateRecords: deletionResults[1].deletedCount,
                aiChats: deletionResults[2].deletedCount,
                grokChats: deletionResults[3].deletedCount
            });

            // If this user was assigned to an admin, remove them from that admin's UserList
            try {
                if (user && user.providerId) {
                    await db.collection('user').updateOne(
                        { _id: user.providerId },
                        { $pull: { UserList: user._id } }
                    );
                }
            } catch (err) {
                console.error('Error removing user from admin UserList during account deletion:', err);
            }

            res.status(200).json({
                success: true,
                message: 'Account and all related data deleted successfully'
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

// PUT /api/user/profile - Update user profile (name, email, and icon)
router.put('/user/profile', authenticate, async (req, res) => {
    try {
        console.log('Profile update attempt for user:', req.user.email);

        const { name, email, icon } = req.body;

        // Validation
        if (!name && !email && icon === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field (name, email, or icon) is required to update'
            });
        }

        const db = await connectToDB();

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
            if (!validateEmail(email)) {
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

        if (icon !== undefined) {
            // Basic validation to ensure it's a base64 image string if not empty
            if (icon !== "" && !icon.startsWith('data:image/')) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid image format. Must be a base64 encoded image.'
                });
            }
            updateData.icon = icon;
        }

        // address is only valid for admin users
        const { address } = req.body;
        if (address !== undefined) {
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Address field is only available for admin users'
                });
            }
            updateData.address = address.trim();
        }

        // Update user profile
        const updateResult = await db.collection("user").updateOne(
            { _id: new ObjectId(req.user._id) },
            { $set: updateData }
        );

        if (updateResult.modifiedCount === 1 || updateResult.matchedCount === 1) {
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
                        icon: updatedUser.icon,
                        ...(updatedUser.role === 'admin' ? { address: updatedUser.address || "" } : {}),
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

// PUT /api/user/icon - Update user icon
router.put('/user/icon', authenticate, async (req, res) => {
    try {
        const { icon } = req.body;

        if (!icon) {
            return res.status(400).json({
                success: false,
                message: 'Icon data is required'
            });
        }

        // Basic validation to ensure it's a base64 image string
        if (!icon.startsWith('data:image/')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid image format. Must be a base64 encoded image.'
            });
        }

        const db = await connectToDB();

        const updateResult = await db.collection("user").updateOne(
            { _id: new ObjectId(req.user._id) },
            { 
                $set: { 
                    icon: icon,
                    updatedAt: new Date()
                } 
            }
        );

        if (updateResult.modifiedCount === 1 || updateResult.matchedCount === 1) {
            res.status(200).json({
                success: true,
                message: 'Icon updated successfully',
                data: { icon: icon }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to update icon'
            });
        }
    } catch (error) {
        console.error('Icon update error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating icon',
            error: error.message
        });
    }
});

// DELETE /api/user/icon - Remove user icon
router.delete('/user/icon', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        const updateResult = await db.collection("user").updateOne(
            { _id: new ObjectId(req.user._id) },
            { 
                $set: { 
                    icon: "",
                    updatedAt: new Date()
                } 
            }
        );

        if (updateResult.modifiedCount === 1 || updateResult.matchedCount === 1) {
            res.status(200).json({
                success: true,
                message: 'Icon removed successfully',
                data: { icon: "" }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to remove icon'
            });
        }
    } catch (error) {
        console.error('Icon removal error:', error);
        res.status(500).json({
            success: false,
            message: 'Error removing icon',
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

        // New password validation
        if (!validatePassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters long`
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

        // Update password and clear token
        const updateResult = await db.collection("user").updateOne(
            { _id: new ObjectId(req.user._id) },
            { 
                $set: { 
                    password: newPassword,
                    token: "",  // Clear token to force re-login
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.modifiedCount === 1) {
            // Clear the HttpOnly cookie
            res.clearCookie('token', getClearCookieOptions(req));

            res.status(200).json({
                success: true,
                message: 'Password updated successfully. Please login again.',
                data: {
                    updatedAt: new Date().toISOString(),
                    requiresLogin: true
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

// POST /api/login - Log in with token generation and HttpOnly cookie
router.post('/login', async (req, res) => {
    try {
        console.log('Login attempt:', req.body);
        console.log('Request origin:', req.headers.origin);
        console.log('Request headers:', req.headers);

        const { email, password, remember } = req.body;

        // Validation - check if email and password are provided
        if (!email || !password) {
            console.log('Login failed: Missing email or password');
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        const db = await connectToDB();

        const user = await db.collection("user").findOne({
            email: email,
            password: password
        });

        if (!user) {
            console.log('Login failed: User not found with provided credentials');
            return res.status(401).json({
                success: false,
                message: 'Login Failed, please check your credentials!'
            });
        }

        // Generate token for the user (include role)
        const token = await generateToken({ _id: user._id, email: user.email, role: user.role || 'user' });

        // Set HttpOnly cookie with appropriate expiration
        res.cookie('token', token, getCookieOptions(req, Boolean(remember)));

        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role || 'user',
                    icon: user.icon || ""
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
        // Extract token from cookie or header
        const token = req.cookies.token || 
            (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
                ? req.headers.authorization.split(' ')[1]
                : null);

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'No token provided for logout'
            });
        }

        console.log('Logging out user:', req.user.email);
        console.log('Removing token for user ID:', req.user._id);

        // Remove token from database
        await removeToken(token);

        // Clear the HttpOnly cookie
        res.clearCookie('token', getClearCookieOptions(req));

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

// GET /api/user/me - Returns current user from cookie
router.get('/user/me', authenticate, async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: req.user._id,
                    name: req.user.name,
                    email: req.user.email,
                    role: req.user.role || 'user',
                    icon: req.user.icon || "",
                    ...(req.user.role === 'admin' ? { address: req.user.address || "" } : {}),
                    providerId: req.user.providerId ? req.user.providerId.toString() : null,
                    providerName: req.user.providerName || null
                }
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting user',
            error: error.message
        });
    }
});

// GET /api/user/:id - Get user by ID (admin or the same user)
router.get('/user/:id', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();
        const id = req.params.id;

        // Validate ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        const userId = new ObjectId(id);
        const user = await db.collection('user').findOne({ _id: userId }, { projection: { password: 0, token: 0 } });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Authorization: allow if requester is the same user or an admin
        const requesterId = req.user && req.user._id ? req.user._id.toString() : null;
        if (req.user.role !== 'admin' && requesterId !== user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role || 'user',
                    icon: user.icon || "",
                    ...(user.role === 'admin' ? { address: user.address || "" } : {}),
                    providerId: user.providerId ? user.providerId.toString() : null,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt
                }
            }
        });
    } catch (error) {
        console.error('Get user by ID error:', error);
        res.status(500).json({ success: false, message: 'Error getting user', error: error.message });
    }
});

module.exports = router;