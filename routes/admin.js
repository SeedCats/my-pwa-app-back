const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate, checkRole } = require('../config/auth.js');

const router = express.Router();

// All admin routes require authentication + admin role
const adminMiddleware = [authenticate, checkRole(['admin'])];

// Helper to validate userId param
function validateUserIdParam(userId, res) {
    if (!ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, message: 'Invalid userId format' });
        return false;
    }
    return true;
}

// Email validation helper
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateEmail = (email) => EMAIL_REGEX.test(email);


// ---------------------- HEART RATE ----------------------
router.get('/users/:userId/heartrate', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { date, startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(userId) };
        if (date) query.date = date;
        else if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection('heartrate_daily').find(query).sort({ date: -1 }).toArray();
        res.status(200).json({ success: true, message: `Found ${records.length} days of heart rate data`, data: { records } });
    } catch (error) {
        console.error('Admin heart rate fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching heart rate data', error: error.message });
    }
});

router.get('/users/:userId/heartrate/dates', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const dates = await db.collection('heartrate_daily').distinct('date', { userId: new ObjectId(userId) });
        dates.sort((a, b) => new Date(b) - new Date(a));
        res.status(200).json({ success: true, message: `Found ${dates.length} dates with heart rate data`, data: { count: dates.length, dates } });
    } catch (error) {
        console.error('Admin heart rate dates fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching heart rate dates', error: error.message });
    }
});

router.get('/users/:userId/heartrate/stats', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(userId) };
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection('heartrate_daily').find(query).toArray();
        if (records.length === 0) return res.status(200).json({ success: true, message: 'No heart rate data found', data: { count: 0, stats: null } });

        const allDailyStats = records.map(r => r.dailyStats);
        const totalCount = allDailyStats.reduce((sum, s) => sum + s.count, 0);

        res.status(200).json({ success: true, message: 'Heart rate statistics retrieved', data: { totalDays: records.length, totalReadings: totalCount, avgBpm: Math.round(allDailyStats.reduce((sum, s) => sum + s.avg, 0) / records.length), minBpm: Math.min(...allDailyStats.map(s => s.min)), maxBpm: Math.max(...allDailyStats.map(s => s.max)) } });
    } catch (error) {
        console.error('Admin heart rate stats error:', error);
        res.status(500).json({ success: false, message: 'Error fetching heart rate statistics', error: error.message });
    }
});

// ---------------------- STRESS ----------------------
router.get('/users/:userId/stress', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { date, startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(userId) };
        if (date) query.date = date;
        else if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection('stress_daily').find(query).sort({ date: -1 }).toArray();
        res.status(200).json({ success: true, message: `Found ${records.length} days of stress data`, data: { records } });
    } catch (error) {
        console.error('Admin stress fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching stress data', error: error.message });
    }
});

router.get('/users/:userId/stress/dates', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const dates = await db.collection('stress_daily').distinct('date', { userId: new ObjectId(userId) });
        dates.sort((a, b) => new Date(b) - new Date(a));
        res.status(200).json({ success: true, message: `Found ${dates.length} dates with stress data`, data: { count: dates.length, dates } });
    } catch (error) {
        console.error('Admin stress dates fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching stress dates', error: error.message });
    }
});

router.get('/users/:userId/stress/stats', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(userId) };
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection('stress_daily').find(query).toArray();
        if (records.length === 0) return res.status(200).json({ success: true, message: 'No stress data found', data: { count: 0, stats: null } });

        const allDailyStats = records.map(r => r.dailyStats);
        const totalCount = allDailyStats.reduce((sum, s) => sum + s.count, 0);

        res.status(200).json({ success: true, message: 'Stress statistics retrieved', data: { totalDays: records.length, totalReadings: totalCount, avgStress: Math.round(allDailyStats.reduce((sum, s) => sum + s.avg, 0) / records.length), minStress: Math.min(...allDailyStats.map(s => s.min)), maxStress: Math.max(...allDailyStats.map(s => s.max)) } });
    } catch (error) {
        console.error('Admin stress stats error:', error);
        res.status(500).json({ success: false, message: 'Error fetching stress statistics', error: error.message });
    }
});

