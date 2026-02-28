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

        const records = await db
            .collection('timeslots')
            .find(
                { providerId },
                { projection: { _id: 0, date: 1, time: 1, booked: 1 } }
            )
            .sort({ date: 1, time: 1 })
            .toArray();

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
            providerId,
            date: s.date,
            time: s.time,
            booked: false,
            createdAt: new Date()
        }));

        const db = await connectToDB();

        // Full replace: remove all existing slots for this provider, then insert the new list
        await db.collection('timeslots').deleteMany({ providerId });

        if (incoming.length > 0) {
            await db.collection('timeslots').insertMany(incoming);
        }

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
        const timeList = time.split(',').map(t => t.trim());

        let modifiedCount = 0;
        for (const t of timeList) {
            const result = await db.collection('timeslots').updateOne(
                { providerId, date, time: t },
                { $set: { booked } }
            );
            modifiedCount += result.modifiedCount;
        }

        res.json({ success: true, modifiedCount });

    } catch (err) {
        console.error('Error updating booked flag:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
