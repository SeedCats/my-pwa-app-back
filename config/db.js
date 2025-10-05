const { MongoClient, ObjectId } = require('mongodb');

process.env.MONGODB_URI = process.env.MONGODB_URI ;

let cachedClient = null;
let cachedDb = null;

// Connect to MongoDB
async function connectToDB() {
    if (cachedDb) {
        return cachedDb;
    }

    try {
        console.log('🔄 Connecting to MongoDB...');
        
        const client = await MongoClient.connect(MONGODB_URI);
        const db = client.db('PWA');
        
        // Cache the connection
        cachedClient = client;
        cachedDb = db;
        db.client = client;

        console.log('🚀 MongoDB connected successfully!');
        return db;
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        throw error;
    }
}

// Make sure to export the function
module.exports = { 
    connectToDB, 
    ObjectId 
};