// ---------------------- PRESSURE ----------------------
router.get('/users/:userId/pressure', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { date, startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(userId) };
        if (date) query.date = date;
        else if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection('pressure_daily').find(query).sort({ date: -1 }).toArray();
        res.status(200).json({ success: true, message: `Found ${records.length} days of pressure data`, data: { records } });
    } catch (error) {
        console.error('Admin pressure fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching pressure data', error: error.message });
    }
});

router.get('/users/:userId/pressure/dates', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const dates = await db.collection('pressure_daily').distinct('date', { userId: new ObjectId(userId) });
        dates.sort((a, b) => new Date(b) - new Date(a));
        res.status(200).json({ success: true, message: `Found ${dates.length} dates with pressure data`, data: { count: dates.length, dates } });
    } catch (error) {
        console.error('Admin pressure dates fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching pressure dates', error: error.message });
    }
});

router.get('/users/:userId/pressure/stats', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(userId) };
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection('pressure_daily').find(query).toArray();
        if (records.length === 0) return res.status(200).json({ success: true, message: 'No pressure data found', data: { count: 0, stats: null } });

        const allDailyStats = records.map(r => r.dailyStats);
        const totalCount = allDailyStats.reduce((sum, s) => sum + s.count, 0);

        res.status(200).json({ success: true, message: 'Pressure statistics retrieved', data: { totalDays: records.length, totalReadings: totalCount, avgSystolic: Math.round(allDailyStats.reduce((sum, s) => sum + s.avgSystolic, 0) / records.length), minSystolic: Math.min(...allDailyStats.map(s => s.minSystolic)), maxSystolic: Math.max(...allDailyStats.map(s => s.maxSystolic)), avgDiastolic: Math.round(allDailyStats.reduce((sum, s) => sum + s.avgDiastolic, 0) / records.length), minDiastolic: Math.min(...allDailyStats.map(s => s.minDiastolic)), maxDiastolic: Math.max(...allDailyStats.map(s => s.maxDiastolic)) } });
    } catch (error) {
        console.error('Admin pressure stats error:', error);
        res.status(500).json({ success: false, message: 'Error fetching pressure statistics', error: error.message });
    }
});

// ---------------------- BMI ----------------------
router.get('/users/:userId/bmi', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const records = await db.collection('bmiData').find({ userId: new ObjectId(userId) }).sort({ createdAt: -1 }).toArray();
        res.status(200).json({ success: true, message: `Found ${records.length} BMI records`, data: { count: records.length, records } });
    } catch (error) {
        console.error('Admin BMI fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching BMI records', error: error.message });
    }
});

router.get('/users/:userId/bmi/:id', ...adminMiddleware, async (req, res) => {
    try {
        const { userId, id } = req.params;
        if (!validateUserIdParam(userId, res)) return;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid record ID format' });

        const db = await connectToDB();
        const record = await db.collection('bmiData').findOne({ _id: new ObjectId(id), userId: new ObjectId(userId) });
        if (!record) return res.status(404).json({ success: false, message: 'BMI record not found' });
        res.status(200).json({ success: true, message: 'BMI record found', data: record });
    } catch (error) {
        console.error('Admin BMI fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching BMI record', error: error.message });
    }
});

