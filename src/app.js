const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import the database pool
const pool = require('./config/database'); //  Ensure this line is added or pool is accessible
const Joi = require('joi'); // Add Joi for validation
const Decimal = require('decimal.js'); // Add Decimal.js for precise math


const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
  message: {
    status: 'rejected',
    reason: 'Too many requests, please try again later'
  }
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const eventSchema = Joi.object({
  type: Joi.string().valid('bet', 'result').required(),
  amount: Joi.string().pattern(/^[0-9]+(\.[0-9]{1,2})?$/).required(), 
  currency: Joi.string().length(3),
  game_code: Joi.string().required(),
  player_id: Joi.string().required(),
  wallet_id: Joi.string().required(), 
  req_id: Joi.string().uuid().required(), 
  round_id: Joi.string().required(),
  session_id: Joi.string().required()
});


app.post('/event', async (req, res, next) => {
  const eventData = req.body;

  // 1. Validate Input
  const { error, value } = eventSchema.validate(eventData);
  if (error) {
    return res.status(400).json({
      status: 'rejected',
      reason: `Invalid event data: ${error.details.map(d => d.message).join(', ')}`
    });
  }

  // Destructure validated values
  const {
    type,
    amount, 
    currency,
    game_code,
    player_id,
    wallet_id,
    req_id,
    round_id,
    session_id
  } = value;

  const eventAmount = new Decimal(amount);

  // Get a client from the pool to use for the transaction
  const client = await pool.connect();

  try {
    // 2. Start Database Transaction
    await client.query('BEGIN');
    console.log(`Processing ${type} event: req_id ${req_id}, round_id ${round_id}`);



    if (type === 'bet') {
    // 1. Fetch player's wallet and lock the row for update
    const walletQuery = 'SELECT id, balance, currency FROM wallets WHERE player_id = $1 AND id = $2 FOR UPDATE';
    // We use player_id and wallet_id from the event to ensure they match the intended wallet.
    // FOR UPDATE locks the selected row to prevent race conditions during balance updates.
    const { rows: walletRows } = await client.query(walletQuery, [player_id, wallet_id]);

    if (walletRows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`Bet rejected: Wallet not found for player_id ${player_id} and wallet_id ${wallet_id}. req_id: ${req_id}`);
      return res.status(400).json({ status: 'rejected', reason: `Wallet not found or player/wallet ID mismatch for player ${player_id}.` });
    }

    const wallet = walletRows[0];
    const currentBalance = new Decimal(wallet.balance);

    // 2. Check for sufficient balance
    if (currentBalance.lessThan(eventAmount)) {
      await client.query('ROLLBACK');
      console.warn(`Bet rejected: Insufficient funds for player_id ${player_id}. Requested: ${eventAmount}, Balance: ${currentBalance}. req_id: ${req_id}`);
      return res.status(400).json({ status: 'rejected', reason: 'Insufficient funds.' });
    }

    // 3. Deduct bet amount and update wallet
    const newBalance = currentBalance.minus(eventAmount);
    const updateWalletQuery = 'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
    await client.query(updateWalletQuery, [newBalance.toFixed(2), wallet.id]);
    console.log(`Balance updated for wallet ${wallet.id}: ${currentBalance.toFixed(2)} -> ${newBalance.toFixed(2)}`);

    // 4. Record the transaction in 'transactions' table
    // Schema: id, req_id, player_id, wallet_id, round_id, session_id, game_code, type, amount, currency, balance_before, balance_after, status, created_at
    //
    const insertTransactionQuery = `
      INSERT INTO transactions (
        req_id, player_id, wallet_id, round_id, session_id, game_code, 
        type, amount, currency, balance_before, balance_after, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    await client.query(insertTransactionQuery, [
      req_id, player_id, wallet.id, round_id, session_id, game_code,
      'bet', eventAmount.toFixed(2), wallet.currency, currentBalance.toFixed(2), newBalance.toFixed(2), 'completed'
    ]);
    console.log(`Bet transaction recorded: req_id ${req_id}`);

    // 5. Create or update round in 'rounds' table
    // Schema: round_id, player_id, session_id, game_code, bet_req_id, result_req_id, bet_amount, result_amount, status, created_at, completed_at
    //
    // `round_id` is the PRIMARY KEY. If a bet for this round_id already exists, this insert will fail.
    // This is desired behavior: one active bet per round_id in the 'rounds' table.
    const insertRoundQuery = `
      INSERT INTO rounds (
        round_id, player_id, session_id, game_code, bet_req_id, bet_amount, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (round_id) DO NOTHING; 
      -- We can use ON CONFLICT DO NOTHING and check rows.affectedRows or query separately first.
      -- For simplicity and relying on the catch block for PK violation to indicate a duplicate round bet:
      -- Or, more explicitly:
      -- ON CONFLICT (round_id) DO UPDATE SET 
      --   bet_req_id = EXCLUDED.bet_req_id, 
      --   bet_amount = EXCLUDED.bet_amount,
      --   status = 'active', -- Reset if it was somehow different and we allow re-betting (not typical for this model)
      --   player_id = EXCLUDED.player_id, -- etc.
      -- WHERE rounds.status != 'completed'; -- Only if not completed. But this gets complex.
      -- Simplest: try to insert. If PK violation, it's a duplicate active bet for the round.
    `;
    
    const {rowCount: roundInsertCount} = await client.query(insertRoundQuery, [
        round_id, player_id, session_id, game_code, req_id, eventAmount.toFixed(2), 'active'
    ]);

    if (roundInsertCount === 0) {

        const { rows: existingRoundRows } = await client.query('SELECT status, bet_req_id FROM rounds WHERE round_id = $1', [round_id]);
        if (existingRoundRows.length > 0 && existingRoundRows[0].status === 'active' && existingRoundRows[0].bet_req_id !== req_id) {
            // A different active bet already exists for this round.
            await client.query('ROLLBACK');
            console.warn(`Bet rejected: Round ${round_id} already has an active bet. req_id: ${req_id}`);
            return res.status(400).json({ status: 'rejected', reason: `Round ${round_id} already has an active bet.` });
        } else if (existingRoundRows.length > 0 && existingRoundRows[0].status === 'completed') {
            await client.query('ROLLBACK');
            console.warn(`Bet rejected: Round ${round_id} is already completed. req_id: ${req_id}`);
            return res.status(400).json({ status: 'rejected', reason: `Round ${round_id} is already completed.` });
        }
    }



    // 6. If all successful, commit transaction
    await client.query('COMMIT');
    res.status(200).json({ status: 'success' });
    console.log(`Bet event ${req_id} processed successfully for player ${player_id}.`);


    } else if (type === 'result') {
    // 1. Fetch the corresponding active round and lock it
    // Ensure it's an active round for which a bet was placed and not already resulted.
    const roundQuery = `
      SELECT id AS internal_round_table_id, round_id, player_id, session_id, game_code, 
             bet_req_id, bet_amount, result_req_id, status 
      FROM rounds 
      WHERE round_id = $1 FOR UPDATE
    `;
    const { rows: roundRows } = await client.query(roundQuery, [round_id]);

    if (roundRows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`Result rejected: No round found for round_id ${round_id}. req_id: ${req_id}`);
      return res.status(400).json({ status: 'rejected', reason: `No betting round found for round_id: ${round_id}.` });
    }

    const round = roundRows[0];

    // 2. Validate the round
    if (round.status !== 'active') {
      await client.query('ROLLBACK');
      let reason = `Round ${round_id} is not active (current status: ${round.status}).`;
      if (round.status === 'completed') {
        reason = `Round ${round_id} has already been completed.`;
      }
      console.warn(`Result rejected: ${reason} req_id: ${req_id}`);
      return res.status(400).json({ status: 'rejected', reason: reason });
    }

    if (!round.bet_req_id) {
      // This should ideally not happen if status is 'active' after a bet, but good to check.
      await client.query('ROLLBACK');
      console.warn(`Result rejected: Round ${round_id} is active but has no associated bet request. req_id: ${req_id}`);
      return res.status(400).json({ status: 'rejected', reason: `No prior bet found for active round_id: ${round_id}.` });
    }

    if (round.result_req_id) {
      // A result has already been processed for this round.
      await client.query('ROLLBACK');
      console.warn(`Result rejected: Round ${round_id} already has a result processed (result_req_id: ${round.result_req_id}). req_id: ${req_id}`);
      return res.status(400).json({ status: 'rejected', reason: `Result already processed for round_id: ${round_id}.` });
    }
    
    // Player ID consistency check
    // The player_id in the result event should match the player_id who placed the bet for that round.
    if (round.player_id !== player_id) {
        await client.query('ROLLBACK');
        console.warn(`Result rejected: Player ID mismatch for round ${round_id}. Event Player ID: ${player_id}, Round Player ID: ${round.player_id}. req_id: ${req_id}`);
        return res.status(400).json({ status: 'rejected', reason: `Player ID in result event does not match player ID of the original bet for round ${round_id}.` });
    }

    // 3. Fetch player's wallet (using player_id from the validated round) and lock it
    const walletQuery = 'SELECT id, balance, currency FROM wallets WHERE player_id = $1 FOR UPDATE';
    const { rows: walletRows } = await client.query(walletQuery, [round.player_id]);

    if (walletRows.length === 0) {
      await client.query('ROLLBACK');
      console.error(`Result processing error: Wallet not found for player_id ${round.player_id} from round ${round_id}. req_id: ${req_id}`);
      return res.status(400).json({ status: 'rejected', reason: `Wallet not found for player associated with round ${round_id}. Critical error.` });
    }
    const wallet = walletRows[0];
    const currentBalance = new Decimal(wallet.balance);

    // 4. Add win amount (if any) and update wallet
    // The 'amount' in a 'result' event is the win amount.
    const newBalance = currentBalance.plus(eventAmount); // eventAmount is already a Decimal
    const updateWalletQuery = 'UPDATE wallets SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
    await client.query(updateWalletQuery, [newBalance.toFixed(2), wallet.id]);
    console.log(`Balance updated for wallet ${wallet.id} (player ${round.player_id}): ${currentBalance.toFixed(2)} + ${eventAmount.toFixed(2)} -> ${newBalance.toFixed(2)}`);

    // 5. Record the transaction in 'transactions' table
    // Schema: req_id, player_id, wallet_id, round_id, session_id, game_code, type, amount, currency, balance_before, balance_after, status
    //
    const insertTransactionQuery = `
      INSERT INTO transactions (
        req_id, player_id, wallet_id, round_id, session_id, game_code, 
        type, amount, currency, balance_before, balance_after, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    await client.query(insertTransactionQuery, [
      req_id, round.player_id, wallet.id, round.round_id, session_id,
      'result', eventAmount.toFixed(2), currency,
      currentBalance.toFixed(2), newBalance.toFixed(2), 'completed'
    ]);
    console.log(`Result transaction recorded: req_id ${req_id}`);

    // 6. Update round in 'rounds' table: set result details and status to 'completed'
    // Schema: result_req_id, result_amount, status, completed_at
    //
    const updateRoundQuery = `
      UPDATE rounds 
      SET result_req_id = $1, result_amount = $2, status = 'completed', completed_at = CURRENT_TIMESTAMP 
      WHERE round_id = $3 AND status = 'active' 
    `;
    const updateRoundResult = await client.query(updateRoundQuery, [
      req_id, eventAmount.toFixed(2), round.round_id
    ]);

    if (updateRoundResult.rowCount === 0) {
        await client.query('ROLLBACK');
        console.error(`Result processing critical error: Failed to update round ${round.round_id} to completed. req_id: ${req_id}`);
        return res.status(400).json({ status: 'rejected', reason: 'Failed to finalize round. Possible concurrency issue or inconsistent state.' });
    }
    console.log(`Round ${round.round_id} updated to completed. Result req_id: ${req_id}`);

    // 7. If all successful, commit transaction
    await client.query('COMMIT');
    res.status(200).json({ status: 'success' });
    console.log(`Result event ${req_id} processed successfully for player ${round.player_id}.`);


    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'rejected', reason: 'Unknown event type' });
    }

  } catch (dbError) {
    await client.query('ROLLBACK');
    console.error(`❌ Database error processing event req_id ${req_id}:`, dbError);
    if (dbError.code === '23505' && dbError.constraint === 'transactions_req_id_key') {
        return res.status(400).json({ status: 'rejected', reason: `Duplicate req_id: ${req_id}` });
    }
    return res.status(400).json({ status: 'rejected', reason: 'Event processing failed due to an internal error.' });

  } finally {
    client.release(); // Release the client back to the pool
  }
});


