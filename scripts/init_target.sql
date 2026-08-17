-- Target Database Schema (The "Old" or "Outdated" Schema)

-- 1. Sequences
-- Missing order_id_seq

-- 2. Tables
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    last_login VARCHAR(50), -- Old column, wrong type
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Missing orders table

-- 3. Indexes
-- Missing email index on users

-- 4. Views
-- Outdated view without email
CREATE OR REPLACE VIEW active_users_view AS
SELECT id, username 
FROM users 
WHERE status = 'active';

-- 5. Functions
-- Missing get_user_status function

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Triggers
CREATE TRIGGER users_updated_at_trigger
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 7. Sample Data
INSERT INTO users (id, username, email, status, last_login) VALUES 
(1042, 'alice', 'alice@example.com', 'active', '2023-10-01'),
(1055, 'bob', 'bob@example.com', 'active', '2023-10-02'),
(1060, 'charlie', 'charlie@example.com', 'pending', '2023-10-03');
