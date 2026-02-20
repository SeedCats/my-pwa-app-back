const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate, checkRole } = require('../config/auth.js');
const multer = require('multer');

const router = express.Router();

// Configure multer for file uploads (100MB limit)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

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

// DELETE /api/admin/users/:userId/heartrate - Admin delete user's heart rate data
router.delete('/users/:userId/heartrate', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { date, startDate, endDate } = req.query;
        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);

        // Build query
        const query = { userId: userIdObj };
        if (date) {
            query.date = date;
        } else if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        // Delete the records
        const deleteResult = await db.collection('heartrate_daily').deleteMany(query);

        res.status(200).json({ 
            success: true, 
            message: `Deleted ${deleteResult.deletedCount} heart rate record(s) successfully`,
            data: {
                deletedCount: deleteResult.deletedCount,
                userId: userId
            }
        });

    } catch (error) {
        console.error('Admin heart rate delete error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting heart rate records', 
            error: error.message 
        });
    }
});

// POST /api/admin/users/:userId/heartrate/upload - Admin upload heartrate CSV for specific user
router.post('/users/:userId/heartrate/upload', ...adminMiddleware, upload.single('file'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);

        // Check if user exists
        const user = await db.collection('user').findOne({ _id: userIdObj });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const userEmail = user.email;

        // Parse CSV
        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');

        // Group records by date and hour
        const dailyData = {};
        let totalParsed = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const startIdx = line.indexOf('{');
                const endIdx = line.lastIndexOf('}');

                if (startIdx !== -1 && endIdx !== -1) {
                    const jsonStr = line.substring(startIdx, endIdx + 1).replace(/""/g, '"');
                    const parsed = JSON.parse(jsonStr);

                    if (parsed.time && parsed.bpm !== undefined) {
                        const bpm = parseInt(parsed.bpm);
                        if (!isNaN(bpm) && bpm >= 20 && bpm <= 220) {
                            const timeDate = new Date(parsed.time * 1000);
                            const dateOnly = timeDate.toISOString().split('T')[0];
                            const hour = timeDate.getHours();

                            if (!dailyData[dateOnly]) {
                                dailyData[dateOnly] = { hourly: {}, all: [] };
                            }

                            if (!dailyData[dateOnly].hourly[hour]) dailyData[dateOnly].hourly[hour] = [];
                            dailyData[dateOnly].hourly[hour].push(bpm);
                            dailyData[dateOnly].all.push(bpm);
                            totalParsed++;
                        }
                    }
                }
            } catch (e) {
                // Skip invalid lines
            }
        }

        if (totalParsed === 0) {
            return res.status(400).json({ success: false, message: 'No valid heart rate records found in CSV file' });
        }

        let inserted = 0, updated = 0;

        for (const [date, data] of Object.entries(dailyData)) {
            // Build hourly summaries
            const hourlyStats = [];
            for (let h = 0; h < 24; h++) {
                const arr = data.hourly[h] || [];
                if (arr.length > 0) {
                    hourlyStats.push({
                        hour: h,
                        avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
                        min: Math.min(...arr),
                        max: Math.max(...arr),
                        count: arr.length
                    });
                } else {
                    hourlyStats.push({ hour: h, avg: null, min: null, max: null, count: 0 });
                }
            }

            const dailyStats = {
                avg: Math.round(data.all.reduce((a, b) => a + b, 0) / data.all.length),
                min: Math.min(...data.all),
                max: Math.max(...data.all),
                count: data.all.length
            };

            // Upsert
            const existing = await db.collection("heartrate_daily").findOne({ userId: userIdObj, date: date });
            if (existing) {
                await db.collection("heartrate_daily").updateOne(
                    { _id: existing._id },
                    { $set: { hourlyData: hourlyStats, dailyStats: dailyStats, updatedAt: new Date() } }
                );
                updated++;
            } else {
                await db.collection("heartrate_daily").insertOne({
                    userId: userIdObj,
                    userEmail: userEmail,
                    date: date,
                    hourlyData: hourlyStats,
                    dailyStats: dailyStats,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                inserted++;
            }
        }

        res.status(200).json({
            success: true,
            message: 'Heart rate CSV uploaded successfully',
            data: {
                userId: userId,
                userEmail: userEmail,
                totalRecordsParsed: totalParsed,
                inserted: inserted,
                updated: updated,
                total: inserted + updated
            }
        });

    } catch (error) {
        console.error('Admin heartrate upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading heart rate CSV',
            error: error.message
        });
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

// DELETE /api/admin/users/:userId/stress - Admin delete user's stress data
router.delete('/users/:userId/stress', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { date, startDate, endDate } = req.query;
        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);

        // Build query
        const query = { userId: userIdObj };
        if (date) {
            query.date = date;
        } else if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        // Delete the records
        const deleteResult = await db.collection('stress_daily').deleteMany(query);

        res.status(200).json({ 
            success: true, 
            message: `Deleted ${deleteResult.deletedCount} stress record(s) successfully`,
            data: {
                deletedCount: deleteResult.deletedCount,
                userId: userId
            }
        });

    } catch (error) {
        console.error('Admin stress delete error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting stress records', 
            error: error.message 
        });
    }
});

