const { connectToDB, ObjectId } = require("./db");
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Base secret for key generation
const BASE_SECRET = 'my_pwa_secret_key';

// Function to generate user-specific JWT secret
const generateUserSecret = (userId, email) => {
    // Create a unique secret for each user based on their ID and email
    const userString = `${userId}_${email}_${BASE_SECRET}`;
    return crypto.createHash('sha256').update(userString).digest('hex');
};

const generateToken = async (user) => {
    // Remove sensitive data from the user object  
    delete user.password;
    delete user.token;

    // Generate user-specific secret
    const userSecret = generateUserSecret(user._id, user.email);
    
    const token = jwt.sign(user, userSecret, { expiresIn: 86400 });

    const db = await connectToDB();
    try {
        console.log('Updating token for user:', user._id);
        console.log('Generated token:', token);
        
        // Save token to database
        const result = await db.collection("user").updateOne(
            { _id: new ObjectId(user._id) },
            { $set: { token: token } }
        );
        
        console.log('Token update result:', result);
        
        return token;
    } catch (err) {
        console.error('Error updating token:', err);
        throw err;
    }
};

const extractToken = (req) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    console.log(authHeader);
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }
    return null;
}

// authenticate by token lookup 
const authenticate = async function (req, res, next) {
    let token = extractToken(req);

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Unauthorised: No token provided"
        });
    }

    const db = await connectToDB();
    try {
        const result = await db.collection("user").findOne({ token: token });
        if (!result) {
            return res.status(401).json({
                success: false,
                message: "Unauthorised: Invalid token"
            });
        }
        
        // Verify token with user-specific secret
        try {
            const userSecret = generateUserSecret(result._id, result.email);
            const decoded = jwt.verify(token, userSecret);
            req.user = result;
            next();
        } catch (jwtErr) {
            // Token is invalid, remove it from database
            await removeTokenFromDB(token);
            return res.status(401).json({
                success: false,
                message: "Unauthorised: Invalid token signature"
            });
        }
        
    } catch (err) {
        return res.status(500).json({ 
            success: false,
            message: err.message 
        });
    }
}

const checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false,
                message: "Unauthorized: No user found" 
            });
        }
        
        // Set role based on email if not already set
        const userRole = req.user.email === 'admin@admin.com' ? 'admin' : 'user';
        
        if (!roles.includes(userRole)) {
            return res.status(403).json({ 
                success: false,
                message: "Forbidden: You don't have the required role to access this resource" 
            });
        }
        
        next();
    };
};

// Helper function to remove token from database
const removeTokenFromDB = async function (token) {
    const db = await connectToDB();
    try {
        await db.collection("user").updateOne(
            { token: token }, 
            { $set: { token: "" } }
        );
    } catch (err) {
        console.error("Error removing token from database:", err);
    }
}

const removeToken = async function (token) {
    await removeTokenFromDB(token);
}

const verifyToken = async function (req, res, next) {
    console.log("req.user: ", req.user);

    let token = extractToken(req);

    if (token) {
        // First find the user to get their specific secret
        const db = await connectToDB();
        try {
            const user = await db.collection("user").findOne({ token: token });
            if (user) {
                const userSecret = generateUserSecret(user._id, user.email);
                const decoded = jwt.verify(token, userSecret);
                req.user = req.user || decoded;
            } else {
                throw new Error("Token not found in database");
            }
        } catch (err) {
            await removeToken(token);
            return res.status(403).json({ 
                success: false,
                message: "Forbidden: Invalid token" 
            });
        }
    }

    next();
}

// Function to revoke all tokens for a specific user (useful for logout all devices)
const revokeAllUserTokens = async function (userId) {
    const db = await connectToDB();
    try {
        await db.collection("user").updateOne(
            { _id: new ObjectId(userId) },
            { $unset: { token: "" } }
        );
        return true;
    } catch (err) {
        console.error("Error revoking user tokens:", err);
        return false;
    }
}

// Function to generate a new secret for user (forces re-login)
const regenerateUserSecret = async function (userId, email) {
    // This will invalidate all existing tokens for the user
    const newSecret = generateUserSecret(userId, email);
    await revokeAllUserTokens(userId);
    return newSecret;
}

module.exports = { 
    generateToken, 
    extractToken, 
    authenticate, 
    verifyToken, 
    removeToken, 
    checkRole,
    generateUserSecret,
    revokeAllUserTokens,
    regenerateUserSecret
};
