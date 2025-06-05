-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(50) PRIMARY KEY,
    player_id VARCHAR(50) REFERENCES players(id) ON DELETE CASCADE,
    balance DECIMAL(15,2) DEFAULT 0.00 CHECK (balance >= 0),
    currency VARCHAR(3) DEFAULT 'INR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_player_wallet UNIQUE(player_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallets_player_id ON wallets(player_id);
CREATE INDEX IF NOT EXISTS idx_wallets_balance ON wallets(balance);

-- Update trigger
CREATE TRIGGER update_wallets_updated_at 
    BEFORE UPDATE ON wallets 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();