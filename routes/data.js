const express = require('express');
const { connectToDB, ObjectId } = require('../config/db.js');
const { authenticate } = require('../config/auth.js');

const router = express.Router();

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

module.exports = router;
