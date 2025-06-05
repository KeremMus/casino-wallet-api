-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    req_id VARCHAR(100) UNIQUE NOT NULL,
    player_id VARCHAR(50) REFERENCES players(id),
    wallet_id VARCHAR(50) REFERENCES wallets(id),
    round_id VARCHAR(100),
    session_id VARCHAR(100),
    game_code VARCHAR(100),
    type VARCHAR(10) CHECK (type IN ('bet', 'result')),
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    status VARCHAR(20) DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_req_id ON transactions(req_id);
CREATE INDEX IF NOT EXISTS idx_transactions_round_id ON transactions(round_id);
CREATE INDEX IF NOT EXISTS idx_transactions_player_id ON transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_transactions_session_id ON transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);