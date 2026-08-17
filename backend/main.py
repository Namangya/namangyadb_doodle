from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import psycopg2
from sshtunnel import SSHTunnelForwarder
import tempfile
import os

from db_inspector import get_object_counts, get_schema_snapshot
from differ import compute_delta

app = FastAPI(title="NamangyaDB Compare API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For dev, allow all. Should be restricted in prod.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionRequest(BaseModel):
    type: str # 'local', 'ssh', 'aws', 'azure', 'oracle', 'supabase', 'other'
    host: str
    port: str
    dbName: str
    user: str
    pass_: str
    sshHost: Optional[str] = None
    sshUser: Optional[str] = None
    sshKey: Optional[str] = None # PEM content
    testMode: Optional[str] = 'full' # 'full' or 'ssh_only'

class PreFlightRequest(BaseModel):
    source: ConnectionRequest
    target: ConnectionRequest

class CompareRequest(BaseModel):
    source: ConnectionRequest
    target: ConnectionRequest
    scope: dict

def establish_connection(req: ConnectionRequest):
    """Helper to establish a database connection and an optional SSH tunnel."""
    tunnel = None
    db_host = req.host
    db_port = int(req.port)
    
    if req.sshHost and req.sshUser and req.sshKey:
        fd, path = tempfile.mkstemp()
        try:
            with os.fdopen(fd, 'w') as tmp:
                tmp.write(req.sshKey)
            
            tunnel = SSHTunnelForwarder(
                (req.sshHost, 22),
                ssh_username=req.sshUser,
                ssh_pkey=path,
                remote_bind_address=(req.host, int(req.port))
            )
            tunnel.start()
            db_host = '127.0.0.1'
            db_port = tunnel.local_bind_port
        finally:
            os.remove(path)
            
    if req.testMode == 'ssh_only':
        return None, tunnel

    conn = psycopg2.connect(
        host=db_host,
        port=db_port,
        dbname=req.dbName,
        user=req.user,
        password=req.pass_
    )
    return conn, tunnel

@app.post("/api/test-connection")
async def test_connection(req: ConnectionRequest):
    conn = None
    tunnel = None
    try:
        conn, tunnel = establish_connection(req)
        if req.testMode == 'ssh_only':
            return {"status": "success", "message": "SSH Tunnel tested successfully"}
            
        cur = conn.cursor()
        cur.execute("SELECT 1;")
        cur.fetchone()
        cur.close()
        return {"status": "success", "message": "Connection tested successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if conn: conn.close()
        if tunnel: tunnel.stop()

@app.post("/api/compare/pre-flight")
async def pre_flight_counts(req: PreFlightRequest):
    source_conn, source_tunnel = None, None
    target_conn, target_tunnel = None, None
    
    try:
        source_conn, source_tunnel = establish_connection(req.source)
        target_conn, target_tunnel = establish_connection(req.target)
        
        source_counts = get_object_counts(source_conn)
        target_counts = get_object_counts(target_conn)
        
        # Calculate approximate ETA based on total objects (super simple heuristic)
        total_objects = sum(source_counts.values()) + sum(target_counts.values())
        
        # Assume ~50ms per object to extract and diff (very conservative)
        # We cap it at 1 second minimum
        eta_seconds = max(1, int((total_objects * 0.05))) 
        
        return {
            "status": "success",
            "source_counts": source_counts,
            "target_counts": target_counts,
            "eta_seconds": eta_seconds,
            "total_objects": total_objects
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if source_conn: source_conn.close()
        if source_tunnel: source_tunnel.stop()
        if target_conn: target_conn.close()
        if target_tunnel: target_tunnel.stop()

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
            "diffs": diffs
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if source_conn: source_conn.close()
        if source_tunnel: source_tunnel.stop()
        if target_conn: target_conn.close()
        if target_tunnel: target_tunnel.stop()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
