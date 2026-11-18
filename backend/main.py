from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Tuple
import psycopg2
import paramiko
# Compatibility shim: paramiko 3.x+ in Python 3.14 removed DSSKey (DSA), which causes sshtunnel to crash in get_keys()
if not hasattr(paramiko, 'DSSKey'):
    paramiko.DSSKey = paramiko.RSAKey

from sshtunnel import SSHTunnelForwarder
import io
import os
import re

from db_inspector import get_object_counts, get_schema_snapshot
from differ import compute_delta
from data_inspector import compare_all_data
from sync_generator import generate_sync_script, generate_rollback_script

app = FastAPI(
    title="DB Compare API",
    description="Enterprise-grade zero-retention database schema and data migration engine.",
    version="2.0.0"
)

# Enterprise CORS Configuration
allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()] if allowed_origins_env else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def sanitize_error(err: Exception) -> str:
    """Sanitizes database and SSH exception strings to prevent credential or key leakage."""
    msg = str(err)
    msg = re.sub(r'password=\S+', 'password=***', msg, flags=re.IGNORECASE)
    msg = re.sub(r'password\s*:\s*\S+', 'password: ***', msg, flags=re.IGNORECASE)
    msg = re.sub(r'-----BEGIN[^-]+PRIVATE KEY-----[^-]+-----END[^-]+PRIVATE KEY-----', '[REDACTED PRIVATE KEY]', msg, flags=re.DOTALL)
    return msg

def load_ssh_key(key_str: str) -> Any:
    """
    Loads an SSH private key in-memory directly as a paramiko.PKey without writing to disk.
    Supports RSA, OpenSSH (Ed25519), and ECDSA key formats in pure volatile memory.
    """
    cleaned = key_str.replace('\r\n', '\n').strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="SSH private key is empty.")
    
    key_classes = [paramiko.RSAKey]
    if hasattr(paramiko, 'Ed25519Key'):
        key_classes.append(paramiko.Ed25519Key)
    if hasattr(paramiko, 'ECDSAKey'):
        key_classes.append(paramiko.ECDSAKey)

    for k_cls in key_classes:
        try:
            pkey = k_cls.from_private_key(io.StringIO(cleaned))
            return pkey
        except paramiko.ssh_exception.PasswordRequiredException:
            raise HTTPException(
                status_code=400,
                detail="The provided SSH key is encrypted with a passphrase. Please use an unencrypted private key or remove the passphrase."
            )
        except Exception:
            continue
            
    raise HTTPException(
        status_code=400,
        detail="Invalid SSH private key. Expected a valid PEM/OpenSSH format (e.g. BEGIN RSA / OPENSSH / EC PRIVATE KEY)."
    )

class ConnectionRequest(BaseModel):
    type: str # 'local', 'ssh', 'aws', 'azure', 'oracle', 'supabase', 'other'
    host: str = Field(..., max_length=255)
    port: str = Field(..., max_length=10)
    dbName: str = Field(..., max_length=128)
    user: str = Field(..., max_length=128)
    pass_: str = Field(..., max_length=512)
    sshHost: Optional[str] = Field(None, max_length=255)
    sshPort: Optional[str] = Field("22", max_length=10)
    sshUser: Optional[str] = Field(None, max_length=128)
    sshKey: Optional[str] = None # PEM content in memory only
    testMode: Optional[str] = 'full' # 'full' or 'ssh_only'

class PreFlightRequest(BaseModel):
    source: ConnectionRequest
    target: ConnectionRequest

class CompareRequest(BaseModel):
    source: ConnectionRequest
    target: ConnectionRequest
    scope: Dict[str, bool]

class DataCompareRequest(BaseModel):
    source: ConnectionRequest
    target: ConnectionRequest
    tables: Optional[List[str]] = None
    max_sample_rows: Optional[int] = 50

class SyncScriptRequest(BaseModel):
    source_snap: Optional[Dict[str, Any]] = None
    target_snap: Optional[Dict[str, Any]] = None
    diffs: Optional[List[Dict[str, Any]]] = None
    data_diff: Optional[Dict[str, Any]] = None
    safe_mode: Optional[bool] = True
    include_ddl: Optional[bool] = True
    include_data: Optional[bool] = True

