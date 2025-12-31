const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate } = require('../config/auth.js');

const router = express.Router();

// POST /api/ai/chat - Create new AI chat conversation
router.post('/chat', authenticate, async (req, res) => {
    try {
        const { title, messages } = req.body;

        const db = await connectToDB();

        const chat = {
            userId: new ObjectId(req.user._id),
            userEmail: req.user.email,
            title: title ? String(title) : 'New Conversation',
            messages: Array.isArray(messages) ? messages : [],
            // store the last message (if any) for quick access/search
            lastMessage: (Array.isArray(messages) && messages.length) ? messages[messages.length - 1] : null,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('aichats').insertOne(chat);

        if (result.insertedId) {
            res.status(201).json({ success: true, data: { id: result.insertedId, ...chat } });
        } else {
            res.status(500).json({ success: false, message: 'Failed to create chat' });
        }

    } catch (error) {
        console.error('AI chat create error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/ai/chat - List chats (pagination)
router.get('/chat', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(req.user._id) };

        const total = await db.collection('aichats').countDocuments(query);
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const chats = await db.collection('aichats')
            .find(query, { projection: { messages: 0 } })
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .toArray();

        res.status(200).json({
            success: true,
            data: {
                chats,
                pagination: {
                    currentPage: parseInt(page),
                    perPage: parseInt(limit),
                    total
                }
            }
        });

    } catch (error) {
        console.error('AI chat list error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/ai/chat/:id - Get single chat with messages
router.get('/chat/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid chat id' });
        }

        const db = await connectToDB();

        const chat = await db.collection('aichats').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(req.user._id)
        });

        if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });

        res.status(200).json({ success: true, data: chat });

    } catch (error) {
        console.error('AI chat fetch error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/ai/chat/:id - Update chat (title or replace/append messages)
// body: { title?, messages?, append?: boolean }
router.put('/chat/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, messages, append } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid chat id' });
        }

        if (!title && messages === undefined) {
            return res.status(400).json({ success: false, message: 'Nothing to update' });
        }

        const db = await connectToDB();

        const chat = await db.collection('aichats').findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(req.user._id)
        });

        if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });

        const update = { updatedAt: new Date() };

        if (title) update.title = String(title);

        if (messages !== undefined) {
            if (!Array.isArray(messages)) {
                return res.status(400).json({ success: false, message: 'Messages must be an array' });
            }
            if (append) {
                // append new messages and update lastMessage to the last appended item
                update.$push = { messages: { $each: messages } };
                const last = messages.length ? messages[messages.length - 1] : null;
                if (last) update.lastMessage = last;
            } else {
                // replace the messages array and set lastMessage accordingly
                update.messages = messages;
                update.lastMessage = messages.length ? messages[messages.length - 1] : null;
            }
        }

        // Apply update
        if (update.$push) {
            // merge updatedAt and title separately
            const push = update.$push;
            delete update.$push;
            const result = await db.collection('aichats').updateOne(
                { _id: new ObjectId(id) },
                { $set: update, $push: push }
            );
            if (result.modifiedCount === 1) {
                const updated = await db.collection('aichats').findOne({ _id: new ObjectId(id) });
                return res.status(200).json({ success: true, data: updated });
            }
        } else {
            const result = await db.collection('aichats').updateOne(
                { _id: new ObjectId(id) },
                { $set: update }
            );
            if (result.modifiedCount === 1) {
                const updated = await db.collection('aichats').findOne({ _id: new ObjectId(id) });
                return res.status(200).json({ success: true, data: updated });
            }
        }

        res.status(500).json({ success: false, message: 'Failed to update chat' });

    } catch (error) {
        console.error('AI chat update error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/ai/chat/:id - Delete single chat
router.delete('/chat/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid chat id' });
        }

        const db = await connectToDB();

        const result = await db.collection('aichats').deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(req.user._id)
        });

        if (result.deletedCount === 1) {
            return res.status(200).json({ success: true, message: 'Chat deleted' });
        }

        res.status(404).json({ success: false, message: 'Chat not found' });

    } catch (error) {
        console.error('AI chat delete error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/ai/chat - Delete all chats for user
router.delete('/chat', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();
        const result = await db.collection('aichats').deleteMany({ userId: new ObjectId(req.user._id) });
        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('AI chat delete all error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
