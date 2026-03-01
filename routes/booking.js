const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate, checkRole } = require('../config/auth.js');

const router = express.Router();

/**
 * Helper: sync the timeslot booked flag whenever a booking is created or its status changes.
 * time may be a comma-separated string "09:00, 09:30" — each segment is updated individually.
 */
async function syncTimeslotBooked(db, providerId, date, time, booked) {
    try {
        const timeList = typeof time === 'string'
            ? time.split(',').map(t => t.trim()).filter(Boolean)
            : [time];

        await db.collection('timeslots').updateOne(
            { providerId: providerId.toString() },
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
    } catch (err) {
        // Non-fatal — log and continue so the booking operation still succeeds
        console.error('syncTimeslotBooked error:', err);
    }
}

/**
 * POST /api/booking
 * Create a new appointment
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { name, email, service, providerName, providerID, date, time, notes } = req.body;

        if (!providerID || !date || !time || !service) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const db = await connectToDB();
        
        const newBooking = {
            userId: new ObjectId(req.user._id),
            name: name || req.user.name,
            email: email || req.user.email,
            service,
            providerName,
            providerID: new ObjectId(providerID),
            date,
            time,
            notes: notes || '',
            status: 'pending', // default status: pending, confirmed, cancelled, completed
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('booking').insertOne(newBooking);

        // Mark the corresponding timeslot as booked
        await syncTimeslotBooked(db, providerID, date, time, true);

        res.status(201).json({
            success: true,
            message: 'Appointment created successfully',
            booking: { ...newBooking, _id: result.insertedId }
        });

    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/booking
 * List all appointments
 * - Users see their own bookings
 * - Admins see bookings assigned to them (or all if needed, but let's filter by providerID for admin)
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();
        const userRole = req.user.role || (req.user.email === 'admin@admin.com' ? 'admin' : 'user');
        
        let query = {};
        
        if (userRole === 'admin') {
            // Admin sees bookings where they are the provider
            query.providerID = new ObjectId(req.user._id);
        } else {
            // Regular user sees their own bookings
            query.userId = new ObjectId(req.user._id);
        }

        const bookings = await db.collection('booking')
            .find(query)
            .sort({ date: 1, time: 1 })
            .toArray();

        res.json({
            success: true,
            bookings
        });

    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/booking/booked-slots/:providerId
 * Returns all taken time slots grouped by date for a given provider.
 * Must be declared before /:id to avoid Express matching 'booked-slots' as a booking ID.
 */
router.get('/booked-slots/:providerId', async (req, res) => {
    try {
        const { providerId } = req.params;

        if (!providerId || !ObjectId.isValid(providerId)) {
            return res.status(400).json({ message: 'Invalid providerId' });
        }

        const db = await connectToDB();

        const bookings = await db.collection('booking')
            .find(
                {
                    providerID: new ObjectId(providerId),
                    status: { $nin: ['rejected', 'cancelled'] }
                },
                { projection: { _id: 0, date: 1, time: 1 } }
            )
            .toArray();

        // Group slots by date
        const result = {};
        for (const b of bookings) {
            if (!b.date || !b.time) continue;

            // Normalise date — handle both string 'YYYY-MM-DD' and Date objects
            const dateStr = b.date instanceof Date
                ? b.date.toISOString().slice(0, 10)
                : b.date;

            if (!result[dateStr]) result[dateStr] = [];

            // Support both single "09:00" and multi-slot "09:00, 09:30" time strings
            const times = b.time.split(',').map(t => t.trim());
            result[dateStr].push(...times);
        }

        // Deduplicate slots per date
        for (const date in result) {
            result[date] = [...new Set(result[date])];
        }

        res.json(result);

    } catch (err) {
        console.error('Failed to fetch booked slots:', err);
        res.status(500).json({ message: 'Failed to fetch booked slots', error: err.message });
    }
});

/**
 * PUT /api/booking/:id
 * Update an appointment
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const bookingId = req.params.id;
        
        if (!ObjectId.isValid(bookingId)) {
            return res.status(400).json({ success: false, message: 'Invalid booking ID' });
        }

        const { name, email, service, providerName, providerID, date, time, notes, status } = req.body;
        const db = await connectToDB();
        
        // Check if booking exists and user has permission to update
        const existingBooking = await db.collection('booking').findOne({ _id: new ObjectId(bookingId) });
        
        if (!existingBooking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const userRole = req.user.role || (req.user.email === 'admin@admin.com' ? 'admin' : 'user');
        
        // Verify ownership or admin rights
        if (userRole !== 'admin' && existingBooking.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this booking' });
        }
        
        if (userRole === 'admin' && existingBooking.providerID.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this booking' });
        }

        const updateData = {
            updatedAt: new Date()
        };

        // Only update provided fields
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (service !== undefined) updateData.service = service;
        if (providerName !== undefined) updateData.providerName = providerName;
        if (providerID !== undefined) updateData.providerID = new ObjectId(providerID);
        if (date !== undefined) updateData.date = date;
        if (time !== undefined) updateData.time = time;
        if (notes !== undefined) updateData.notes = notes;
        if (status !== undefined) updateData.status = status;

        const result = await db.collection('booking').findOneAndUpdate(
            { _id: new ObjectId(bookingId) },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        // Sync the timeslot booked flag when the booking status changes
        if (status !== undefined) {
            const slotDate = updateData.date || existingBooking.date;
            const slotTime = updateData.time || existingBooking.time;
            const slotProviderId = (updateData.providerID || existingBooking.providerID).toString();
            const isActive = !['cancelled', 'rejected'].includes(status);
            await syncTimeslotBooked(db, slotProviderId, slotDate, slotTime, isActive);
        }

        res.json({
            success: true,
            message: 'Appointment updated successfully',
            booking: result.value || result
        });

    } catch (error) {
        console.error('Error updating booking:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * DELETE /api/booking/:id
 * Delete an appointment
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const bookingId = req.params.id;
        
        if (!ObjectId.isValid(bookingId)) {
            return res.status(400).json({ success: false, message: 'Invalid booking ID' });
        }

        const db = await connectToDB();
        
        // Check if booking exists
        const existingBooking = await db.collection('booking').findOne({ _id: new ObjectId(bookingId) });
        
        if (!existingBooking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const userRole = req.user.role || (req.user.email === 'admin@admin.com' ? 'admin' : 'user');
        
        // Verify ownership or admin rights
        if (userRole !== 'admin' && existingBooking.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this booking' });
        }
        
        if (userRole === 'admin' && existingBooking.providerID.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this booking' });
        }

        await db.collection('booking').deleteOne({ _id: new ObjectId(bookingId) });

        // Unmark the timeslot when a booking is deleted
        await syncTimeslotBooked(
            db,
            existingBooking.providerID.toString(),
            existingBooking.date,
            existingBooking.time,
            false
        );

        res.json({
            success: true,
            message: 'Appointment deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting booking:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
