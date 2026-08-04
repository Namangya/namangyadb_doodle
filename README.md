# Database DDL and Data Comparison Tool

A comprehensive web-based platform for comparing database schemas (DDL) and data across different environments (e.g., AWS Aurora Postgres, Local, Azure, Supabase).

## Overview

This tool solves the challenge of keeping databases in sync across different deployment environments by providing an easy-to-use interface to compare:
- **Structural Differences (DDL):** Tables, Procedures, Functions, Sequences, Views, etc.
- **Data Differences:** Direct comparison of table records using Primary/Unique keys, with support for mapping common columns.

## Key Features (Planned)

- **SSH Tunneling Support:** Securely connect to cloud databases (like AWS Aurora) using `.pem` files without exposing them publicly.
- **Granular DDL Diff:** See exactly what columns, types, or objects have been added, removed, or modified.
- **Smart Data Comparison:** Select specific columns to compare, utilizing hashing and smart diffing to handle large datasets efficiently.
- **Multi-Cloud Compatible:** Initially targeting PostgreSQL across various providers.

## Tech Stack (Proposed)

- **Backend:** Python (FastAPI)
- **Database Connectivity:** `psycopg2` / `asyncpg` + `sshtunnel`
- **Data Processing:** `pandas` / SQL-based MD5 hashing
- **Frontend:** Next.js (React) or Streamlit (depending on final architecture decisions)

## Roadmap & Progress

- [x] Initial Architecture Planning
- [ ] Phase 1: Core Connectivity (SSH & Direct) setup
- [ ] Phase 2: DDL Comparison Engine
- [ ] Phase 3: Data Comparison Engine
- [ ] Phase 4: Frontend Development
- [ ] Phase 5: Testing & Polish

---
*This README will be continuously updated as development progresses.*