router.get('/users/:userId/bmi/stats', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const records = await db.collection('bmiData').find({ userId: new ObjectId(userId) }).sort({ createdAt: -1 }).toArray();
        if (records.length === 0) return res.status(200).json({ success: true, message: 'No BMI records found', data: { count: 0, stats: null } });

        const bmiValues = records.map(r => r.bmi);
        const weightValues = records.map(r => r.weight);
        const heightValues = records.map(r => r.height);

        const stats = {
            count: records.length,
            bmi: { current: bmiValues[0], average: parseFloat((bmiValues.reduce((a, b) => a + b, 0) / bmiValues.length).toFixed(2)), min: Math.min(...bmiValues), max: Math.max(...bmiValues) },
            weight: { current: weightValues[0], average: parseFloat((weightValues.reduce((a, b) => a + b, 0) / weightValues.length).toFixed(2)), min: Math.min(...weightValues), max: Math.max(...weightValues) },
            height: { current: heightValues[0], average: parseFloat((heightValues.reduce((a, b) => a + b, 0) / heightValues.length).toFixed(2)), min: Math.min(...heightValues), max: Math.max(...heightValues) },
            latestRecord: records[0],
            firstRecord: records[records.length - 1]
        };

        res.status(200).json({ success: true, message: 'BMI statistics retrieved', data: stats });
    } catch (error) {
        console.error('Admin BMI stats error:', error);
        res.status(500).json({ success: false, message: 'Error fetching BMI statistics', error: error.message });
    }
});

// GET /api/admin/users/:id - Admin get user by ID (no password/token)
router.get('/users/:id', ...adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        const db = await connectToDB();
        const user = await db.collection('user').findOne({ _id: new ObjectId(id) }, { projection: { password: 0, token: 0 } });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role || 'user',
                    providerId: user.providerId ? user.providerId.toString() : null,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt
                }
            }
        });
    } catch (error) {
        console.error('Admin get user by ID error:', error);
        res.status(500).json({ success: false, message: 'Error fetching user', error: error.message });
    }
});

// ---------------------- STATUS ----------------------
router.get('/users/:userId/status', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        let statusDoc = await db.collection('user_status').findOne({ userId: new ObjectId(userId) });
        if (!statusDoc) {
            const now = new Date();
            const doc = { userId: new ObjectId(userId), status: 'On-going', createdAt: now, updatedAt: now };
            const r = await db.collection('user_status').insertOne(doc);
            statusDoc = doc; statusDoc._id = r.insertedId;
        }

        res.status(200).json({ success: true, message: 'Status fetched', data: { status: statusDoc.status, updatedAt: statusDoc.updatedAt, userId: String(statusDoc.userId) } });
    } catch (error) {
        console.error('Admin status fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching status', error: error.message });
    }
});