app.get('/players', async (req, res, next) => { 
  try {
    const query = `
      SELECT
        p.id AS player_id,
        p.name AS player_name,
        p.email AS player_email,
        w.id AS wallet_id,
        w.balance AS wallet_balance,
        w.currency AS wallet_currency,
        p.created_at AS player_created_at,
        w.updated_at AS wallet_updated_at
      FROM
        players p
      LEFT JOIN
        wallets w ON p.id = w.player_id
      ORDER BY
        p.name;
    `;

    const { rows } = await pool.query(query);
    res.status(200).json(rows); 

  } catch (error) {
    console.error('❌ Error fetching players:', error);
    next(error);
  }
});

app.get('/wallet/:player_id', async (req, res, next) => {
  const { player_id } = req.params; // Extract player_id from URL parameters

  if (!player_id) {
    return res.status(400).json({
      status: 'rejected',
      reason: 'player_id is required'
    });
  }

  try {
    const query = `
      SELECT
        id AS wallet_id,
        player_id,
        balance,
        currency,
        updated_at
      FROM
        wallets
      WHERE
        player_id = $1;
    `;

    const { rows } = await pool.query(query, [player_id]);

    if (rows.length === 0) {
      // If no wallet is found for the given player_id, return a 404.
      return res.status(404).json({
        status: 'rejected',
        reason: `Wallet not found for player_id: ${player_id}`
      });
    }

    res.status(200).json(rows[0]); // rows[0] contains the wallet object

  } catch (error) {
    console.error(`❌ Error fetching wallet for player_id ${player_id}:`, error);
    next(error);
  }
});


app.use((err, req, res, next
) => {
  console.error('Global error:', err);
  res.status(500).json({
    status: 'rejected',
    reason: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'rejected',
    reason: 'Endpoint not found'
  });
});

module.exports = app;