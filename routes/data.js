const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate } = require('../config/auth.js');
const multer = require('multer');
const csvParser = require('csv-parser');
const { Readable } = require('stream');

const router = express.Router();

// Configure multer for file uploads (50MB limit)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// POST /api/data/bmi - Create new BMI record
router.post('/bmi', authenticate, async (req, res) => {
    try {
        const { weight, height, bmi, category, age } = req.body;

        // Validation
        if (!weight || !height || !bmi) {
            return res.status(400).json({
                success: false,
                message: 'Weight, height, and BMI are required'
            });
        }

        // Validate numeric values
        if (isNaN(weight) || isNaN(height) || isNaN(bmi)) {
            return res.status(400).json({
                success: false,
                message: 'Weight, height, and BMI must be valid numbers'
            });
        }

        // Validate positive values
        if (weight <= 0 || height <= 0 || bmi <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Weight, height, and BMI must be positive numbers'
            });
        }

        const db = await connectToDB();

        // Create new BMI record
        const bmiRecord = {
            userId: new ObjectId(req.user._id),
            userEmail: req.user.email,
            age: age ? parseInt(age) : null,
            weight: parseFloat(weight),
            height: parseFloat(height),
            bmi: parseFloat(bmi),
            category: category || getBMICategory(parseFloat(bmi)),
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection("data").insertOne(bmiRecord);

        if (result.insertedId) {
            res.status(201).json({
                success: true,
                message: 'BMI record created successfully',
                data: {
                    id: result.insertedId,
                    ...bmiRecord
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to create BMI record'
            });
        }

    } catch (error) {
        console.error('BMI creation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating BMI record',
            error: error.message
        });
    }
});

// GET /api/data/bmi - Get all BMI records for the authenticated user
router.get('/bmi', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        // Get all BMI records for this user, sorted by date (newest first)
        const records = await db.collection("data")
            .find({ userId: new ObjectId(req.user._id) })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json({
            success: true,
            message: `Found ${records.length} BMI records`,
            data: {
                count: records.length,
                records: records
            }
        });

    } catch (error) {
        console.error('BMI fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching BMI records',
            error: error.message
        });
    }
});

// GET /api/data/bmi/:id - Get single BMI record by ID
router.get('/bmi/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ObjectId format
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid record ID format'
            });
        }

        const db = await connectToDB();

        // Find record by ID and verify ownership
        const record = await db.collection("data").findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(req.user._id)
        });

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'BMI record not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'BMI record found',
            data: record
        });

    } catch (error) {
        console.error('BMI fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching BMI record',
            error: error.message
        });
    }
});

// PUT /api/data/bmi/:id - Update BMI record
router.put('/bmi/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { weight, height, bmi, category, age } = req.body;

        // Validate ObjectId format
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid record ID format'
            });
        }

        // Validation - at least one field must be provided
        if (!weight && !height && !bmi && !category && age === undefined) {
            return res.status(400).json({
                success: false,
                message: 'At least one field is required to update'
            });
        }

        const db = await connectToDB();

        // Check if record exists and belongs to user
        const existingRecord = await db.collection("data").findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(req.user._id)
        });

        if (!existingRecord) {
            return res.status(404).json({
                success: false,
                message: 'BMI record not found'
            });
        }

        // Prepare update data
        const updateData = {
            updatedAt: new Date()
        };

        if (age !== undefined) {
            if (age !== null && (isNaN(age) || parseInt(age) <= 0)) {
                return res.status(400).json({
                    success: false,
                    message: 'Age must be a positive number'
                });
            }
            updateData.age = age !== null ? parseInt(age) : null;
        }

        if (weight) {
            if (isNaN(weight) || parseFloat(weight) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Weight must be a positive number'
                });
            }
            updateData.weight = parseFloat(weight);
        }

        if (height) {
            if (isNaN(height) || parseFloat(height) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Height must be a positive number'
                });
            }
            updateData.height = parseFloat(height);
        }

        if (bmi) {
            if (isNaN(bmi) || parseFloat(bmi) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'BMI must be a positive number'
                });
            }
            updateData.bmi = parseFloat(bmi);
            updateData.category = category || getBMICategory(parseFloat(bmi));
        } else if (category) {
            updateData.category = category;
        }

        // Update record
        const updateResult = await db.collection("data").updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (updateResult.modifiedCount === 1) {
            // Get updated record
            const updatedRecord = await db.collection("data").findOne({
                _id: new ObjectId(id)
            });

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
        console.error('BMI update error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating BMI record',
            error: error.message
        });
    }
});

