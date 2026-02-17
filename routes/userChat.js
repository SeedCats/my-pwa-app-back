const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate } = require('../config/auth.js');

const router = express.Router();

/**
 * GET /api/user-chat/history
 * Fetch chat history between the current user and their healthcare provider
 */
router.get('/history', authenticate, async (req, res) => {
    try {
        const userId = new ObjectId(req.user._id);
        const providerId = req.user.providerId ? new ObjectId(req.user.providerId) : null;

        if (!providerId) {
            return res.status(200).json({ 
                success: true, 
                messages: [],
                message: "No healthcare provider assigned yet." 
            });
        }

        const db = await connectToDB();
        
        // Find existing conversation
        const conversationCallback = await db.collection('userChat').findOne({
            userId: userId,
            providerId: providerId
        });

        if (conversationCallback) {
            // Mark messages as read where receiver is the user
            // We need to update specific elements in the array
            await db.collection('userChat').updateOne(
                {
                    userId: userId,
                    providerId: providerId,
                    "messages.receiverId": userId,
                    "messages.read": false
                },
                { $set: { "messages.$[elem].read": true } },
                { arrayFilters: [{ "elem.receiverId": userId, "elem.read": false }] }
            );
        }

        // Fetch updated conversation
        const conversation = await db.collection('userChat').findOne({
            userId: userId,
            providerId: providerId
        });
        
        const messages = conversation ? conversation.messages : [];

        // Transform messages for frontend consumption
        const formattedMessages = messages.map(msg => ({
            id: msg._id || msg.id, // Handle both existing ObjectId/string ID or new one
            text: msg.text,
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            createdAt: msg.createdAt,
            isUser: msg.senderId.toString() === userId.toString(),

            // Format time as YYYY/MM/DD HH:mm for frontend compatibility
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
            messages: formattedMessages
        });

    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/user-chat/unread
 * Get count of unread messages for the current user
 */
router.get('/unread', authenticate, async (req, res) => {
    try {
        const userId = new ObjectId(req.user._id);
        const db = await connectToDB();

        // Aggregate unread messages count from the messages array
        const result = await db.collection('userChat').aggregate([
            { $match: { userId: userId } }, // Find the user's conversation
            { $unwind: "$messages" },
            { $match: { "messages.receiverId": userId, "messages.read": false } },
            { $project: { message: "$messages" } },
            { $sort: { "message.createdAt": -1 } }
        ]).toArray();

        const count = result.length;
        let lastMessage = null;

        if (count > 0) {
            const recentMsg = result[0].message;
            lastMessage = {
                text: recentMsg.text,
                createdAt: recentMsg.createdAt
            };
        }

        res.json({
            success: true,
            count: count,
            lastMessage: lastMessage
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/user-chat/send
 * Send a message to the healthcare provider
 */
router.post('/send', authenticate, async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: "Message text is required" });
        }

        const userId = new ObjectId(req.user._id);
        const providerId = req.user.providerId ? new ObjectId(req.user.providerId) : null;

        if (!providerId) {
            return res.status(400).json({ 
                success: false, 
                message: "No healthcare provider assigned. Cannot send message." 
            });
        }

        const db = await connectToDB();

        const messageId = new ObjectId();
        const newMessage = {
            id: messageId, // Store explicit ID in the object within array
            senderId: userId,
            receiverId: providerId,
            text: text.trim(),
            createdAt: new Date(),
            read: false
        };

        // Update existing conversation or insert new one
        await db.collection('userChat').updateOne(
            { 
                userId: userId, 
                providerId: providerId 
            },
            { 
                $push: { messages: newMessage },
                $set: { lastUpdated: new Date() },
                $setOnInsert: { 
                     userId: userId, 
                     providerId: providerId,
                     createdAt: new Date() 
                }
            },
            { upsert: true }
        );

        // Return the formatted message for immediate UI update
        const formattedMessage = {
            id: messageId,
            text: newMessage.text,
            senderId: newMessage.senderId,
            receiverId: newMessage.receiverId,
            createdAt: newMessage.createdAt,
            isUser: true,
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
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