// POST /api/admin/users/:userId/stress/upload - Admin upload stress CSV for specific user
router.post('/users/:userId/stress/upload', ...adminMiddleware, upload.single('file'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);

        // Check if user exists
        const user = await db.collection('user').findOne({ _id: userIdObj });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const userEmail = user.email;

        // Parse CSV
        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');

        // Group records by date and hour
        const dailyData = {};
        let totalParsed = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const startIdx = line.indexOf('{');
                const endIdx = line.lastIndexOf('}');

                if (startIdx !== -1 && endIdx !== -1) {
                    const jsonStr = line.substring(startIdx, endIdx + 1).replace(/""/g, '"');
                    const parsed = JSON.parse(jsonStr);

                    if (parsed.time && parsed.stress !== undefined) {
                        const stressVal = parseFloat(parsed.stress);
                        if (!isNaN(stressVal) && stressVal >= 0 && stressVal <= 100) {
                            const timeDate = new Date(parsed.time * 1000);
                            const dateOnly = timeDate.toISOString().split('T')[0];
                            const hour = timeDate.getHours();

                            if (!dailyData[dateOnly]) {
                                dailyData[dateOnly] = { hourly: {}, all: [] };
                            }

                            if (!dailyData[dateOnly].hourly[hour]) dailyData[dateOnly].hourly[hour] = [];
                            dailyData[dateOnly].hourly[hour].push(stressVal);
                            dailyData[dateOnly].all.push(stressVal);
                            totalParsed++;
                        }
                    }
                }
            } catch (e) {
                // Skip invalid lines
            }
        }

        if (totalParsed === 0) {
            return res.status(400).json({ success: false, message: 'No valid stress records found in CSV file' });
        }

        let inserted = 0, updated = 0;

        for (const [date, data] of Object.entries(dailyData)) {
            // Build hourly summaries
            const hourlyStats = [];
            for (let h = 0; h < 24; h++) {
                const arr = data.hourly[h] || [];
                if (arr.length > 0) {
                    hourlyStats.push({
                        hour: h,
                        avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
                        min: Math.min(...arr),
                        max: Math.max(...arr),
                        count: arr.length
                    });
                } else {
                    hourlyStats.push({ hour: h, avg: null, min: null, max: null, count: 0 });
                }
            }

            const dailyStats = {
                avg: Math.round(data.all.reduce((a, b) => a + b, 0) / data.all.length),
                min: Math.min(...data.all),
                max: Math.max(...data.all),
                count: data.all.length
            };

            // Upsert
            const existing = await db.collection("stress_daily").findOne({ userId: userIdObj, date: date });
            if (existing) {
                await db.collection("stress_daily").updateOne(
                    { _id: existing._id },
                    { $set: { hourlyData: hourlyStats, dailyStats: dailyStats, updatedAt: new Date() } }
                );
                updated++;
            } else {
                await db.collection("stress_daily").insertOne({
                    userId: userIdObj,
                    userEmail: userEmail,
                    date: date,
                    hourlyData: hourlyStats,
                    dailyStats: dailyStats,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                inserted++;
            }
        }

        res.status(200).json({
            success: true,
            message: 'Stress CSV uploaded successfully',
            data: {
                userId: userId,
                userEmail: userEmail,
                totalRecordsParsed: totalParsed,
                inserted: inserted,
                updated: updated,
                total: inserted + updated
            }
        });

    } catch (error) {
        console.error('Admin stress upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading stress CSV',
            error: error.message
        });
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

// POST /api/admin/users/:userId/bmi - Admin create new BMI record for user
router.post('/users/:userId/bmi', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { weight, height, age, bmi } = req.body;

        // Validation - weight, height, and age are required
        if (!weight || !height || age === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: 'Weight, height, and age are required' 
            });
        }

        if (typeof weight !== 'number' || weight <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Weight must be a positive number' 
            });
        }

        if (typeof height !== 'number' || height <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Height must be a positive number' 
            });
        }

        if (typeof age !== 'number' || age < 0 || age > 150) {
            return res.status(400).json({ 
                success: false, 
                message: 'Age must be a valid number between 0 and 150' 
            });
        }

        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);

        // Check if user exists
        const user = await db.collection('user').findOne({ _id: userIdObj });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Calculate BMI: weight (kg) / (height (m))^2
        const calculatedBmi = bmi !== undefined ? bmi : parseFloat((weight / (height * height)).toFixed(2));

        // Create new BMI record
        const newBmiRecord = {
            userId: userIdObj,
            weight: weight,
            height: height,
            age: age,
            bmi: calculatedBmi,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('bmiData').insertOne(newBmiRecord);

        if (result.insertedId) {
            res.status(201).json({ 
                success: true, 
                message: 'BMI record created successfully',
                data: {
                    id: result.insertedId,
                    userId: userId,
                    weight: weight,
                    height: height,
                    age: age,
                    bmi: calculatedBmi,
                    createdAt: newBmiRecord.createdAt,
                    updatedAt: newBmiRecord.updatedAt
                }
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to create BMI record' 
            });
        }

    } catch (error) {
        console.error('Admin BMI create error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error creating BMI record', 
            error: error.message 
        });
    }
});

