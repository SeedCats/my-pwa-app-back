const express = require('express');
const { connectToDB } = require('../config/db.js');
const { authenticate } = require('../config/auth.js');

const router = express.Router();

/**
 * GET /api/bookingTimeSlot/:providerId
 * Fetch all availability slots saved by a specific provider/admin.
 * - Called by admin calendar on mount to pre-populate existing slots
 * - Called by user booking form when a provider is selected
 */
router.get('/:providerId', async (req, res) => {
    try {
        const { providerId } = req.params;

        if (!providerId) {
            return res.status(400).json({ success: false, message: 'providerId is required' });
        }

        const db = await connectToDB();

        const doc = await db.collection('timeslots').findOne(
            { providerId },
            { projection: { _id: 0, slots: 1 } }
        );

        const records = (doc?.slots || [])
            .map(s => ({ date: s.date, time: s.time, booked: !!s.booked }))
            .sort((a, b) => {
                if (a.date === b.date) return a.time.localeCompare(b.time);
                return a.date.localeCompare(b.date);
            });

        res.json({ success: true, slots: records });

    } catch (err) {
        console.error('Error fetching time slots:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/bookingTimeSlot
 * Save (replace) all availability slots for the authenticated admin/provider.
 * Full replace strategy: delete all existing slots for this provider, then insert the new list.
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const providerId = req.user._id.toString();
        const incoming = (req.body.slots || []).map(s => ({
            date: s.date,
            time: s.time,
            booked: false,
            createdAt: new Date()
        }));

        const db = await connectToDB();

        // Full replace: keep one document per provider and replace slots array
        await db.collection('timeslots').updateOne(
            { providerId },
            {
                $set: {
                    providerId,
                    slots: incoming,
                    updatedAt: new Date()
                },
                $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true }
        );

        res.json({ success: true });

    } catch (err) {
        console.error('Error saving time slots:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/bookingTimeSlot/mark-booked
 * Mark or unmark a specific slot as booked.
 * Called by the frontend / booking flow to keep the timeslot booked flag in sync.
 *
 * Body: { providerId, date, time, booked }   (booked = true | false)
 *
 * Returns: { success: true, modifiedCount: 1 }
 */
router.patch('/mark-booked', authenticate, async (req, res) => {
    try {
        const { providerId, date, time, booked } = req.body;

        if (!providerId || !date || !time || typeof booked !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'providerId, date, time, and booked (boolean) are required'
            });
        }

        const db = await connectToDB();

        // Support comma-separated multi-slot time strings e.g. "09:00, 09:30"
        const timeList = time.split(',').map(t => t.trim()).filter(Boolean);

        const result = await db.collection('timeslots').updateOne(
            { providerId },
            {
                $set: {
                    'slots.$[slot].booked': booked,
                    updatedAt: new Date()
                }
            },
            {
                arrayFilters: [{ 'slot.date': date, 'slot.time': { $in: timeList } }]
            }
        );

        const modifiedCount = result.modifiedCount;

        res.json({ success: true, modifiedCount });

    } catch (err) {
        console.error('Error updating booked flag:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/bookingTimeSlot/unmark-booked
 * Explicitly set one or more slots as not booked.
 *
 * Body: { providerId, date, time }
 * Returns: { success: true, modifiedCount }
 */
router.patch('/unmark-booked', authenticate, async (req, res) => {
    try {
        const { providerId, date, time } = req.body;

        if (!providerId || !date || !time) {
            return res.status(400).json({
                success: false,
                message: 'providerId, date, and time are required'
            });
        }

        const db = await connectToDB();
        const timeList = time.split(',').map(t => t.trim()).filter(Boolean);

        const result = await db.collection('timeslots').updateOne(
            { providerId },
            {
                $set: {
                    'slots.$[slot].booked': false,
                    updatedAt: new Date()
                }
            },
            {
                arrayFilters: [{ 'slot.date': date, 'slot.time': { $in: timeList } }]
            }
        );

        res.json({ success: true, modifiedCount: result.modifiedCount });

    } catch (err) {
        console.error('Error unmarking booked flag:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
