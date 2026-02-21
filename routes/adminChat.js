const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate, checkRole } = require('../config/auth.js');

const router = express.Router();

/**
 * GET /api/admin-chat/unread
 * Get count of unread messages for the admin (provider)
 * Optionally grouped by user
 */
router.get('/unread', authenticate, checkRole(['admin']), async (req, res) => {
    try {
        const providerId = new ObjectId(req.user._id);
        const db = await connectToDB();

        const aggregationResult = await db.collection('userChat').aggregate([
            { $match: { providerId: providerId } },
            { $unwind: "$messages" },
            { $match: { "messages.receiverId": providerId, "messages.adminRead": false } },
            { $sort: { "messages.createdAt": -1 } },   // newest first
            {
                $group: {
                    _id: "$providerId",
                    count: { $sum: 1 },                // ← was totalUnread, now "count"
                    lastMessage: { $first: "$messages" }, // ← newest unread message
                    senders: { $push: "$messages.senderId" }
                }
            }
        ]).toArray();

        let count = 0;
        let lastMessage = null;
        let senderName = '';
        let unreadByUsers = [];

        if (aggregationResult.length > 0) {
            count = aggregationResult[0].count;
            const rawMsg = aggregationResult[0].lastMessage;

            // Resolve sender name from user collection
            const senderDoc = await db.collection('user').findOne(
                { _id: rawMsg.senderId },
                { projection: { name: 1 } }
            );
            senderName = senderDoc?.name || '';

            lastMessage = {
                text: rawMsg.text,
                senderName: senderName,
                createdAt: rawMsg.createdAt
            };

            const senderCounts = {};
            aggregationResult[0].senders.forEach(senderId => {
                const idStr = senderId.toString();
                senderCounts[idStr] = (senderCounts[idStr] || 0) + 1;
            });
            unreadByUsers = Object.keys(senderCounts).map(userId => ({
                userId,
                count: senderCounts[userId]
            }));
        }

        res.json({
            success: true,
            count,          // ← frontend reads this
            lastMessage,    // ← frontend reads lastMessage.text / .senderName / .createdAt
            senderName,
            unreadByUsers
        });

    } catch (error) {
        console.error('Error fetching admin unread count:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/admin-chat/history
 * Fetch chat history between the admin and a specific user
 * Accepts userId as query param or path param
 */
const getHistoryHandler = async (req, res) => {
    try {
        const providerId = new ObjectId(req.user._id);
        const userIdString = req.params.userId || req.query.userId;

        if (!userIdString || !ObjectId.isValid(userIdString)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing user ID' });
        }
        
        const userId = new ObjectId(userIdString);
        const db = await connectToDB();
        
        // Mark messages from this user as read within the array
        await db.collection('userChat').updateOne(
            { 
                userId: userId, 
                providerId: providerId,
                "messages.adminRead": false,
                "messages.receiverId": providerId
            },
            { $set: { "messages.$[elem].adminRead": true } },
            { 
                arrayFilters: [ { "elem.receiverId": providerId, "elem.adminRead": false } ]
            }
        );

        // Fetch conversation document
        const conversation = await db.collection('userChat').findOne(
            { userId: userId, providerId: providerId }
        );

        const messages = conversation ? conversation.messages : [];

        // Fetch user details (name, email) to display in the chat room header
        const userDetails = await db.collection('user').findOne(
            { _id: userId },
            { projection: { name: 1, email: 1 } }
        );

        // Transform messages
        const formattedMessages = messages.map(msg => ({
            id: msg.id || msg._id,
            text: msg.text,
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            createdAt: msg.createdAt,
            isUser: msg.senderId.toString() === userIdString, 
            isAdmin: msg.senderId.toString() === providerId.toString(),
            userRead: msg.userRead,
            adminRead: msg.adminRead,
            time: new Date(msg.createdAt).toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })
        }));

        res.json({
            success: true,
            userName: userDetails?.name || 'Unknown User',
            userEmail: userDetails?.email || '',
            messages: formattedMessages
        });

    } catch (error) {
        console.error('Error fetching admin chat history:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Register for both path parameter and query parameter usage
router.get('/history/:userId', authenticate, checkRole(['admin']), getHistoryHandler);
router.get('/history', authenticate, checkRole(['admin']), getHistoryHandler);

/**
 * POST /api/admin-chat/send
 * Send a message from admin to a user
 */
router.post('/send', authenticate, checkRole(['admin']), async (req, res) => {
    try {
        const { userId, text } = req.body;
        
        if (!userId || !ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Valid User ID is required" });
        }
        
        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: "Message text is required" });
        }

        const providerId = new ObjectId(req.user._id);
        const targetUserId = new ObjectId(userId);
        const senderId = providerId;
        const receiverId = targetUserId;
        const messageId = new ObjectId();

        const db = await connectToDB();

        const newMessage = {
            id: messageId,
            senderId: senderId,
            receiverId: receiverId,
            text: text.trim(),
            createdAt: new Date(),
            userRead: false,
            adminRead: true
        };

        const result = await db.collection('userChat').updateOne(
            { userId: receiverId, providerId: senderId }, // Assuming userId is always the patient/customer
            { 
                 $push: { messages: newMessage },
                 $set: { lastUpdated: new Date() },
                 $setOnInsert: { 
                    userId: receiverId, 
                    providerId: senderId,
                    createdAt: new Date()
                 }
            },
            { upsert: true }
        );

        const formattedMessage = {
            id: messageId,
            text: newMessage.text,
            senderId: newMessage.senderId,
            receiverId: newMessage.receiverId,
            createdAt: newMessage.createdAt,
            isAdmin: true,
            isUser: false,
            time: new Date(newMessage.createdAt).toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })
        };

        res.status(201).json({
            success: true,
            message: formattedMessage
        });

    } catch (error) {
        console.error('Error sending admin message:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/admin-chat/users
 * Get list of users who have chatted with this admin, sorted by most recent message
 */
router.get('/users', authenticate, checkRole(['admin']), async (req, res) => {
    try {
        const providerId = new ObjectId(req.user._id);
        const db = await connectToDB();

        // Find all conversations for this provider
        const conversations = await db.collection('userChat').find(
            { providerId: providerId }
        ).toArray();

        // Process conversations to get user info and last message
        const userPromises = conversations.map(async (conv) => {
            const userId = conv.userId;
            
            // Get user details
            const userDetails = await db.collection('user').findOne(
                { _id: userId },
                { projection: { name: 1, email: 1 } }
            );

            // Get last message in array
            const lastMsg = conv.messages && conv.messages.length > 0 
                ? conv.messages[conv.messages.length - 1] 
                : null;
            
            // Count unread messages in this conversation
            const unreadCount = conv.messages
                ? conv.messages.filter(m => m.receiverId.toString() === providerId.toString() && !m.adminRead).length
                : 0;

            if (!lastMsg) return null; // Skip empty conversations if desired

            return {
                userId: userId,
                name: userDetails ? userDetails.name : 'Unknown User',
                email: userDetails ? userDetails.email : '',
                lastMessage: lastMsg.text,
                lastMessageTime: lastMsg.createdAt,
                unreadCount: unreadCount
            };
        });

        const users = (await Promise.all(userPromises)).filter(u => u !== null);
        
        // Sort by last message time
        users.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

        res.json({
            success: true,
            users: users
        });

    } catch (error) {
        console.error('Error fetching chat users:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
