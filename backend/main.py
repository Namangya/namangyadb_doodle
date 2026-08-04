from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import psycopg2
from sshtunnel import SSHTunnelForwarder

app = FastAPI(title="SyncDB Compare API")

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

@app.post("/api/test-connection")
async def test_connection(req: ConnectionRequest):
    tunnel = None
    conn = None
    
    try:
        db_host = req.host
        db_port = int(req.port)
        
        if req.sshHost and req.sshUser and req.sshKey:
            import tempfile
            import os
            
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
            return {"status": "success", "message": "SSH Tunnel tested successfully"}

        conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            dbname=req.dbName,
            user=req.user,
            password=req.pass_
        )
        
        cur = conn.cursor()
        cur.execute("SELECT 1;")
        cur.fetchone()
        cur.close()
        
        return {"status": "success", "message": "Connection tested successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    finally:
        # Cleanup connection and tunnel
        if conn:
            conn.close()
        if tunnel:
            tunnel.stop()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
