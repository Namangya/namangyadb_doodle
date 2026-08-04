-- Source Database Schema (The "Correct" or "New" Schema)

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    last_login_at TIMESTAMP -- New column in source
);

CREATE INDEX idx_users_email ON users(email); -- New index in source

INSERT INTO users (id, username, email, status) VALUES 
(1042, 'alice', 'alice@example.com', 'active'),
(1055, 'bob', 'bob@example.com', 'active'),
(1060, 'charlie', 'charlie@example.com', 'pending');