def establish_connection(req: ConnectionRequest):
    """
    Establishes an enterprise database connection and optional ephemeral SSH tunnel.
    SSH keys are stored in volatile memory only and never persisted to disk.
    If database connection fails, the SSH tunnel is immediately torn down to prevent leaks.
    """
    tunnel = None
    db_host = req.host.strip()
    db_port = int(req.port.strip())
    
    if req.sshHost and req.sshUser and req.sshKey:
        ssh_host = req.sshHost.strip()
        ssh_port = 22
        if req.sshPort:
            try:
                ssh_port = int(req.sshPort.strip())
            except ValueError:
                ssh_port = 22
        elif ':' in ssh_host:
            parts = ssh_host.split(':', 1)
            ssh_host = parts[0].strip()
            try:
                ssh_port = int(parts[1].strip())
            except ValueError:
                ssh_port = 22

        pkey = load_ssh_key(req.sshKey)
        try:
            tunnel = SSHTunnelForwarder(
                (ssh_host, ssh_port),
                ssh_username=req.sshUser.strip(),
                ssh_pkey=pkey,
                ssh_config_file=None,
                allow_agent=False,
                host_pkey_directories=[],
                remote_bind_address=(req.host.strip(), int(req.port.strip())),
                set_keepalive=10.0
            )
            tunnel.start()
            db_host = '127.0.0.1'
            db_port = tunnel.local_bind_port
        except HTTPException:
            raise
        except Exception as e:
            if tunnel:
                try: tunnel.stop()
                except Exception: pass
            raise HTTPException(
                status_code=400, 
                detail=f"SSH Tunnel Handshake Failed ({ssh_host}:{ssh_port}): {sanitize_error(e)}"
            )
            
    if req.testMode == 'ssh_only':
        return None, tunnel

    try:
        conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            dbname=req.dbName.strip(),
            user=req.user.strip(),
            password=req.pass_,
            connect_timeout=15,
            sslmode='prefer'
        )
        return conn, tunnel
    except Exception as e:
        if tunnel:
            try: tunnel.stop()
            except Exception: pass
        raise HTTPException(
            status_code=400, 
            detail=f"Database Connection Failed ({req.host}:{req.port}/{req.dbName}): {sanitize_error(e)}"
        )

