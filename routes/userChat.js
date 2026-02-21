const express = require('express');
const multer = require('multer');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate } = require('../config/auth.js');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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
                    "messages.userRead": false
                },
                { $set: { "messages.$[elem].userRead": true } },
                { arrayFilters: [{ "elem.receiverId": userId, "elem.userRead": false }] }
            );
        }

        // Fetch updated conversation
        const conversation = await db.collection('userChat').findOne({
            userId: userId,
            providerId: providerId
        });
        
        const messages = conversation ? conversation.messages : [];

        // Fetch receiver's icon (the provider)
        const providerDoc = await db.collection('user').findOne(
            { _id: providerId },
            { projection: { icon: 1 } }
        );
        const receiverIcon = providerDoc ? providerDoc.icon : null;

        // Transform messages for frontend consumption
        const formattedMessages = messages.map(msg => {
            const formattedMsg = {
                id: msg._id || msg.id, // Handle both existing ObjectId/string ID or new one
                text: msg.text,
                senderId: msg.senderId,
                receiverId: msg.receiverId,
                createdAt: msg.createdAt,
                isUser: msg.senderId.toString() === userId.toString(),
                userRead: msg.userRead,
                adminRead: msg.adminRead,

                // Format time as YYYY/MM/DD HH:mm for frontend compatibility
                time: new Date(msg.createdAt).toLocaleString('ja-JP', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            };

            if (msg.file) {
                formattedMsg.file = {
                    originalName: msg.file.originalName,
                    contentType: msg.file.contentType,
                    size: msg.file.size
                };
            }

            return formattedMsg;
        });

        res.json({
            success: true,
            messages: formattedMessages,
            receiverIcon: receiverIcon
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
            { $match: { "messages.receiverId": userId, "messages.userRead": false } },
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
router.post('/send', authenticate, upload.single('file'), async (req, res) => {
    try {
        const { text } = req.body;
        const file = req.file;
        
        if ((!text || !text.trim()) && !file) {
            return res.status(400).json({ success: false, message: "Message text or file is required" });
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
            text: text ? text.trim() : "",
            createdAt: new Date(),
            userRead: true,
            adminRead: false
        };

        if (file) {
            newMessage.file = {
                data: file.buffer,
                contentType: file.mimetype,
                originalName: file.originalname,
                size: file.size
            };
        }

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

        if (file) {
            formattedMessage.file = {
                originalName: file.originalname,
                contentType: file.mimetype,
                size: file.size
            };
        }

        res.status(201).json({
            success: true,
            message: formattedMessage
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/user-chat/file/:messageId
 * Download a file attached to a message
 */
router.get('/file/:messageId', authenticate, async (req, res) => {
    try {
        const messageId = new ObjectId(req.params.messageId);
        const userId = new ObjectId(req.user._id);
        const providerId = req.user.providerId ? new ObjectId(req.user.providerId) : null;

        const db = await connectToDB();

        // Find the conversation containing the message
        const conversation = await db.collection('userChat').findOne({
            userId: userId,
            providerId: providerId,
            "messages.id": messageId
        });

        if (!conversation) {
            return res.status(404).json({ success: false, message: "Message not found" });
        }

        const message = conversation.messages.find(msg => msg.id.toString() === messageId.toString());

        if (!message || !message.file) {
            return res.status(404).json({ success: false, message: "File not found" });
        }

        const encodedFileName = encodeURIComponent(message.file.originalName);

        res.set('Content-Type', message.file.contentType);
        res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}`);
        res.send(message.file.data.buffer || message.file.data);

    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
