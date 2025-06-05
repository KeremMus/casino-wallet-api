-- Rounds tracking table (to ensure bet-result matching)
CREATE TABLE IF NOT EXISTS rounds (
    round_id VARCHAR(100) PRIMARY KEY,
    player_id VARCHAR(50) REFERENCES players(id),
    session_id VARCHAR(100),
    game_code VARCHAR(100),
    bet_req_id VARCHAR(100) REFERENCES transactions(req_id),
    result_req_id VARCHAR(100) REFERENCES transactions(req_id),
    bet_amount DECIMAL(15,2),
    result_amount DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- active, completed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rounds_player_id ON rounds(player_id);
CREATE INDEX IF NOT EXISTS idx_rounds_session_id ON rounds(session_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);