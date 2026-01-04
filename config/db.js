require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'PWA';

let cachedClient = null;
let cachedDb = null;

/**
 * Connect to MongoDB with connection caching
 * @returns {Promise<Db>} MongoDB database instance
 */
async function connectToDB() {
    // Return cached connection if available
    if (cachedDb && cachedClient) {
        return cachedDb;
    }

    try {
        console.log('🔄 Connecting to MongoDB...');
        
        const client = await MongoClient.connect(MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 2,
            serverSelectionTimeoutMS: 5000
        });
        
        const db = client.db(DB_NAME);
        
        // Cache the connection
        cachedClient = client;
        cachedDb = db;
        db.client = client;

        console.log('🚀 MongoDB connected successfully!');
        return db;
        
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        throw error;
    }
}

module.exports = { 
    connectToDB, 
    ObjectId 
};