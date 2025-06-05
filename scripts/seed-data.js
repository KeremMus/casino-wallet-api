// scripts/seed-data.js
const pool = require('../src/config/database'); // Assuming this path is correct from your project structure
const { randomUUID } = require('crypto'); // Built-in Node.js module for generating UUIDs

async function seedData() {
  const client = await pool.connect();
  console.log('🚀 Connected to database for seeding...');

  try {
    await client.query('BEGIN'); // Start a database transaction

    const playersToCreate = [
      { name: 'Player One', email: 'player1@example.com' },
      { name: 'Player Two', email: 'player2@example.com' },
      { name: 'Player Three', email: 'player3@example.com' },
      { name: 'Player Four', email: 'player4@example.com' },
      { name: 'Player Five', email: 'player5@example.com' },
      { name: 'Player Six', email: 'player6@example.com' },
      { name: 'Player Seven', email: 'player7@example.com' },
      { name: 'Player Eight', email: 'player8@example.com' },
      { name: 'Player Nine', email: 'player9@example.com' },
      { name: 'Player Ten', email: 'player10@example.com' },
      { name: 'Player Eleven', email: 'player11@example.com' }, // Added an extra one for good measure
    ];

    const initialBalance = 10000.00; // Example initial balance
    const currency = 'INR'; // Default currency as per your wallet schema

    console.log('🌱 Starting to seed players and wallets...');

    for (const playerData of playersToCreate) {
      const playerId = randomUUID(); // Generate a un ique ID for the player
      const walletId = randomUUID(); // Generate a unique ID for the wallet

      // Insert player into players table
      const playerInsertQuery = {
        text: 'INSERT INTO players(id, name, email) VALUES($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id, name;',
        values: [playerId, playerData.name, playerData.email],
      };
      const playerResult = await client.query(playerInsertQuery);
      if (playerResult.rows.length > 0) {
        console.log(`👤 Player '${playerResult.rows[0].name}' seeded with ID: ${playerResult.rows[0].id}`);

        // Insert corresponding wallet into wallets table
        const walletInsertQuery = {
          text: 'INSERT INTO wallets(id, player_id, balance, currency) VALUES($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id, player_id;',
          values: [walletId, playerId, initialBalance, currency],
        };
        const walletResult = await client.query(walletInsertQuery);
        if (walletResult.rows.length > 0) {
          console.log(`   💰 Wallet for player ${walletResult.rows[0].player_id} seeded with ID: ${walletResult.rows[0].id}, Balance: ${initialBalance} ${currency}`);
        } else {
           console.log(`   ⚠️ Wallet for player ${playerId} might already exist or could not be created.`);
        }
      } else {
         console.log(`⚠️ Player with email ${playerData.email} might already exist or could not be created.`);
      }
    }

    await client.query('COMMIT'); // Commit the transaction
    console.log('✅ Seeding completed successfully and transaction committed.');

  } catch (error) {
    await client.query('ROLLBACK'); // Rollback the transaction in case of an error
    console.error('❌ Error during seeding, transaction rolled back:', error.message);
    console.error(error.stack);
    process.exitCode = 1; // Indicate an error exit
  } finally {
    client.release(); // Release the client back to the pool
    console.log('🔌 Database connection released.');
    // It's often better to let the application manage the pool's lifecycle,
    // but for a script, you might want to end it.
    // await pool.end();
    // console.log('Connection pool closed.');
  }
}

seedData().catch(err => {
  console.error('❌ Unhandled error in seedData script:', err.message);
  console.error(err.stack);
  process.exitCode = 1;
});