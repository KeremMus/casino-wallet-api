const fs = require('fs');
const path = require('path');
const pool = require('../src/config/database');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../src/database/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).sort();

  console.log('🚀 Running database migrations...');

  for (const file of migrationFiles) {
    if (file.endsWith('.sql')) {
      console.log(`📄 Running migration: ${file}`);
      
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      
      try {
        await pool.query(migrationSQL);
        console.log(`✅ Migration ${file} completed successfully`);
      } catch (error) {
        console.error(`❌ Migration ${file} failed:`, error.message);
        process.exit(1);
      }
    }
  }

  console.log('🎉 All migrations completed successfully!');
  process.exit(0);
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});