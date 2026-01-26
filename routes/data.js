const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate } = require('../config/auth.js');
const multer = require('multer');
const csvParser = require('csv-parser');
const { Readable } = require('stream');

const router = express.Router();

// Configure multer for file uploads (100MB limit)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
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

        const result = await db.collection("bmiData").insertOne(bmiRecord);

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
        const records = await db.collection("bmiData")
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
        const record = await db.collection("bmiData").findOne({
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
        const existingRecord = await db.collection("bmiData").findOne({
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
        const updateResult = await db.collection("bmiData").updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (updateResult.modifiedCount === 1) {
            // Get updated record
            const updatedRecord = await db.collection("bmiData").findOne({
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
        const existingRecord = await db.collection("bmiData").findOne({
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
        const deleteResult = await db.collection("bmiData").deleteOne({
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
        const deleteResult = await db.collection("bmiData").deleteMany({
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
        const records = await db.collection("bmiData")
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
// Also extracts and aggregates stress values from the same CSV and writes to `stress_daily`
const handleCsvUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const db = await connectToDB();
        const userId = new ObjectId(req.user._id);
        const userEmail = req.user.email;

        // Parse CSV
        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');

        // Group records by date and hour for aggregation
        // Structure per date: { hourlyHr: {}, allHr: [], hourlyStress: {}, allStress: [], hourlyPressure: {}, allSystolic: [], allDiastolic: [] }
        const dailyData = {};
        let totalParsed = 0; // counts lines with at least one valid metric

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

                        // Common keys
                        if (parsed.systolic !== undefined) systolic = parseFloat(parsed.systolic);
                        if (parsed.diastolic !== undefined) diastolic = parseFloat(parsed.diastolic);

                        // synonyms
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

        // Convert to aggregated documents for both heartrate, stress and pressure
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

            // Upsert heartrate_daily
            if (dailyHrStats) {
                const existingHr = await db.collection("heartrate_daily").findOne({ userId: userId, date: date });
                if (existingHr) {
                    const mergedHourly = existingHr.hourlyData.map((existingHour, idx) => {
                        const newHour = hourlyHrStats[idx];
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

                    const totalDailyCount = existingHr.dailyStats.count + dailyHrStats.count;
                    const mergedDaily = {
                        avg: Math.round((existingHr.dailyStats.avg * existingHr.dailyStats.count + dailyHrStats.avg * dailyHrStats.count) / totalDailyCount),
                        min: Math.min(existingHr.dailyStats.min, dailyHrStats.min),
                        max: Math.max(existingHr.dailyStats.max, dailyHrStats.max),
                        count: totalDailyCount
                    };

                    await db.collection("heartrate_daily").updateOne({ _id: existingHr._id }, { $set: { hourlyData: mergedHourly, dailyStats: mergedDaily, updatedAt: new Date() } });
                    hrUpdated++;
                } else {
                    await db.collection("heartrate_daily").insertOne({ userId: userId, userEmail: userEmail, date: date, hourlyData: hourlyHrStats, dailyStats: dailyHrStats, createdAt: new Date(), updatedAt: new Date() });
                    hrInserted++;
                }
            }

            // Upsert stress_daily
            if (dailyStressStats) {
                const existingStress = await db.collection("stress_daily").findOne({ userId: userId, date: date });
                if (existingStress) {
                    const mergedHourly = existingStress.hourlyData.map((existingHour, idx) => {
                        const newHour = hourlyStressStats[idx];
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

                    const totalDailyCount = existingStress.dailyStats.count + dailyStressStats.count;
                    const mergedDaily = {
                        avg: Math.round((existingStress.dailyStats.avg * existingStress.dailyStats.count + dailyStressStats.avg * dailyStressStats.count) / totalDailyCount),
                        min: Math.min(existingStress.dailyStats.min, dailyStressStats.min),
                        max: Math.max(existingStress.dailyStats.max, dailyStressStats.max),
                        count: totalDailyCount
                    };

                    await db.collection("stress_daily").updateOne({ _id: existingStress._id }, { $set: { hourlyData: mergedHourly, dailyStats: mergedDaily, updatedAt: new Date() } });
                    stressUpdated++;
                } else {
                    await db.collection("stress_daily").insertOne({ userId: userId, userEmail: userEmail, date: date, hourlyData: hourlyStressStats, dailyStats: dailyStressStats, createdAt: new Date(), updatedAt: new Date() });
                    stressInserted++;
                }
            }

            // Upsert pressure_daily (systolic/diastolic)
            if (data.allSystolic && data.allSystolic.length > 0) {
                // Build hourly pressure summaries
                const hourlyPressureStats = [];
                for (let h = 0; h < 24; h++) {
                    const arr = data.hourlyPressure[h] || [];
                    if (arr.length > 0) {
                        const systArr = arr.map(p => p.systolic);
                        const diaArr = arr.map(p => p.diastolic);
                        hourlyPressureStats.push({
                            hour: h,
                            systolic: {
                                avg: Math.round(systArr.reduce((a, b) => a + b, 0) / systArr.length),
                                min: Math.min(...systArr),
                                max: Math.max(...systArr),
                                count: systArr.length
                            },
                            diastolic: {
                                avg: Math.round(diaArr.reduce((a, b) => a + b, 0) / diaArr.length),
                                min: Math.min(...diaArr),
                                max: Math.max(...diaArr),
                                count: diaArr.length
                            }
                        });
                    } else {
                        hourlyPressureStats.push({ hour: h, systolic: { avg: null, min: null, max: null, count: 0 }, diastolic: { avg: null, min: null, max: null, count: 0 } });
                    }
                }

                const allS = data.allSystolic;
                const allD = data.allDiastolic;
                const dailyPressureStats = {
                    avgSystolic: Math.round(allS.reduce((a, b) => a + b, 0) / allS.length),
                    minSystolic: Math.min(...allS),
                    maxSystolic: Math.max(...allS),
                    avgDiastolic: Math.round(allD.reduce((a, b) => a + b, 0) / allD.length),
                    minDiastolic: Math.min(...allD),
                    maxDiastolic: Math.max(...allD),
                    count: Math.min(allS.length, allD.length)
                };

                const existingPressure = await db.collection("pressure_daily").findOne({ userId: userId, date: date });
                if (existingPressure) {
                    const mergedHourly = existingPressure.hourlyData.map((existingHour, idx) => {
                        const newHour = hourlyPressureStats[idx];
                        // if no new data for the hour keep existing
                        if (newHour.systolic.count === 0 && newHour.diastolic.count === 0) return existingHour;
                        if (existingHour.systolic.count === 0 && existingHour.diastolic.count === 0) return newHour;

                        const mergedSystolic = (() => {
                            if (existingHour.systolic.count === 0) return newHour.systolic;
                            if (newHour.systolic.count === 0) return existingHour.systolic;
                            const total = existingHour.systolic.count + newHour.systolic.count;
                            return {
                                avg: Math.round((existingHour.systolic.avg * existingHour.systolic.count + newHour.systolic.avg * newHour.systolic.count) / total),
                                min: Math.min(existingHour.systolic.min, newHour.systolic.min),
                                max: Math.max(existingHour.systolic.max, newHour.systolic.max),
                                count: total
                            };
                        })();

                        const mergedDiastolic = (() => {
                            if (existingHour.diastolic.count === 0) return newHour.diastolic;
                            if (newHour.diastolic.count === 0) return existingHour.diastolic;
                            const total = existingHour.diastolic.count + newHour.diastolic.count;
                            return {
                                avg: Math.round((existingHour.diastolic.avg * existingHour.diastolic.count + newHour.diastolic.avg * newHour.diastolic.count) / total),
                                min: Math.min(existingHour.diastolic.min, newHour.diastolic.min),
                                max: Math.max(existingHour.diastolic.max, newHour.diastolic.max),
                                count: total
                            };
                        })();

                        return { hour: idx, systolic: mergedSystolic, diastolic: mergedDiastolic };
                    });

                    const totalDailyCountS = existingPressure.dailyStats.count + dailyPressureStats.count;
                    // merge daily stats by weighted avg for avg values
                    const mergedDaily = {
                        avgSystolic: Math.round((existingPressure.dailyStats.avgSystolic * existingPressure.dailyStats.count + dailyPressureStats.avgSystolic * dailyPressureStats.count) / totalDailyCountS),
                        minSystolic: Math.min(existingPressure.dailyStats.minSystolic, dailyPressureStats.minSystolic),
                        maxSystolic: Math.max(existingPressure.dailyStats.maxSystolic, dailyPressureStats.maxSystolic),
                        avgDiastolic: Math.round((existingPressure.dailyStats.avgDiastolic * existingPressure.dailyStats.count + dailyPressureStats.avgDiastolic * dailyPressureStats.count) / totalDailyCountS),
                        minDiastolic: Math.min(existingPressure.dailyStats.minDiastolic, dailyPressureStats.minDiastolic),
                        maxDiastolic: Math.max(existingPressure.dailyStats.maxDiastolic, dailyPressureStats.maxDiastolic),
                        count: totalDailyCountS
                    };

                    await db.collection("pressure_daily").updateOne({ _id: existingPressure._id }, { $set: { hourlyData: mergedHourly, dailyStats: mergedDaily, updatedAt: new Date() } });
                    pressureUpdated++;
                } else {
                    await db.collection("pressure_daily").insertOne({ userId: userId, userEmail: userEmail, date: date, hourlyData: hourlyPressureStats, dailyStats: dailyPressureStats, createdAt: new Date(), updatedAt: new Date() });
                    pressureInserted++;
                }
            }
        }

        res.status(200).json({
            success: true,
            message: 'Data uploaded and aggregated successfully',
            data: {
                totalRecordsParsed: totalParsed,
                heartRate: { daysInserted: hrInserted, daysUpdated: hrUpdated },
                stress: { daysInserted: stressInserted, daysUpdated: stressUpdated },
                pressure: { daysInserted: pressureInserted, daysUpdated: pressureUpdated },
                totalDaysProcessed: Object.keys(dailyData).length
            }
        });

    } catch (error) {
        console.error('CSV upload error:', error);
        res.status(500).json({ success: false, message: 'Error uploading data', error: error.message });
    }
};

// POST /api/data/heartrate/upload - Upload heart rate CSV file (heartrate-only)
const handleHeartrateOnlyUpload = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const db = await connectToDB();
        const userId = new ObjectId(req.user._id);
        const userEmail = req.user.email;

        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');

        const dailyData = {}; // { date: { hourlyHr: {}, allHr: [] } }
        let totalParsed = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const startIdx = line.indexOf('{');
                const endIdx = line.lastIndexOf('}');
                if (startIdx === -1 || endIdx === -1) continue;

                const jsonStr = line.substring(startIdx, endIdx + 1).replace(/""/g, '"');
                const parsed = JSON.parse(jsonStr);

                if (parsed.time && parsed.bpm !== undefined) {
                    const bpm = parseInt(parsed.bpm);
                    if (!isNaN(bpm) && bpm >= 20 && bpm <= 220) {
                        const timeDate = new Date(parsed.time * 1000);
                        const dateOnly = timeDate.toISOString().split('T')[0];
                        const hour = timeDate.getHours();

                        if (!dailyData[dateOnly]) dailyData[dateOnly] = { hourlyHr: {}, allHr: [] };
                        if (!dailyData[dateOnly].hourlyHr[hour]) dailyData[dateOnly].hourlyHr[hour] = [];
                        dailyData[dateOnly].hourlyHr[hour].push(bpm);
                        dailyData[dateOnly].allHr.push(bpm);
                        totalParsed++;
                    }
                }
            } catch (e) {
                // skip invalid lines silently
            }
        }

        if (totalParsed === 0) return res.status(400).json({ success: false, message: 'No valid heart rate records found in CSV file' });

        let hrInserted = 0, hrUpdated = 0;

        for (const [date, data] of Object.entries(dailyData)) {
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

            if (dailyHrStats) {
                const existingHr = await db.collection("heartrate_daily").findOne({ userId: userId, date: date });
                if (existingHr) {
                    const mergedHourly = existingHr.hourlyData.map((existingHour, idx) => {
                        const newHour = hourlyHrStats[idx];
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

                    const totalDailyCount = existingHr.dailyStats.count + dailyHrStats.count;
                    const mergedDaily = {
                        avg: Math.round((existingHr.dailyStats.avg * existingHr.dailyStats.count + dailyHrStats.avg * dailyHrStats.count) / totalDailyCount),
                        min: Math.min(existingHr.dailyStats.min, dailyHrStats.min),
                        max: Math.max(existingHr.dailyStats.max, dailyHrStats.max),
                        count: totalDailyCount
                    };

                    await db.collection("heartrate_daily").updateOne({ _id: existingHr._id }, { $set: { hourlyData: mergedHourly, dailyStats: mergedDaily, updatedAt: new Date() } });
                    hrUpdated++;
                } else {
                    await db.collection("heartrate_daily").insertOne({ userId: userId, userEmail: userEmail, date: date, hourlyData: hourlyHrStats, dailyStats: dailyHrStats, createdAt: new Date(), updatedAt: new Date() });
                    hrInserted++;
                }
            }
        }

        res.status(200).json({
            success: true,
            message: 'Heart rate data uploaded and aggregated successfully',
            data: {
                totalRecordsParsed: totalParsed,
                heartRate: { daysInserted: hrInserted, daysUpdated: hrUpdated },
                totalDaysProcessed: Object.keys(dailyData).length
            }
        });
    } catch (error) {
        console.error('Heart rate CSV upload error:', error);
        res.status(500).json({ success: false, message: 'Error uploading heart rate data', error: error.message });
    }
};

// Bind heartrate-only upload (replaces previous multi-metric upload)
router.post('/heartrate/upload', authenticate, upload.single('file'), handleHeartrateOnlyUpload);

// New endpoint: /uploadAll — performs uploading of heart rate + stress + pressure (legacy behavior)
router.post('/uploadAll', authenticate, upload.single('file'), handleCsvUpload);

// POST /api/data/stress/upload - Upload CSV but only process stress values (stress-only upload)
const handleStressOnlyUpload = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const db = await connectToDB();
        const userId = new ObjectId(req.user._id);
        const userEmail = req.user.email;

        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');

        const dailyData = {}; // { date: { hourlyStress: {}, allStress: [] } }
        let totalParsed = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const startIdx = line.indexOf('{');
                const endIdx = line.lastIndexOf('}');
                if (startIdx === -1 || endIdx === -1) continue;

                const jsonStr = line.substring(startIdx, endIdx + 1).replace(/""/g, '"');
                const parsed = JSON.parse(jsonStr);

                if (parsed.time && parsed.stress !== undefined) {
                    const stressVal = parseFloat(parsed.stress);
                    if (isNaN(stressVal) || stressVal < 0 || stressVal > 100) continue;

                    const timeDate = new Date(parsed.time * 1000);
                    const dateOnly = timeDate.toISOString().split('T')[0];
                    const hour = timeDate.getHours();

                    if (!dailyData[dateOnly]) dailyData[dateOnly] = { hourlyStress: {}, allStress: [] };
                    if (!dailyData[dateOnly].hourlyStress[hour]) dailyData[dateOnly].hourlyStress[hour] = [];

                    dailyData[dateOnly].hourlyStress[hour].push(stressVal);
                    dailyData[dateOnly].allStress.push(stressVal);
                    totalParsed++;
                }
            } catch (e) {
                // skip malformed lines
            }
        }

        if (totalParsed === 0) return res.status(400).json({ success: false, message: 'No valid stress records found in CSV file' });

        let inserted = 0, updated = 0;

        for (const [date, data] of Object.entries(dailyData)) {
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
            const dailyStressStats = {
                avg: Math.round(allStress.reduce((a, b) => a + b, 0) / allStress.length),
                min: Math.min(...allStress),
                max: Math.max(...allStress),
                count: allStress.length
            };

            const existing = await db.collection('stress_daily').findOne({ userId: userId, date: date });
            if (existing) {
                const mergedHourly = existing.hourlyData.map((existingHour, idx) => {
                    const newHour = hourlyStressStats[idx];
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

                const totalDailyCount = existing.dailyStats.count + dailyStressStats.count;
                const mergedDaily = {
                    avg: Math.round((existing.dailyStats.avg * existing.dailyStats.count + dailyStressStats.avg * dailyStressStats.count) / totalDailyCount),
                    min: Math.min(existing.dailyStats.min, dailyStressStats.min),
                    max: Math.max(existing.dailyStats.max, dailyStressStats.max),
                    count: totalDailyCount
                };

                await db.collection('stress_daily').updateOne({ _id: existing._id }, { $set: { hourlyData: mergedHourly, dailyStats: mergedDaily, updatedAt: new Date() } });
                updated++;
            } else {
                await db.collection('stress_daily').insertOne({ userId: userId, userEmail: userEmail, date: date, hourlyData: hourlyStressStats, dailyStats: dailyStressStats, createdAt: new Date(), updatedAt: new Date() });
                inserted++;
            }
        }

        res.status(200).json({ success: true, message: 'Stress data uploaded and aggregated successfully', data: { totalRecordsParsed: totalParsed, daysInserted: inserted, daysUpdated: updated, totalDays: Object.keys(dailyData).length } });

    } catch (error) {
        console.error('Stress-only upload error:', error);
        res.status(500).json({ success: false, message: 'Error uploading stress data', error: error.message });
    }
};

router.post('/stress/upload', authenticate, upload.single('file'), handleStressOnlyUpload);

// POST /api/data/pressure/upload - Upload CSV but only process blood pressure (systolic/diastolic)
const handlePressureOnlyUpload = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const db = await connectToDB();
        const userId = new ObjectId(req.user._id);
        const userEmail = req.user.email;

        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n');

        const dailyData = {}; // { date: { hourlyPressure: {}, allSystolic: [], allDiastolic: [] } }
        let totalParsed = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const startIdx = line.indexOf('{');
                const endIdx = line.lastIndexOf('}');
                if (startIdx === -1 || endIdx === -1) continue;

                const jsonStr = line.substring(startIdx, endIdx + 1).replace(/""/g, '"');
                const parsed = JSON.parse(jsonStr);

                if (parsed.time) {
                    let systolic = undefined;
                    let diastolic = undefined;

                    if (parsed.systolic !== undefined) systolic = parseFloat(parsed.systolic);
                    if (parsed.diastolic !== undefined) diastolic = parseFloat(parsed.diastolic);
                    if (systolic === undefined && parsed.sbp !== undefined) systolic = parseFloat(parsed.sbp);
                    if (diastolic === undefined && parsed.dbp !== undefined) diastolic = parseFloat(parsed.dbp);
                    if (systolic === undefined && parsed.sys !== undefined) systolic = parseFloat(parsed.sys);
                    if (diastolic === undefined && parsed.dia !== undefined) diastolic = parseFloat(parsed.dia);

                    if ((systolic === undefined || diastolic === undefined) && parsed.bp !== undefined) {
                        const parts = ('' + parsed.bp).split('/');
                        if (parts.length === 2) {
                            const s = parseFloat(parts[0]);
                            const d = parseFloat(parts[1]);
                            if (!isNaN(s) && !isNaN(d)) {
                                systolic = s; diastolic = d;
                            }
                        }
                    }

                    if (systolic !== undefined && diastolic !== undefined) {
                        if (!isNaN(systolic) && !isNaN(diastolic) && systolic >= 50 && systolic <= 250 && diastolic >= 30 && diastolic <= 170) {
                            const timeDate = new Date(parsed.time * 1000);
                            const dateOnly = timeDate.toISOString().split('T')[0];
                            const hour = timeDate.getHours();

                            if (!dailyData[dateOnly]) dailyData[dateOnly] = { hourlyPressure: {}, allSystolic: [], allDiastolic: [] };
                            if (!dailyData[dateOnly].hourlyPressure[hour]) dailyData[dateOnly].hourlyPressure[hour] = [];

                            dailyData[dateOnly].hourlyPressure[hour].push({ systolic: Math.round(systolic), diastolic: Math.round(diastolic) });
                            dailyData[dateOnly].allSystolic.push(Math.round(systolic));
                            dailyData[dateOnly].allDiastolic.push(Math.round(diastolic));
                            totalParsed++;
                        }
                    }
                }
            } catch (e) {
                // skip malformed lines
            }
        }

        if (totalParsed === 0) return res.status(400).json({ success: false, message: 'No valid pressure records found in CSV file' });

        let inserted = 0, updated = 0;

        for (const [date, data] of Object.entries(dailyData)) {
            const hourlyPressureStats = [];
            for (let h = 0; h < 24; h++) {
                const arr = data.hourlyPressure[h] || [];
                if (arr.length > 0) {
                    const systArr = arr.map(p => p.systolic);
                    const diaArr = arr.map(p => p.diastolic);
                    hourlyPressureStats.push({
                        hour: h,
                        systolic: { avg: Math.round(systArr.reduce((a, b) => a + b, 0) / systArr.length), min: Math.min(...systArr), max: Math.max(...systArr), count: systArr.length },
                        diastolic: { avg: Math.round(diaArr.reduce((a, b) => a + b, 0) / diaArr.length), min: Math.min(...diaArr), max: Math.max(...diaArr), count: diaArr.length }
                    });
                } else {
                    hourlyPressureStats.push({ hour: h, systolic: { avg: null, min: null, max: null, count: 0 }, diastolic: { avg: null, min: null, max: null, count: 0 } });
                }
            }

            const allS = data.allSystolic;
            const allD = data.allDiastolic;
            const dailyPressureStats = {
                avgSystolic: Math.round(allS.reduce((a, b) => a + b, 0) / allS.length),
                minSystolic: Math.min(...allS),
                maxSystolic: Math.max(...allS),
                avgDiastolic: Math.round(allD.reduce((a, b) => a + b, 0) / allD.length),
                minDiastolic: Math.min(...allD),
                maxDiastolic: Math.max(...allD),
                count: Math.min(allS.length, allD.length)
            };

            const existing = await db.collection('pressure_daily').findOne({ userId: userId, date: date });
            if (existing) {
                const mergedHourly = existing.hourlyData.map((existingHour, idx) => {
                    const newHour = hourlyPressureStats[idx];
                    if (newHour.systolic.count === 0 && newHour.diastolic.count === 0) return existingHour;
                    if (existingHour.systolic.count === 0 && existingHour.diastolic.count === 0) return newHour;

                    const mergedSystolic = (() => {
                        if (existingHour.systolic.count === 0) return newHour.systolic;
                        if (newHour.systolic.count === 0) return existingHour.systolic;
                        const total = existingHour.systolic.count + newHour.systolic.count;
                        return {
                            avg: Math.round((existingHour.systolic.avg * existingHour.systolic.count + newHour.systolic.avg * newHour.systolic.count) / total),
                            min: Math.min(existingHour.systolic.min, newHour.systolic.min),
                            max: Math.max(existingHour.systolic.max, newHour.systolic.max),
                            count: total
                        };
                    })();

                    const mergedDiastolic = (() => {
                        if (existingHour.diastolic.count === 0) return newHour.diastolic;
                        if (newHour.diastolic.count === 0) return existingHour.diastolic;
                        const total = existingHour.diastolic.count + newHour.diastolic.count;
                        return {
                            avg: Math.round((existingHour.diastolic.avg * existingHour.diastolic.count + newHour.diastolic.avg * newHour.diastolic.count) / total),
                            min: Math.min(existingHour.diastolic.min, newHour.diastolic.min),
                            max: Math.max(existingHour.diastolic.max, newHour.diastolic.max),
                            count: total
                        };
                    })();

                    return { hour: idx, systolic: mergedSystolic, diastolic: mergedDiastolic };
                });

                const totalDailyCount = existing.dailyStats.count + dailyPressureStats.count;
                const mergedDaily = {
                    avgSystolic: Math.round((existing.dailyStats.avgSystolic * existing.dailyStats.count + dailyPressureStats.avgSystolic * dailyPressureStats.count) / totalDailyCount),
                    minSystolic: Math.min(existing.dailyStats.minSystolic, dailyPressureStats.minSystolic),
                    maxSystolic: Math.max(existing.dailyStats.maxSystolic, dailyPressureStats.maxSystolic),
                    avgDiastolic: Math.round((existing.dailyStats.avgDiastolic * existing.dailyStats.count + dailyPressureStats.avgDiastolic * dailyPressureStats.count) / totalDailyCount),
                    minDiastolic: Math.min(existing.dailyStats.minDiastolic, dailyPressureStats.minDiastolic),
                    maxDiastolic: Math.max(existing.dailyStats.maxDiastolic, dailyPressureStats.maxDiastolic),
                    count: totalDailyCount
                };

                await db.collection('pressure_daily').updateOne({ _id: existing._id }, { $set: { hourlyData: mergedHourly, dailyStats: mergedDaily, updatedAt: new Date() } });
                updated++;
            } else {
                await db.collection('pressure_daily').insertOne({ userId: userId, userEmail: userEmail, date: date, hourlyData: hourlyPressureStats, dailyStats: dailyPressureStats, createdAt: new Date(), updatedAt: new Date() });
                inserted++;
            }
        }

        res.status(200).json({ success: true, message: 'Pressure data uploaded and aggregated successfully', data: { totalRecordsParsed: totalParsed, daysInserted: inserted, daysUpdated: updated, totalDays: Object.keys(dailyData).length } });

    } catch (error) {
        console.error('Pressure-only upload error:', error);
        res.status(500).json({ success: false, message: 'Error uploading pressure data', error: error.message });
    }
};

router.post('/pressure/upload', authenticate, upload.single('file'), handlePressureOnlyUpload);

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

// ==================== STRESS ENDPOINTS (mirrors heart rate) ====================

// GET /api/data/stress - Get stress data for a specific date or range
router.get('/stress', authenticate, async (req, res) => {
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

        const records = await db.collection("stress_daily")
            .find(query)
            .sort({ date: -1 })
            .toArray();

        res.status(200).json({
            success: true,
            message: `Found ${records.length} days of stress data`,
            data: { records: records }
        });

    } catch (error) {
        console.error('Stress fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching stress data', error: error.message });
    }
});

// GET /api/data/stress/dates - Get list of available dates
router.get('/stress/dates', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        const dates = await db.collection("stress_daily").distinct("date", { userId: new ObjectId(req.user._id) });

        dates.sort((a, b) => new Date(b) - new Date(a));

        res.status(200).json({ success: true, message: `Found ${dates.length} dates with stress data`, data: { count: dates.length, dates: dates } });

    } catch (error) {
        console.error('Stress dates fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching stress dates', error: error.message });
    }
});

// GET /api/data/stress/stats - Get overall statistics
router.get('/stress/stats', authenticate, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(req.user._id) };
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection("stress_daily").find(query).toArray();

        if (records.length === 0) {
            return res.status(200).json({ success: true, message: 'No stress data found', data: { count: 0, stats: null } });
        }

        const allDailyStats = records.map(r => r.dailyStats);
        const totalCount = allDailyStats.reduce((sum, s) => sum + s.count, 0);

        res.status(200).json({
            success: true,
            message: 'Stress statistics retrieved',
            data: {
                totalDays: records.length,
                totalReadings: totalCount,
                avgStress: Math.round(allDailyStats.reduce((sum, s) => sum + s.avg, 0) / records.length),
                minStress: Math.min(...allDailyStats.map(s => s.min)),
                maxStress: Math.max(...allDailyStats.map(s => s.max))
            }
        });

    } catch (error) {
        console.error('Stress stats error:', error);
        res.status(500).json({ success: false, message: 'Error fetching stress statistics', error: error.message });
    }
});