// PUT /api/admin/users/:userId/bmi/:bmiId - Admin update user's BMI record
router.put('/users/:userId/bmi/:bmiId', ...adminMiddleware, async (req, res) => {
    try {
        const { userId, bmiId } = req.params;
        if (!validateUserIdParam(userId, res)) return;
        if (!ObjectId.isValid(bmiId)) {
            return res.status(400).json({ success: false, message: 'Invalid BMI record ID format' });
        }

        const { weight, height, age, bmi } = req.body;

        // Validation - at least one field must be provided
        if (weight === undefined && height === undefined && age === undefined && bmi === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: 'At least one field (weight, height, age, or bmi) must be provided' 
            });
        }

        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);
        const bmiIdObj = new ObjectId(bmiId);

        // Check if BMI record exists and belongs to the user
        const existingRecord = await db.collection('bmiData').findOne({ 
            _id: bmiIdObj, 
            userId: userIdObj 
        });

        if (!existingRecord) {
            return res.status(404).json({ 
                success: false, 
                message: 'BMI record not found for this user' 
            });
        }

        // Prepare update object
        const updateData = {
            updatedAt: new Date()
        };

        // Update weight if provided
        if (weight !== undefined) {
            if (typeof weight !== 'number' || weight <= 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Weight must be a positive number' 
                });
            }
            updateData.weight = weight;
        }

        // Update height if provided
        if (height !== undefined) {
            if (typeof height !== 'number' || height <= 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Height must be a positive number' 
                });
            }
            updateData.height = height;
        }

        // Update age if provided
        if (age !== undefined) {
            if (typeof age !== 'number' || age < 0 || age > 150) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Age must be a valid number between 0 and 150' 
                });
            }
            updateData.age = age;
        }

        // Calculate BMI if both weight and height are available
        const finalWeight = weight !== undefined ? weight : existingRecord.weight;
        const finalHeight = height !== undefined ? height : existingRecord.height;

        if (finalWeight && finalHeight) {
            // BMI = weight (kg) / (height (m))^2
            const calculatedBmi = parseFloat((finalWeight / (finalHeight * finalHeight)).toFixed(2));
            updateData.bmi = bmi !== undefined ? bmi : calculatedBmi;
        } else if (bmi !== undefined) {
            if (typeof bmi !== 'number' || bmi <= 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'BMI must be a positive number' 
                });
            }
            updateData.bmi = bmi;
        }

        // Update the record
        const updateResult = await db.collection('bmiData').updateOne(
            { _id: bmiIdObj, userId: userIdObj },
            { $set: updateData }
        );

        if (updateResult.modifiedCount === 1) {
            // Fetch the updated record
            const updatedRecord = await db.collection('bmiData').findOne({ _id: bmiIdObj });
            
            res.status(200).json({ 
                success: true, 
                message: 'BMI record updated successfully',
                data: updatedRecord
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to update BMI record' 
            });
        }

    } catch (error) {
        console.error('Admin BMI update error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating BMI record', 
            error: error.message 
        });
    }
});