@app.post("/api/test-connection")
async def test_connection(req: ConnectionRequest):
    conn = None
    tunnel = None
    try:
        conn, tunnel = establish_connection(req)
        if req.testMode == 'ssh_only':
            return {"status": "success", "message": "SSH Tunnel established successfully"}
            
        cur = conn.cursor()
        cur.execute("SELECT 1;")
        cur.fetchone()
        cur.close()
        return {"status": "success", "message": "Database connection verified successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=sanitize_error(e))
    finally:
        if conn:
            try: conn.close()
            except Exception: pass
        if tunnel:
            try: tunnel.stop()
            except Exception: pass

@app.post("/api/compare/pre-flight")
async def pre_flight_counts(req: PreFlightRequest):
    source_conn, source_tunnel = None, None
    target_conn, target_tunnel = None, None
    
    try:
        source_conn, source_tunnel = establish_connection(req.source)
        target_conn, target_tunnel = establish_connection(req.target)
        
        source_counts = get_object_counts(source_conn)
        target_counts = get_object_counts(target_conn)
        
        # Calculate common tables
        source_tables = set(source_counts.get('table_names', []))
        target_tables = set(target_counts.get('table_names', []))
        common_tables = sorted(list(source_tables & target_tables))
        
        # Total objects for ETA
        numeric_keys = [
            'tables', 'views', 'materialized_views', 'functions', 
            'procedures', 'sequences', 'triggers', 'roles', 'grants'
        ]
        total_objects = sum(source_counts.get(k, 0) for k in numeric_keys) + sum(target_counts.get(k, 0) for k in numeric_keys)
        
        eta_seconds = max(1, int((total_objects * 0.05))) 
        
        return {
            "status": "success",
            "source_counts": source_counts,
            "target_counts": target_counts,
            "common_tables": common_tables,
            "eta_seconds": eta_seconds,
            "total_objects": total_objects
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=sanitize_error(e))
    finally:
        if source_conn:
            try: source_conn.close()
            except Exception: pass
        if source_tunnel:
            try: source_tunnel.stop()
            except Exception: pass
        if target_conn:
            try: target_conn.close()
            except Exception: pass
        if target_tunnel:
            try: target_tunnel.stop()
            except Exception: pass

@app.post("/api/compare/ddl")
async def compare_ddl(req: CompareRequest):
    source_conn, source_tunnel = None, None
    target_conn, target_tunnel = None, None
    
    try:
        source_conn, source_tunnel = establish_connection(req.source)
        target_conn, target_tunnel = establish_connection(req.target)
        
        source_snap = get_schema_snapshot(source_conn, req.scope)
        target_snap = get_schema_snapshot(target_conn, req.scope)
        
        diffs = compute_delta(source_snap, target_snap)
        
        return {
            "status": "success",
            "diffs": diffs,
            "source_snap": source_snap,
            "target_snap": target_snap
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=sanitize_error(e))
    finally:
        if source_conn:
            try: source_conn.close()
            except Exception: pass
        if source_tunnel:
            try: source_tunnel.stop()
            except Exception: pass
        if target_conn:
            try: target_conn.close()
            except Exception: pass
        if target_tunnel:
            try: target_tunnel.stop()
            except Exception: pass

@app.post("/api/compare/data")
async def compare_data_endpoint(req: DataCompareRequest):
    source_conn, source_tunnel = None, None
    target_conn, target_tunnel = None, None
    
    try:
        source_conn, source_tunnel = establish_connection(req.source)
        target_conn, target_tunnel = establish_connection(req.target)
        
        tables_to_compare = req.tables
        if not tables_to_compare:
            s_counts = get_object_counts(source_conn)
            t_counts = get_object_counts(target_conn)
            s_set = set(s_counts.get('table_names', []))
            t_set = set(t_counts.get('table_names', []))
            tables_to_compare = sorted(list(s_set & t_set))
            
        data_diff = compare_all_data(
            source_conn, 
            target_conn, 
            tables_to_compare, 
            max_sample_rows=req.max_sample_rows or 50
        )
        
        return {
            "status": "success",
            "data_diff": data_diff
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=sanitize_error(e))
    finally:
        if source_conn:
            try: source_conn.close()
            except Exception: pass
        if source_tunnel:
            try: source_tunnel.stop()
            except Exception: pass
        if target_conn:
            try: target_conn.close()
            except Exception: pass
        if target_tunnel:
            try: target_tunnel.stop()
            except Exception: pass

@app.post("/api/generate-sync-script")
async def generate_sync_script_endpoint(req: SyncScriptRequest):
    try:
        result = generate_sync_script(
            source_snap=req.source_snap,
            target_snap=req.target_snap,
            diffs=req.diffs,
            data_diff=req.data_diff,
            safe_mode=req.safe_mode if req.safe_mode is not None else True,
            include_ddl=req.include_ddl if req.include_ddl is not None else True,
            include_data=req.include_data if req.include_data is not None else True
        )
        return {
            "status": "success",
            "sql": result["sql"],
            "stats": result["stats"]
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=sanitize_error(e))

@app.post("/api/generate-rollback-script")
async def generate_rollback_script_endpoint(req: SyncScriptRequest):
    try:
        result = generate_rollback_script(
            source_snap=req.source_snap,
            target_snap=req.target_snap,
            diffs=req.diffs,
            data_diff=req.data_diff,
            safe_mode=req.safe_mode if req.safe_mode is not None else True,
            include_ddl=req.include_ddl if req.include_ddl is not None else True,
            include_data=req.include_data if req.include_data is not None else True
        )
        return {
            "status": "success",
            "sql": result["sql"],
            "stats": result["stats"]
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=sanitize_error(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
