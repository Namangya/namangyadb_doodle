<div align="center">
  <img src="https://img.icons8.com/color/96/000000/database-restore.png" width="80" alt="NamangyaDB Logo"/>
  <h1>NamangyaDB Compare</h1>
  <p><b>A modern, zero-retention database schema and data migration utility.</b></p>
  
  [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](#)
  [![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](#)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](#)
</div>

<br />

## 🌟 Overview

NamangyaDB Compare is an enterprise-grade utility designed to effortlessly identify Data Definition Language (DDL) drift and data inconsistencies between any two database environments (Source vs Target).

Built for security-conscious organizations, NamangyaDB operates completely in-memory utilizing a strict **Zero-Retention Policy**. No credentials, identity files, or schemas are ever written to disk.

## ✨ Key Features

- **Multi-Cloud Support**: Natively connects to AWS RDS, Azure Database, Oracle Cloud, Supabase, and local infrastructure.
- **Direct & Secure SSH Tunnels**: Built-in support for secure bastion hosts via `.pem` identity files.
- **Structured Diffing**: Highlights exact missing columns, indexes, and type mismatches.
- **Zero-Retention Security**: Absolute guarantee that no sensitive connection data is persisted. 

## 🏗 Architecture

The platform is decoupled into a lightning-fast React frontend and a highly concurrent Python backend:

- **Frontend**: React (Vite) + Tailwind CSS (Orangish/Dark Theme)
- **Backend**: Python FastAPI + `psycopg2` + `sshtunnel`

## 🚀 Progress & Roadmap

We are developing NamangyaDB iteratively. Current progress:

- [x] **Phase 1: Basic UI Shell & Configuration**
  - Modern, responsive React interface.
  - Legal, About, and robust Validation features built-in.
- [x] **Phase 2: Core Connectivity & Privacy Engine**
  - FastAPI backend configured with `sshtunnel`.
  - Zero-retention memory management for `.pem` files.
- [ ] **Phase 3: DDL Comparison Engine** *(Up Next)*
  - Extract structural metadata (Tables, Columns, Indexes).
  - Compute exact delta algorithms.
- [ ] **Phase 4: Data Comparison Engine**
  - Row-level analysis and MD5 hashing for large tables.
- [ ] **Phase 5: Sync Script Generation**
  - Auto-generate `ALTER` / `CREATE` SQL statements.

---

<div align="center">
  <i>Engineered for the Modern Cloud Architecture</i>
</div>