// DELETE /api/admin/users/:userId/bmi/:bmiId - Admin delete user's BMI record
router.delete('/users/:userId/bmi/:bmiId', ...adminMiddleware, async (req, res) => {
    try {
        const { userId, bmiId } = req.params;
        if (!validateUserIdParam(userId, res)) return;
        if (!ObjectId.isValid(bmiId)) {
            return res.status(400).json({ success: false, message: 'Invalid BMI record ID format' });
        }

        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);
        const bmiIdObj = new ObjectId(bmiId);

        // Check if BMI record exists and belongs to the user
        const existingRecord = await db.collection('bmiData').findOne({ 
            _id: bmiIdObj, 
            userId: userIdObj 
        });

        if (!existingRecord) {
            return res.status(404).json({ 
                success: false, 
                message: 'BMI record not found for this user' 
            });
        }

        // Delete the record
        const deleteResult = await db.collection('bmiData').deleteOne({ 
            _id: bmiIdObj, 
            userId: userIdObj 
        });

        if (deleteResult.deletedCount === 1) {
            res.status(200).json({ 
                success: true, 
                message: 'BMI record deleted successfully',
                data: {
                    deletedId: bmiId,
                    userId: userId
                }
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to delete BMI record' 
            });
        }

    } catch (error) {
        console.error('Admin BMI delete error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting BMI record', 
            error: error.message 
        });
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
                    providerName: user.providerName || null,
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

// PUT /api/admin/users/:userId/password - Admin update user password
router.put('/users/:userId/password', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const { newPassword } = req.body;

        // Validate new password
        if (!newPassword || typeof newPassword !== 'string') {
            return res.status(400).json({ 
                success: false, 
                message: 'New password is required' 
            });
        }

        // Password validation (minimum length)
        const MIN_PASSWORD_LENGTH = 6;
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ 
                success: false, 
                message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` 
            });
        }

        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);

        // Check if user exists
        const user = await db.collection('user').findOne({ _id: userIdObj });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Update password and clear tokens to force re-login
        const updateResult = await db.collection('user').updateOne(
            { _id: userIdObj },
            { 
                $set: { 
                    password: newPassword,
                    token: "",
                    updatedAt: new Date()
                },
                $unset: { tokens: "" }
            }
        );

        if (updateResult.modifiedCount === 1) {
            res.status(200).json({ 
                success: true, 
                message: 'Password updated successfully. User will need to login again.',
                data: {
                    userId: userId,
                    email: user.email
                }
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to update password' 
            });
        }

    } catch (error) {
        console.error('Admin password update error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating password', 
            error: error.message 
        });
    }
});

// ---------------------- STATUS ----------------------


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
                updateData.providerName = provider.name;
            } else {
                // allow clearing provider
                updateData.providerId = null;
                updateData.providerName = null;
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

// ---------------------- CSV UPLOAD ----------------------
// POST /api/admin/users/:userId/uploadAll - Admin upload CSV data for specific user
router.post('/users/:userId/uploadAll', ...adminMiddleware, upload.single('file'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const db = await connectToDB();
        const userIdObj = new ObjectId(userId);

        // Check if user exists
        const user = await db.collection('user').findOne({ _id: userIdObj });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const userEmail = user.email;

        // Parse CSV
        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');

        // Group records by date and hour for aggregation
        const dailyData = {};
        let totalParsed = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const startIdx = line.indexOf('{');
                const endIdx = line.lastIndexOf('}');

                if (startIdx !== -1 && endIdx !== -1) {
                    const jsonStr = line.substring(startIdx, endIdx + 1).replace(/""/g, '"');
                    const parsed = JSON.parse(jsonStr);

                    if (parsed.time) {
                        const timeDate = new Date(parsed.time * 1000);
                        const dateOnly = timeDate.toISOString().split('T')[0];
                        const hour = timeDate.getHours();

                        if (!dailyData[dateOnly]) {
                            dailyData[dateOnly] = { hourlyHr: {}, allHr: [], hourlyStress: {}, allStress: [], hourlyPressure: {}, allSystolic: [], allDiastolic: [] };
                        }

                        let anyValid = false;

                        // Handle BPM if present
                        if (parsed.bpm !== undefined) {
                            const bpm = parseInt(parsed.bpm);
                            if (!isNaN(bpm) && bpm >= 20 && bpm <= 220) {
                                if (!dailyData[dateOnly].hourlyHr[hour]) dailyData[dateOnly].hourlyHr[hour] = [];
                                dailyData[dateOnly].hourlyHr[hour].push(bpm);
                                dailyData[dateOnly].allHr.push(bpm);
                                anyValid = true;
                            }
                        }

                        // Handle stress if present (expected 0-100)
                        if (parsed.stress !== undefined) {
                            const stressVal = parseFloat(parsed.stress);
                            if (!isNaN(stressVal) && stressVal >= 0 && stressVal <= 100) {
                                if (!dailyData[dateOnly].hourlyStress[hour]) dailyData[dateOnly].hourlyStress[hour] = [];
                                dailyData[dateOnly].hourlyStress[hour].push(stressVal);
                                dailyData[dateOnly].allStress.push(stressVal);
                                anyValid = true;
                            }
                        }

                        // Handle blood pressure (systolic/diastolic)
                        let systolic = undefined;
                        let diastolic = undefined;

                        if (parsed.systolic !== undefined) systolic = parseFloat(parsed.systolic);
                        if (parsed.diastolic !== undefined) diastolic = parseFloat(parsed.diastolic);
                        if (systolic === undefined && parsed.sbp !== undefined) systolic = parseFloat(parsed.sbp);
                        if (diastolic === undefined && parsed.dbp !== undefined) diastolic = parseFloat(parsed.dbp);
                        if (systolic === undefined && parsed.sys !== undefined) systolic = parseFloat(parsed.sys);
                        if (diastolic === undefined && parsed.dia !== undefined) diastolic = parseFloat(parsed.dia);

                        // bp as string "120/80"
                        if ((systolic === undefined || diastolic === undefined) && parsed.bp !== undefined) {
                            const parts = ('' + parsed.bp).split('/');
                            if (parts.length === 2) {
                                const s = parseFloat(parts[0]);
                                const d = parseFloat(parts[1]);
                                if (!isNaN(s) && !isNaN(d)) {
                                    systolic = s;
                                    diastolic = d;
                                }
                            }
                        }

                        // Validate ranges (systolic 50-250, diastolic 30-170)
                        if (systolic !== undefined && diastolic !== undefined) {
                            if (!isNaN(systolic) && !isNaN(diastolic) && systolic >= 50 && systolic <= 250 && diastolic >= 30 && diastolic <= 170) {
                                if (!dailyData[dateOnly].hourlyPressure[hour]) dailyData[dateOnly].hourlyPressure[hour] = [];
                                dailyData[dateOnly].hourlyPressure[hour].push({ systolic: Math.round(systolic), diastolic: Math.round(diastolic) });
                                dailyData[dateOnly].allSystolic.push(Math.round(systolic));
                                dailyData[dateOnly].allDiastolic.push(Math.round(diastolic));
                                anyValid = true;
                            }
                        }

                        if (anyValid) totalParsed++;
                    }
                }
            } catch (e) {
                // Skip invalid lines silently
            }
        }

        if (totalParsed === 0) {
            return res.status(400).json({ success: false, message: 'No valid records found in CSV file' });
        }

        // Convert to aggregated documents for heartrate, stress and pressure
        let hrInserted = 0, hrUpdated = 0;
        let stressInserted = 0, stressUpdated = 0;
        let pressureInserted = 0, pressureUpdated = 0;

        for (const [date, data] of Object.entries(dailyData)) {
            // Build hourly summaries (24 hours) for heartrate
            const hourlyHrStats = [];
            for (let h = 0; h < 24; h++) {
                const arr = data.hourlyHr[h] || [];
                if (arr.length > 0) {
                    hourlyHrStats.push({
                        hour: h,
                        avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
                        min: Math.min(...arr),
                        max: Math.max(...arr),
                        count: arr.length
                    });
                } else {
                    hourlyHrStats.push({ hour: h, avg: null, min: null, max: null, count: 0 });
                }
            }

            const allHr = data.allHr;
            const dailyHrStats = allHr.length > 0 ? {
                avg: Math.round(allHr.reduce((a, b) => a + b, 0) / allHr.length),
                min: Math.min(...allHr),
                max: Math.max(...allHr),
                count: allHr.length
            } : null;

            // Build hourly summaries for stress
            const hourlyStressStats = [];
            for (let h = 0; h < 24; h++) {
                const arr = data.hourlyStress[h] || [];
                if (arr.length > 0) {
                    const avgVal = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
                    hourlyStressStats.push({ hour: h, avg: avgVal, min: Math.min(...arr), max: Math.max(...arr), count: arr.length });
                } else {
                    hourlyStressStats.push({ hour: h, avg: null, min: null, max: null, count: 0 });
                }
            }

            const allStress = data.allStress;
            const dailyStressStats = allStress.length > 0 ? {
                avg: Math.round(allStress.reduce((a, b) => a + b, 0) / allStress.length),
                min: Math.min(...allStress),
                max: Math.max(...allStress),
                count: allStress.length
            } : null;

            // Build hourly summaries for pressure
            const hourlyPressureStats = [];
            for (let h = 0; h < 24; h++) {
                const arr = data.hourlyPressure[h] || [];
                if (arr.length > 0) {
                    const systolicVals = arr.map(p => p.systolic);
                    const diastolicVals = arr.map(p => p.diastolic);
                    hourlyPressureStats.push({
                        hour: h,
                        avgSystolic: Math.round(systolicVals.reduce((a, b) => a + b, 0) / systolicVals.length),
                        minSystolic: Math.min(...systolicVals),
                        maxSystolic: Math.max(...systolicVals),
                        avgDiastolic: Math.round(diastolicVals.reduce((a, b) => a + b, 0) / diastolicVals.length),
                        minDiastolic: Math.min(...diastolicVals),
                        maxDiastolic: Math.max(...diastolicVals),
                        count: arr.length
                    });
                } else {
                    hourlyPressureStats.push({ hour: h, avgSystolic: null, minSystolic: null, maxSystolic: null, avgDiastolic: null, minDiastolic: null, maxDiastolic: null, count: 0 });
                }
            }

            const allSystolic = data.allSystolic;
            const allDiastolic = data.allDiastolic;
            const dailyPressureStats = allSystolic.length > 0 && allDiastolic.length > 0 ? {
                avgSystolic: Math.round(allSystolic.reduce((a, b) => a + b, 0) / allSystolic.length),
                minSystolic: Math.min(...allSystolic),
                maxSystolic: Math.max(...allSystolic),
                avgDiastolic: Math.round(allDiastolic.reduce((a, b) => a + b, 0) / allDiastolic.length),
                minDiastolic: Math.min(...allDiastolic),
                maxDiastolic: Math.max(...allDiastolic),
                count: allSystolic.length
            } : null;

            // Upsert heartrate_daily
            if (dailyHrStats) {
                const existingHr = await db.collection("heartrate_daily").findOne({ userId: userIdObj, date: date });
                if (existingHr) {
                    await db.collection("heartrate_daily").updateOne(
                        { _id: existingHr._id },
                        { $set: { hourlyData: hourlyHrStats, dailyStats: dailyHrStats, updatedAt: new Date() } }
                    );
                    hrUpdated++;
                } else {
                    await db.collection("heartrate_daily").insertOne({
                        userId: userIdObj,
                        userEmail: userEmail,
                        date: date,
                        hourlyData: hourlyHrStats,
                        dailyStats: dailyHrStats,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    hrInserted++;
                }
            }

            // Upsert stress_daily
            if (dailyStressStats) {
                const existingStress = await db.collection("stress_daily").findOne({ userId: userIdObj, date: date });
                if (existingStress) {
                    await db.collection("stress_daily").updateOne(
                        { _id: existingStress._id },
                        { $set: { hourlyData: hourlyStressStats, dailyStats: dailyStressStats, updatedAt: new Date() } }
                    );
                    stressUpdated++;
                } else {
                    await db.collection("stress_daily").insertOne({
                        userId: userIdObj,
                        userEmail: userEmail,
                        date: date,
                        hourlyData: hourlyStressStats,
                        dailyStats: dailyStressStats,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    stressInserted++;
                }
            }

            // Upsert pressure_daily
            if (dailyPressureStats) {
                const existingPressure = await db.collection("pressure_daily").findOne({ userId: userIdObj, date: date });
                if (existingPressure) {
                    await db.collection("pressure_daily").updateOne(
                        { _id: existingPressure._id },
                        { $set: { hourlyData: hourlyPressureStats, dailyStats: dailyPressureStats, updatedAt: new Date() } }
                    );
                    pressureUpdated++;
                } else {
                    await db.collection("pressure_daily").insertOne({
                        userId: userIdObj,
                        userEmail: userEmail,
                        date: date,
                        hourlyData: hourlyPressureStats,
                        dailyStats: dailyPressureStats,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    pressureInserted++;
                }
            }
        }

        res.status(200).json({
            success: true,
            message: 'CSV data uploaded successfully',
            data: {
                userId: userId,
                userEmail: userEmail,
                totalRecordsParsed: totalParsed,
                heartRate: {
                    inserted: hrInserted,
                    updated: hrUpdated,
                    total: hrInserted + hrUpdated
                },
                stress: {
                    inserted: stressInserted,
                    updated: stressUpdated,
                    total: stressInserted + stressUpdated
                },
                pressure: {
                    inserted: pressureInserted,
                    updated: pressureUpdated,
                    total: pressureInserted + pressureUpdated
                }
            }
        });

    } catch (error) {
        console.error('Admin CSV upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading CSV data',
            error: error.message
        });
    }
});

// ---------------------- USER STATUS ----------------------

// GET /api/admin/users/:userId/status - Admin view user's status
router.get('/users/:userId/status', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'User status retrieved successfully', 
            data: { status: user.status} 
        });
    } catch (error) {
        console.error('Admin get user status error:', error);
        res.status(500).json({ success: false, message: 'Error fetching user status', error: error.message });
    }
});

// PUT /api/admin/users/:userId/status/ongoing - Admin modify user's status to "On-going"
router.put('/users/:userId/status/ongoing', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const result = await db.collection('user').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { status: 'On-going', updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'User status updated to On-going successfully',
            data: { status: 'On-going' }
        });
    } catch (error) {
        console.error('Admin update user status error:', error);
        res.status(500).json({ success: false, message: 'Error updating user status', error: error.message });
    }
});

// PUT /api/admin/users/:userId/status/completed - Admin modify user's status to "Completed"
router.put('/users/:userId/status/completed', ...adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!validateUserIdParam(userId, res)) return;

        const db = await connectToDB();
        const result = await db.collection('user').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { status: 'Completed', updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'User status updated to Completed successfully',
            data: { status: 'Completed' }
        });
    } catch (error) {
        console.error('Admin update user status error:', error);
        res.status(500).json({ success: false, message: 'Error updating user status', error: error.message });
    }
});

module.exports = router;
