// Simple migration script to add default role 'user' to existing users missing the 'role' field
const { connectToDB } = require('../config/db');

(async () => {
  try {
    const db = await connectToDB();
    const result = await db.collection('user').updateMany(
      { role: { $exists: false } },
      { $set: { role: 'user' } }
    );

    console.log(`Updated ${result.modifiedCount} user(s) to set default role 'user'.`);
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
})();
