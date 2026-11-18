<div align="center">
  <img src="https://img.icons8.com/color/96/000000/database-restore.png" width="80" alt="DB Compare Logo"/>
  <h1>DB Compare</h1>
  <p><b>An enterprise-grade, zero-retention database schema and data migration utility.</b></p>
  
  [![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](#)
  [![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](#)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-005571?style=for-the-badge&logo=fastapi)](#)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12--17-316192?style=for-the-badge&logo=postgresql&logoColor=white)](#)
  [![Zero Retention](https://img.shields.io/badge/Security-Zero--Retention-green?style=for-the-badge&logo=shield)](#)
</div>

<br />


---


## 🌟 What is DB Compare?

**DB Compare** is a lightning-fast visual utility designed to compare two PostgreSQL databases (**Source** vs **Target**), pinpoint exact schema drifts (DDL) and data differences (DML), and generate safe synchronization scripts with automatic pre-migration target rollbacks.

### Key Highlights:

- **Zero-Retention Security**: Database credentials, connection strings, and SSH private `.pem` keys are streamed strictly into volatile RAM and are **never saved to disk or logged**.
- **10 Schema Object Types Supported**: Tables, Primary Keys, Secondary Indexes, Sequences, Standard Views, Materialized Views, Stored Procedures, Functions, Triggers, Roles, and Table Grants.
- **Row-Level Data Drift Detection**: Automatically identifies row count differences, missing rows (`INSERT`), extra rows (`DELETE`), and modified rows (`UPDATE`) with visual before/after row diffs.
- **Self-Healing DDL Ordering**: Automatically creates dependent sequences before tables, binds sequence ownership, avoids duplicate primary key index conflicts, and wraps secondary indexes with `IF NOT EXISTS`.
- **Target Rollback Backup Generation**: Generates an inverse rollback SQL script before applying changes to Production/UAT so you can revert anytime with zero data loss.
- **Cloud & Bastion Ready**: Works with Local PostgreSQL, AWS RDS/Aurora, Azure Database, Oracle Cloud, Supabase, and remote databases behind SSH Bastion Jump Hosts.

---


## 📋 Prerequisites Checklist

Before you begin, make sure your machine has the following tools installed:

| Tool                    | Minimum Version              | Check If Installed                                                                             | How to Install                                                                     |
| :---                    | :---                         | :---                                                                                           | :---                                                                               |
| **Python**              | `3.10` or higher             | `python3 --version`                                                                            | [python.org/downloads](https://www.python.org/downloads/) or `brew install python` |
| **Node.js**             | `18.0.0` or higher           | `node -v`                                                                                      | [nodejs.org](https://nodejs.org/) or `brew install node`                           |
| **npm**                 | `9.0.0` or higher            | `npm -v`                                                                                       | Installed automatically with Node.js                                               |
| **Git**                 | Any modern version           | `git --version`                                                                                | [git-scm.com](https://git-scm.com/)                                                |

---


## 🚀 Step-by-Step Installation & Setup

  Follow these exact steps to get DB Compare running on your computer in under 3 minutes.

### Step 1: Open Your Terminal & Navigate to Project

Open your favorite terminal (Terminal on macOS/Linux, or PowerShell / Command Prompt on Windows) and clone or navigate to the repository:

```bash
cd /path/to/namangyadb_doodle
```

Ensure you are on the `sdpl` branch:

```bash
git checkout sdpl
```

---


### Step 2: Set Up the Backend (Python FastAPI)


The backend handles database inspection, schema diffing, and SSH tunneling.

#### 1. Navigate into the `backend` folder:

```bash
cd backend
```

#### 2. Create a virtual environment:

- **macOS / Linux:**
  ```bash
  python3 -m venv venv
  ```
- **Windows:**
  ```bash
  python -m venv venv
  ```

#### 3. Activate the virtual environment:

- **macOS / Linux:**
  ```bash
  source venv/bin/activate
  ```
- **Windows (PowerShell):**
  ```powershell
  .\venv\Scripts\Activate.ps1
  ```
- **Windows (Command Prompt):**
  ```cmd
  venv\Scripts\activate.bat
  ```
  _(You will see `(venv)` appear at the start of your terminal prompt)._

#### 4. Install backend dependencies:

```bash
pip install -r requirements.txt
```



### Step 3: Set Up the Frontend (React + Vite + Tailwind)

Open a **new, separate terminal window** (keep the first terminal open for the backend).

#### 1. Navigate into the `frontend` folder:

```bash
cd /path/to/namangyadb_doodle/frontend
```

#### 2. Install frontend dependencies:

```bash
npm install
```


## 🏃 Starting the Application

You will run the backend and frontend in two separate terminals.

### Terminal 1: Start the Backend API

Inside `namangyadb_doodle/backend` with `(venv)` activated:

```bash
python main.py
```

**Expected output:**

```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

> The API server is now running live at `http://localhost:8000`.

---

### Terminal 2: Start the Frontend UI

Inside `namangyadb_doodle/frontend`:

```bash
npm run dev
```

**Expected output:**

```
  VITE v8.2.0  ready in 150 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

---

### Step 4: Open in Your Browser!

Click the link or open your browser and visit:
👉 **[http://localhost:5173](http://localhost:5173)**

You should now see the dark-themed **DB Compare** dashboard ready for your connections! 🎉

---

## 📖 How to Use DB Compare (Step-by-Step)

### 1. Configure Source & Target Databases

- **Source**: The benchmark database containing the desired schema and data (e.g. UAT or Staging).
- **Target**: The database to be compared and synchronized (e.g. Production or Local).

For each database card:

1. **Choose Cloud Provider**: Select `Local PostgreSQL`, `AWS (RDS/Aurora)`, `Azure Database`, `Oracle Cloud`, or `Supabase`.
2. **Choose Connection Method**:
   - **Direct**: Connect directly via Host and Port.
   - **Via SSH Tunnel**: Connect securely through an SSH Bastion / Jump Host.

### 2. If Connecting via SSH Bastion Tunnel (.pem key)

1. Enter your **SSH Host** (e.g. `bastion.corp.internal` or EC2 public DNS).
2. Enter the **SSH Port** (default is `22`, supports custom ports like `2222`).
3. Enter the **SSH User** (e.g. `ec2-user`, `ubuntu`, `admin`).
4. Click the dashed **Identity File** box and select your private key file (`.pem`, `.key`, `id_rsa`, or `id_ed25519`).
   - _Security Guarantee_: The private key is parsed strictly in-memory and is **never written to disk or sent to external servers**.
5. Click **Test SSH Bastion Only** to verify the tunnel handshake before touching PostgreSQL.

### 3. Test Connections

- Click **Test DB Connection** on either card to verify authentication and PostgreSQL access.
- Or click **Test Both Connections** in the top header.
- Any connection failure displays a clear, sanitized error message on the card (e.g. invalid password, timeout, or unreachable host).

### 4. Run Pre-Flight Inspection

- Click **Compare Databases** (or `Play` icon).
- DB Compare inspects both databases and displays:
  - Total object count across all categories.
  - Common tables eligible for row data diffing.
  - Estimated time of completion (ETA).
- Select the objects and tables you wish to include, then click **Run Comparison**.

### 5. Review Drift & Sync

- **Interactive Drilldowns**: Expand any category (**Tables**, **Views**, **Procedures**, **Sequences**, **Data Drift**) to see exact field-by-field differences.
- **Per-Object Copy**: Every single difference card has an individual **Copy Script** button to copy only that specific fix.
- **Refresh Button**: Run a change on your database, click **Refresh Comparison**, and see the diff update in real time without leaving the page.
- **Generate Full Sync Script**:
  - Toggle **Safe Mode** (comments out destructive `DROP` and `DELETE` statements by default).
  - Check **Pre-Migration Rollback Script** to download a complete backup of Target's original state before migrating.
  - Click **Copy SQL** or **Download Script (.sql)** to execute in DBeaver, pgAdmin, or psql.

---

## 🛑 How to Stop the Application

To shut down the servers cleanly:

1. Go to **Terminal 1** (Backend): Press `CTRL + C`
2. Go to **Terminal 2** (Frontend): Press `CTRL + C`

---

## ❓ Troubleshooting & FAQs

### Q1: `ModuleNotFoundError: No module named 'fastapi'` or similar

> **Fix**: You didn't activate the virtual environment before running the backend. Run:
>
> ```bash
> cd backend
> source venv/bin/activate    # (or .\venv\Scripts\Activate.ps1 on Windows)
> pip install -r requirements.txt
> python main.py
> ```

### Q2: `connection to server at "localhost" (127.0.0.1), port 5432 failed: Connection refused`

> **Fix**: Your local PostgreSQL service is not running. Start it with:
>
> - macOS: `brew services start postgresql@16` (or open Postgres.app)
> - Linux: `sudo systemctl start postgresql`
> - Windows: Open `services.msc` and start `postgresql-x64` service.

### Q3: `SSH Tunnel Handshake Failed: Invalid SSH private key`

> **Fix**:
>
> - Ensure your key is in standard PEM or OpenSSH format (starts with `-----BEGIN RSA PRIVATE KEY-----` or `-----BEGIN OPENSSH PRIVATE KEY-----`).
> - If your key has a passphrase, export an unencrypted copy for testing or remove the passphrase (`ssh-keygen -p -P "oldpass" -N "" -f mykey.pem`).

### Q4: `Port 8000 or 5173 is already in use`

> **Fix**: Another instance is running in the background. Kill it with:
>
> - macOS / Linux:
>   ```bash
>   lsof -ti :8000 | xargs kill -9
>   lsof -ti :5173 | xargs kill -9
>   ```
> - Windows:
>   ```powershell
>   Stop-Process -Id (Get-NetTCPConnection -LocalPort 8000).OwningProcess -Force
>   Stop-Process -Id (Get-NetTCPConnection -LocalPort 5173).OwningProcess -Force
>   ```

### Q5: `relation "xyz_seq" does not exist` or `relation "xyz_pkey" already exists`

> **Fix**: DB Compare already includes built-in dependency resolution! It automatically detects sequences in `nextval()` defaults, creates them first with `IF NOT EXISTS`, binds ownership with `ALTER SEQUENCE ... OWNED BY`, and excludes primary key duplicate index declarations.

---

## 📂 Project Architecture

```
namangyadb_doodle/
├── backend/
│   ├── main.py              # FastAPI server, endpoints, in-memory SSH tunnel manager
│   ├── db_inspector.py      # PostgreSQL catalog inspection (pg_class, pg_proc, pg_views, etc.)
│   ├── differ.py            # Deep schema delta calculation engine
│   ├── data_inspector.py    # Row-level data hashing and sampling comparison
│   ├── sync_generator.py    # Transactional DDL/DML migration & rollback SQL generator
│   └── requirements.txt     # Python backend dependencies
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main React comparison dashboard & connection manager
│   │   ├── main.tsx         # React application entry point
│   │   └── index.css        # Tailwind styling & dark theme tokens
│   ├── package.json         # Frontend dependencies & scripts
│   └── vite.config.ts       # Vite bundler configuration
└── README.md                # Comprehensive documentation
```

---

<div align="center">
  <sub>Built with ❤️ for Database Administrators, DevOps, and Full-Stack Engineers.</sub>
</div>