// DELETE /api/data/stress - Delete all stress data
router.delete('/stress', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        const result = await db.collection("stress_daily").deleteMany({ userId: new ObjectId(req.user._id) });

        res.status(200).json({ success: true, message: `Deleted ${result.deletedCount} days of stress data`, data: { deletedCount: result.deletedCount } });

    } catch (error) {
        console.error('Stress delete error:', error);
        res.status(500).json({ success: false, message: 'Error deleting stress data', error: error.message });
    }
});

// DELETE /api/data/stress/date/:date - Delete stress data for specific date
router.delete('/stress/date/:date', authenticate, async (req, res) => {
    try {
        const { date } = req.params;
        const db = await connectToDB();

        const result = await db.collection("stress_daily").deleteOne({ userId: new ObjectId(req.user._id), date: date });

        res.status(200).json({ success: true, message: result.deletedCount ? `Deleted stress data for ${date}` : 'No data found for this date', data: { deletedCount: result.deletedCount, date: date } });

    } catch (error) {
        console.error('Stress delete error:', error);
        res.status(500).json({ success: false, message: 'Error deleting stress data', error: error.message });
    }
});

// ==================== PRESSURE ENDPOINTS ====================

// GET /api/data/pressure - Get pressure data for a specific date or range
router.get('/pressure', authenticate, async (req, res) => {
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

        const records = await db.collection("pressure_daily").find(query).sort({ date: -1 }).toArray();

        res.status(200).json({ success: true, message: `Found ${records.length} days of pressure data`, data: { records: records } });

    } catch (error) {
        console.error('Pressure fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching pressure data', error: error.message });
    }
});