// DELETE /api/data/bmi/:id - Delete BMI record
router.delete('/bmi/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ObjectId format
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid record ID format'
            });
        }

        const db = await connectToDB();

        // Check if record exists and belongs to user
        const existingRecord = await db.collection("data").findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(req.user._id)
        });

        if (!existingRecord) {
            return res.status(404).json({
                success: false,
                message: 'BMI record not found'
            });
        }

        // Delete record
        const deleteResult = await db.collection("data").deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(req.user._id)
        });

        if (deleteResult.deletedCount === 1) {
            res.status(200).json({
                success: true,
                message: 'BMI record deleted successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to delete BMI record'
            });
        }

    } catch (error) {
        console.error('BMI delete error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting BMI record',
            error: error.message
        });
    }
});

// DELETE /api/data/bmi - Delete all BMI records for the authenticated user
router.delete('/bmi', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        // Delete all records for this user
        const deleteResult = await db.collection("data").deleteMany({
            userId: new ObjectId(req.user._id)
        });

        res.status(200).json({
            success: true,
            message: `Deleted ${deleteResult.deletedCount} BMI records`,
            data: {
                deletedCount: deleteResult.deletedCount
            }
        });

    } catch (error) {
        console.error('BMI delete all error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting BMI records',
            error: error.message
        });
    }
});

// GET /api/data/bmi/stats - Get BMI statistics for the authenticated user
router.get('/bmi/stats', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        // Get all records for statistics
        const records = await db.collection("data")
            .find({ userId: new ObjectId(req.user._id) })
            .sort({ createdAt: -1 })
            .toArray();

        if (records.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No BMI records found',
                data: {
                    count: 0,
                    stats: null
                }
            });
        }

        // Calculate statistics
        const bmiValues = records.map(r => r.bmi);
        const weightValues = records.map(r => r.weight);
        const heightValues = records.map(r => r.height);

        const stats = {
            count: records.length,
            bmi: {
                current: bmiValues[0],
                average: parseFloat((bmiValues.reduce((a, b) => a + b, 0) / bmiValues.length).toFixed(2)),
                min: Math.min(...bmiValues),
                max: Math.max(...bmiValues)
            },
            weight: {
                current: weightValues[0],
                average: parseFloat((weightValues.reduce((a, b) => a + b, 0) / weightValues.length).toFixed(2)),
                min: Math.min(...weightValues),
                max: Math.max(...weightValues)
            },
            height: {
                current: heightValues[0],
                average: parseFloat((heightValues.reduce((a, b) => a + b, 0) / heightValues.length).toFixed(2)),
                min: Math.min(...heightValues),
                max: Math.max(...heightValues)
            },
            latestRecord: records[0],
            firstRecord: records[records.length - 1]
        };

        res.status(200).json({
            success: true,
            message: 'BMI statistics retrieved',
            data: stats
        });

    } catch (error) {
        console.error('BMI stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching BMI statistics',
            error: error.message
        });
    }
});

// Helper function to determine BMI category
function getBMICategory(bmi) {
    if (bmi < 18.5) return 'Underweight';
    if (bmi >= 18.5 && bmi < 25) return 'Normal';
    if (bmi >= 25 && bmi < 30) return 'Overweight';
    return 'Obese';
}

// ==================== HEART RATE ENDPOINTS ====================

