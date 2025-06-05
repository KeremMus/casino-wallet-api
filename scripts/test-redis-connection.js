const redisClient = require('../src/config/redis');

async function testRedisConnection() {
  try {
    await redisClient.set('test-key', 'test-value');
    const value = await redisClient.get('test-key');
    
    if (value === 'test-value') {
      console.log('✅ Redis connection successful!');
      await redisClient.del('test-key'); // Clean up
    } else {
      console.log('❌ Redis test failed');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Redis connection failed:', err.message);
    process.exit(1);
  }
}

testRedisConnection();