// GET /api/data/pressure/dates - Get list of available dates
router.get('/pressure/dates', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        const dates = await db.collection("pressure_daily").distinct("date", { userId: new ObjectId(req.user._id) });

        dates.sort((a, b) => new Date(b) - new Date(a));

        res.status(200).json({ success: true, message: `Found ${dates.length} dates with pressure data`, data: { count: dates.length, dates: dates } });

    } catch (error) {
        console.error('Pressure dates fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching pressure dates', error: error.message });
    }
});

// GET /api/data/pressure/stats - Get overall statistics
router.get('/pressure/stats', authenticate, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const db = await connectToDB();

        const query = { userId: new ObjectId(req.user._id) };
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = startDate;
            if (endDate) query.date.$lte = endDate;
        }

        const records = await db.collection("pressure_daily").find(query).toArray();

        if (records.length === 0) {
            return res.status(200).json({ success: true, message: 'No pressure data found', data: { count: 0, stats: null } });
        }

        const allDailyStats = records.map(r => r.dailyStats);
        const totalCount = allDailyStats.reduce((sum, s) => sum + s.count, 0);

        res.status(200).json({
            success: true,
            message: 'Pressure statistics retrieved',
            data: {
                totalDays: records.length,
                totalReadings: totalCount,
                avgSystolic: Math.round(allDailyStats.reduce((sum, s) => sum + s.avgSystolic, 0) / records.length),
                minSystolic: Math.min(...allDailyStats.map(s => s.minSystolic)),
                maxSystolic: Math.max(...allDailyStats.map(s => s.maxSystolic)),
                avgDiastolic: Math.round(allDailyStats.reduce((sum, s) => sum + s.avgDiastolic, 0) / records.length),
                minDiastolic: Math.min(...allDailyStats.map(s => s.minDiastolic)),
                maxDiastolic: Math.max(...allDailyStats.map(s => s.maxDiastolic))
            }
        });

    } catch (error) {
        console.error('Pressure stats error:', error);
        res.status(500).json({ success: false, message: 'Error fetching pressure statistics', error: error.message });
    }
});

