<div align="center">
  <img src="https://img.icons8.com/color/96/000000/database-restore.png" width="80" alt="DB Compare Logo"/>
  <h1>DB Compare</h1>
  <p><b>An enterprise-grade, zero-retention database schema and data migration utility.</b></p>
  
  [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](#)
  [![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](#)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](#)
  [![Zero Retention](https://img.shields.io/badge/Security-Zero--Retention-green?style=for-the-badge&logo=shield)](#)
</div>

<br />

## 🌟 Overview

DB Compare is a production-ready utility designed to identify Data Definition Language (DDL) drift and row-level data inconsistencies between any two database environments (**Source** vs **Target**).

Built for security-conscious organizations, DB Compare operates completely in-memory with a strict **Zero-Retention Policy**. No credentials, SSH private keys, schemas, or row data are ever persisted to disk.

---

## ✨ Supported DDL Schema Objects

DB Compare provides comprehensive inspection, delta diffing, and migration script generation across all major PostgreSQL schema objects:

| Object Type             | Description                  | Granular Inspection Attributes                                                                 |
| ----------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **Tables**              | Relational tables            | Column definitions, data types, nullability, defaults, primary keys                            |
| **Indexes**             | Secondary indexes            | Unique constraints, index expressions, multi-column definitions                                |
| **Views**               | Standard SQL views           | Complete view query definitions, dependency order                                              |
| **Materialized Views**  | Cached query results         | Separate from standard views; definitions and refresh settings                                 |
| **Stored Procedures**   | Procedural routines          | Distinguished from functions via PostgreSQL `prokind = 'p'`                                    |
| **Functions**           | Scalar and trigger functions | Signature parameters, return types, routine body definitions (`prokind = 'f'`)                 |
| **Sequences**           | Auto-increment generators    | Existence, names, and state tracking                                                           |
| **Triggers**            | Event triggers               | Associated tables, events (BEFORE/AFTER), firing conditions                                    |
| **Roles & Users**       | Database roles and accounts  | Login capability, superuser, inherit, create role, create DB, connection limits                |
| **Grants & Privileges** | Access control permissions   | Table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) |

---

## 🔒 Enterprise Security & Architecture

- **Strict Zero-Retention**: All connection configurations, credentials, and uploaded SSH `.pem` identity keys are held exclusively in RAM and discarded immediately after use.
- **Credential Sanitization**: Backend error handlers intercept exceptions and strip database passwords and connection strings before returning responses to clients.
- **Configurable CORS**: Supports environment-configurable origin whitelisting (`ALLOWED_ORIGINS`) to prevent unauthorized cross-origin requests.
- **Safe Mode Migrations**: Generated synchronization scripts comment out destructive operations (`DROP COLUMN`, `DROP TABLE`, `DROP ROLE`, `DELETE`) by default with explicit review markers.
- **Transactional Execution**: All generated sync scripts are wrapped in atomic transaction blocks (`BEGIN; ... COMMIT;`).

---

## 🛠 Quickstart Guide

### 1. Start the Backend API

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

Backend runs at `http://127.0.0.1:8000`.

### 2. Start the Frontend UI

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://127.0.0.1:5173`.

### 3. Production Build

```bash
cd frontend
npm run build
```

---

<div align="center">
  <i>Engineered for Enterprise Database Reliability & Security</i>
</div>