// POST /api/data/heartrate/upload - Upload heart rate CSV file (with aggregation)
router.post('/heartrate/upload', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        const db = await connectToDB();
        const userId = new ObjectId(req.user._id);
        const userEmail = req.user.email;

        // Parse CSV
        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');
        
        // Group records by date and hour for aggregation
        const dailyData = {};  // { "2025-06-04": { hourlyData: { 0: [bpms], 1: [bpms], ... }, allBpms: [] } }
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
                        const timeDate = new Date(parsed.time * 1000);
                        const dateOnly = timeDate.toISOString().split('T')[0];
                        const hour = timeDate.getHours();
                        const bpm = parseInt(parsed.bpm);

                        // Initialize date structure if not exists
                        if (!dailyData[dateOnly]) {
                            dailyData[dateOnly] = {
                                hourlyData: {},
                                allBpms: []
                            };
                        }

                        // Initialize hour array if not exists
                        if (!dailyData[dateOnly].hourlyData[hour]) {
                            dailyData[dateOnly].hourlyData[hour] = [];
                        }

                        dailyData[dateOnly].hourlyData[hour].push(bpm);
                        dailyData[dateOnly].allBpms.push(bpm);
                        totalParsed++;
                    }
                }
            } catch (e) {
                // Skip invalid lines
            }
        }

        if (totalParsed === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid records found in CSV file'
            });
        }

        // Convert to aggregated documents
        let insertedCount = 0;
        let updatedCount = 0;

        for (const [date, data] of Object.entries(dailyData)) {
            // Build hourly summaries (24 hours)
            const hourlyStats = [];
            for (let h = 0; h < 24; h++) {
                const hourBpms = data.hourlyData[h] || [];
                if (hourBpms.length > 0) {
                    hourlyStats.push({
                        hour: h,
                        avg: Math.round(hourBpms.reduce((a, b) => a + b, 0) / hourBpms.length),
                        min: Math.min(...hourBpms),
                        max: Math.max(...hourBpms),
                        count: hourBpms.length
                    });
                } else {
                    hourlyStats.push({
                        hour: h,
                        avg: null,
                        min: null,
                        max: null,
                        count: 0
                    });
                }
            }

            // Calculate daily stats
            const allBpms = data.allBpms;
            const dailyStats = {
                avg: Math.round(allBpms.reduce((a, b) => a + b, 0) / allBpms.length),
                min: Math.min(...allBpms),
                max: Math.max(...allBpms),
                count: allBpms.length
            };

            // Check if document for this date already exists
            const existing = await db.collection("heartrate_daily").findOne({
                userId: userId,
                date: date
            });

            if (existing) {
                // Merge with existing data
                const mergedHourly = existing.hourlyData.map((existingHour, idx) => {
                    const newHour = hourlyStats[idx];
                    if (newHour.count === 0) return existingHour;
                    if (existingHour.count === 0) return newHour;
                    
                    const totalCount = existingHour.count + newHour.count;
                    return {
                        hour: idx,
                        avg: Math.round((existingHour.avg * existingHour.count + newHour.avg * newHour.count) / totalCount),
                        min: Math.min(existingHour.min, newHour.min),
                        max: Math.max(existingHour.max, newHour.max),
                        count: totalCount
                    };
                });

                const totalDailyCount = existing.dailyStats.count + dailyStats.count;
                const mergedDaily = {
                    avg: Math.round((existing.dailyStats.avg * existing.dailyStats.count + dailyStats.avg * dailyStats.count) / totalDailyCount),
                    min: Math.min(existing.dailyStats.min, dailyStats.min),
                    max: Math.max(existing.dailyStats.max, dailyStats.max),
                    count: totalDailyCount
                };

                await db.collection("heartrate_daily").updateOne(
                    { _id: existing._id },
                    { 
                        $set: { 
                            hourlyData: mergedHourly, 
                            dailyStats: mergedDaily,
                            updatedAt: new Date()
                        } 
                    }
                );
                updatedCount++;
            } else {
                // Insert new document
                await db.collection("heartrate_daily").insertOne({
                    userId: userId,
                    userEmail: userEmail,
                    date: date,
                    hourlyData: hourlyStats,
                    dailyStats: dailyStats,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                insertedCount++;
            }
        }

        res.status(200).json({
            success: true,
            message: 'Heart rate data uploaded and aggregated successfully',
            data: {
                totalRecordsParsed: totalParsed,
                daysInserted: insertedCount,
                daysUpdated: updatedCount,
                totalDays: Object.keys(dailyData).length
            }
        });

    } catch (error) {
        console.error('Heart rate upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading heart rate data',
            error: error.message
        });
    }
});