// DELETE /api/data/pressure - Delete all pressure data
router.delete('/pressure', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();

        const result = await db.collection("pressure_daily").deleteMany({ userId: new ObjectId(req.user._id) });

        res.status(200).json({ success: true, message: `Deleted ${result.deletedCount} days of pressure data`, data: { deletedCount: result.deletedCount } });

    } catch (error) {
        console.error('Pressure delete error:', error);
        res.status(500).json({ success: false, message: 'Error deleting pressure data', error: error.message });
    }
});

// DELETE /api/data/pressure/date/:date - Delete pressure data for specific date
router.delete('/pressure/date/:date', authenticate, async (req, res) => {
    try {
        const { date } = req.params;
        const db = await connectToDB();

        const result = await db.collection("pressure_daily").deleteOne({ userId: new ObjectId(req.user._id), date: date });

        res.status(200).json({ success: true, message: result.deletedCount ? `Deleted pressure data for ${date}` : 'No data found for this date', data: { deletedCount: result.deletedCount, date: date } });

    } catch (error) {
        console.error('Pressure delete error:', error);
        res.status(500).json({ success: false, message: 'Error deleting pressure data', error: error.message });
    }
});

// -------------------- STATUS ENDPOINTS --------------------
// GET /api/data/status - Get user's current status
router.get('/status', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();
        const targetUserId = new ObjectId(req.user._id);

        let statusDoc = await db.collection('user_status').findOne({ userId: targetUserId });
        if (!statusDoc) {
            // create default
            const now = new Date();
            const doc = { userId: targetUserId, status: 'On-going', createdAt: now, updatedAt: now };
            const r = await db.collection('user_status').insertOne(doc);
            statusDoc = doc;
            statusDoc._id = r.insertedId;
        }

        res.status(200).json({ success: true, message: 'Status fetched', data: { status: statusDoc.status, updatedAt: statusDoc.updatedAt, userId: String(statusDoc.userId) } });

    } catch (error) {
        console.error('Status fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching status', error: error.message });
    }
});