router.post('/users/:userId/status/complete', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const now = new Date();
        const result = await db.collection('user_status').updateOne({ userId: new ObjectId(userId) }, { $set: { status: 'Completed', updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
        res.status(200).json({ success: true, message: 'Status set to Completed', data: { userId: String(userId), upsertedId: result.upsertedId || null, modifiedCount: result.modifiedCount } });
    } catch (error) {
        console.error('Admin status update error:', error);
        res.status(500).json({ success: false, message: 'Error updating status', error: error.message });
    }
});

router.post('/users/:userId/status/ongoing', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const now = new Date();
        const result = await db.collection('user_status').updateOne({ userId: new ObjectId(userId) }, { $set: { status: 'On-going', updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
        res.status(200).json({ success: true, message: 'Status set to On-going', data: { userId: String(userId), upsertedId: result.upsertedId || null, modifiedCount: result.modifiedCount } });
    } catch (error) {
        console.error('Admin status update error:', error);
        res.status(500).json({ success: false, message: 'Error updating status', error: error.message });
    }
});

// Admin: Update any user's public fields (PUT /api/admin/user/:id)
router.put('/user/:id', ...adminMiddleware, async (req, res) => {
    try {
        const db = await connectToDB();
        const id = req.params.id;
        const { name, email, role, providerId } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }
        if (!name && !email && !role && providerId === undefined) {
            return res.status(400).json({ success: false, message: 'At least one field (name, email, role, providerId) is required to update' });
        }

        const userId = new ObjectId(id);
        const existingUser = await db.collection('user').findOne({ _id: userId });
        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const updateData = { updatedAt: new Date() };

        if (name) {
            if (name.trim().length === 0) {
                return res.status(400).json({ success: false, message: 'Name cannot be empty' });
            }
            updateData.name = name.trim();
        }

        if (email) {
            if (!validateEmail(email)) {
                return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
            }
            const emailTaken = await db.collection('user').findOne({ email: email.toLowerCase(), _id: { $ne: userId } });
            if (emailTaken) {
                return res.status(409).json({ success: false, message: 'Email already exists' });
            }
            updateData.email = email.toLowerCase();
        }

        if (role) {
            const allowedRoles = ['user', 'admin'];
            if (!allowedRoles.includes(role)) {
                return res.status(400).json({ success: false, message: 'Invalid role' });
            }
            updateData.role = role;
        }

        if (providerId !== undefined) {
            if (providerId && !ObjectId.isValid(providerId)) {
                return res.status(400).json({ success: false, message: 'Invalid providerId' });
            }
            if (providerId) {
                const provObjId = new ObjectId(providerId);
                const provider = await db.collection('user').findOne({ _id: provObjId, role: 'admin' });
                if (!provider) {
                    return res.status(400).json({ success: false, message: 'Provider not found or not an admin' });
                }
                updateData.providerId = provObjId;
            } else {
                // allow clearing provider
                updateData.providerId = null;
            }
        }

        const updateResult = await db.collection('user').updateOne({ _id: userId }, { $set: updateData });

        if (updateResult.modifiedCount === 1) {
            if (providerId !== undefined) {
                try {
                    if (existingUser.providerId) {
                        await db.collection('user').updateOne({ _id: existingUser.providerId }, { $pull: { UserList: existingUser._id } });
                    }
                    if (providerId) {
                        await db.collection('user').updateOne({ _id: new ObjectId(providerId) }, { $addToSet: { UserList: existingUser._id } });
                    }
                } catch (err) {
                    console.error('Error updating provider UserList during admin update:', err);
                }
            }

            const updatedUser = await db.collection('user').findOne({ _id: userId }, { projection: { password: 0, token: 0 } });

            res.status(200).json({ success: true, message: 'User updated successfully', data: { user: updatedUser } });
        } else {
            res.status(500).json({ success: false, message: 'Failed to update user' });
        }

    } catch (error) {
        console.error('Admin update user error:', error);
        res.status(500).json({ success: false, message: 'Error updating user', error: error.message });
    }
});

// Admin: Delete any user (with safeguards) (DELETE /api/admin/user/:id)
router.delete('/user/:id', ...adminMiddleware, async (req, res) => {
    try {
        const db = await connectToDB();
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID' });
        }

        // Prevent admin from deleting themselves
        if (req.user._id.toString() === id) {
            return res.status(403).json({ success: false, message: 'Admins cannot delete their own account' });
        }

        const userId = new ObjectId(id);
        const user = await db.collection('user').findOne({ _id: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (user.role === 'admin') {
            const adminCount = await db.collection('user').countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.status(400).json({ success: false, message: 'Cannot delete the last admin' });
            }
        }

        const deletionResults = await Promise.all([
            db.collection('bmiData').deleteMany({ userId: userId }),
            db.collection('heartrate_daily').deleteMany({ userId: userId }),
            db.collection('aichats').deleteMany({ userId: userId }),
            db.collection('grokchats').deleteMany({ userId: userId }),
            db.collection('user').deleteOne({ _id: userId })
        ]);

        const userDeleteResult = deletionResults[4];

        if (userDeleteResult.deletedCount === 1) {
            try {
                if (user && user.providerId) {
                    await db.collection('user').updateOne(
                        { _id: user.providerId },
                        { $pull: { UserList: user._id } }
                    );
                }
            } catch (err) {
                console.error('Error removing user from admin UserList during admin deletion:', err);
            }

            res.status(200).json({ success: true, message: 'User and all related data deleted successfully' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to delete user' });
        }

    } catch (error) {
        console.error('Admin delete user error:', error);
        res.status(500).json({ success: false, message: 'Error deleting user', error: error.message });
    }
});

module.exports = router;