// GET /api/data/heartrate - Get heart rate data for a specific date
router.get('/heartrate', authenticate, async (req, res) => {
    try {
        const { date, startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(req.user._id) };

        if (date) {
            query.date = date;
        } else if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection("heartrate_daily")
            .find(query)
            .sort({ date: -1 })
            .toArray();

        res.status(200).json({
            success: true,
            message: `Found ${records.length} days of heart rate data`,
            data: {
                records: records
            }
        });

    } catch (error) {
        console.error('Heart rate fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching heart rate data',
            error: error.message
        });
    }
});

// GET /api/data/heartrate/dates - Get list of available dates
router.get('/heartrate/dates', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        const dates = await db.collection("heartrate_daily")
            .distinct("date", { userId: new ObjectId(req.user._id) });

        dates.sort((a, b) => new Date(b) - new Date(a));

        res.status(200).json({
            success: true,
            message: `Found ${dates.length} dates with heart rate data`,
            data: {
                count: dates.length,
                dates: dates
            }
        });

    } catch (error) {
        console.error('Heart rate dates fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching heart rate dates',
            error: error.message
        });
    }
});

// GET /api/data/heartrate/stats - Get overall statistics
router.get('/heartrate/stats', authenticate, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(req.user._id) };
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection("heartrate_daily").find(query).toArray();

        if (records.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No heart rate data found',
                data: { count: 0, stats: null }
            });
        }

        const allDailyStats = records.map(r => r.dailyStats);
        const totalCount = allDailyStats.reduce((sum, s) => sum + s.count, 0);

        res.status(200).json({
            success: true,
            message: 'Heart rate statistics retrieved',
            data: {
                totalDays: records.length,
                totalReadings: totalCount,
                avgBpm: Math.round(allDailyStats.reduce((sum, s) => sum + s.avg, 0) / records.length),
                minBpm: Math.min(...allDailyStats.map(s => s.min)),
                maxBpm: Math.max(...allDailyStats.map(s => s.max))
            }
        });

    } catch (error) {
        console.error('Heart rate stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching heart rate statistics',
            error: error.message
        });
    }
});

// DELETE /api/data/heartrate - Delete all heart rate data
router.delete('/heartrate', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        const result = await db.collection("heartrate_daily").deleteMany({
            userId: new ObjectId(req.user._id)
        });

        res.status(200).json({
            success: true,
            message: `Deleted ${result.deletedCount} days of heart rate data`,
            data: { deletedCount: result.deletedCount }
        });

    } catch (error) {
        console.error('Heart rate delete error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting heart rate data',
            error: error.message
        });
    }
});

// DELETE /api/data/heartrate/date/:date - Delete heart rate data for specific date
router.delete('/heartrate/date/:date', authenticate, async (req, res) => {
    try {
        const { date } = req.params;
        const db = await connectToDB();

        const result = await db.collection("heartrate_daily").deleteOne({
            userId: new ObjectId(req.user._id),
            date: date
        });

        res.status(200).json({
            success: true,
            message: result.deletedCount ? `Deleted heart rate data for ${date}` : 'No data found for this date',
            data: { deletedCount: result.deletedCount, date: date }
        });

    } catch (error) {
        console.error('Heart rate delete error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting heart rate data',
            error: error.message
        });
    }
});

module.exports = router;