// POST /api/data/status/complete - Mark services as Completed for the current user
router.post('/status/complete', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();
        const targetUserId = new ObjectId(req.user._id);

        const now = new Date();
        const update = {
            $set: { status: 'Completed', updatedAt: now },
            $setOnInsert: { createdAt: now }
        };

        const result = await db.collection('user_status').updateOne({ userId: targetUserId }, update, { upsert: true });

        res.status(200).json({ success: true, message: 'Status set to Completed', data: { userId: String(targetUserId), upsertedId: result.upsertedId || null, modifiedCount: result.modifiedCount } });

    } catch (error) {
        console.error('Status update error:', error);
        res.status(500).json({ success: false, message: 'Error updating status', error: error.message });
    }
});

// POST /api/data/status/ongoing - Mark services as On-going for the current user
router.post('/status/ongoing', authenticate, async (req, res) => {
    try {
        const db = await connectToDB();
        const targetUserId = new ObjectId(req.user._id);

        const now = new Date();
        const update = {
            $set: { status: 'On-going', updatedAt: now },
            $setOnInsert: { createdAt: now }
        };

        const result = await db.collection('user_status').updateOne({ userId: targetUserId }, update, { upsert: true });

        res.status(200).json({ success: true, message: 'Status set to On-going', data: { userId: String(targetUserId), upsertedId: result.upsertedId || null, modifiedCount: result.modifiedCount } });

    } catch (error) {
        console.error('Status update error:', error);
        res.status(500).json({ success: false, message: 'Error updating status', error: error.message });
    }
});

module.exports = router;
