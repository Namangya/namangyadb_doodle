-- Source Database Schema (The "Correct" or "New" Schema)

-- 1. Sequences
CREATE SEQUENCE order_id_seq START 1000;

-- 2. Tables
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    last_login_at TIMESTAMP, -- New column in source
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id INT PRIMARY KEY DEFAULT nextval('order_id_seq'),
    user_id INT REFERENCES users(id),
    amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX idx_users_email ON users(email); -- New index in source
CREATE INDEX idx_orders_user ON orders(user_id);

-- 4. Views
CREATE OR REPLACE VIEW active_users_view AS
SELECT id, username, email 
FROM users 
WHERE status = 'active';

-- 5. Functions
CREATE OR REPLACE FUNCTION get_user_status(user_id INT)
RETURNS VARCHAR AS $$
DECLARE
    u_status VARCHAR;
BEGIN
    SELECT status INTO u_status FROM users WHERE id = user_id;
    RETURN u_status;
END;
$$ LANGUAGE plpgsql;

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
INSERT INTO users (id, username, email, status) VALUES 
(1042, 'alice', 'alice@example.com', 'active'),
(1055, 'bob', 'bob@example.com', 'active'),
(1060, 'charlie', 'charlie@example.com', 'pending');

INSERT INTO orders (user_id, amount) VALUES 
(1042, 150.00),
(1042, 250.50),
(1055, 99.99);
