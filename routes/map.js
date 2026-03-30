const express = require('express');
const router = express.Router();
const { connectToDB, ObjectId } = require('../config/db');
const { authenticate } = require('../config/auth');

// GET /api/map/admin/:id
// Retrieves the address of an admin user to be used for Google Maps embedding
router.get('/admin/:id', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();
        const adminId = req.params.id;

        if (!ObjectId.isValid(adminId)) {
            return res.status(400).json({ success: false, message: 'Invalid admin ID format' });
        }

        const admin = await db.collection('user').findOne(
            { _id: new ObjectId(adminId), role: 'admin' },
            { projection: { address: 1, name: 1, email: 1 } }
        );

        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }

        if (!admin.address) {
            return res.status(404).json({ success: false, message: 'Admin address not configured' });
        }

        res.status(200).json({
            success: true,
            data: {
                encodedAddress: encodeURIComponent(admin.address),
                apiKey: process.env.GOOGLE_MAPS_API_KEY || ''
            }
        });

    } catch (error) {
        console.error('Error fetching admin map address:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

module.exports = router;