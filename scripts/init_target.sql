-- Target Database Schema (The "Old" or "Outdated" Schema)

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- Note: defaults differ, data might differ
    last_login VARCHAR(100) -- Old column in target
);

-- Missing the idx_users_email index

INSERT INTO users (id, username, email, status) VALUES 
(1042, 'alice', 'alice@example.com', 'pending'), -- Status drift
(1060, 'charlie', 'charlie@example.com', 'pending');
-- Missing bob (id 1055)
