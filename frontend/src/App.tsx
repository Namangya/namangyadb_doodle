import React, { useState } from 'react';
import { Database, Shield, ShieldAlert, ArrowRightLeft, Play, Settings2, Loader2, CheckCircle2, XCircle } from 'lucide-react';

type ConnectionType = 'local' | 'ssh' | 'aws' | 'azure';
type TestStatus = 'idle' | 'testing' | 'success' | 'error';

interface ConnectionState {
  type: ConnectionType;
  host: string;
  port: string;
  dbName: string;
  user: string;
  pass: string;
  sshHost?: string;
  sshUser?: string;
  sshKey?: File | null;
  testStatus: TestStatus;
}

export default function App() {
  const [zeroRetention, setZeroRetention] = useState(true);
  const [view, setView] = useState<'setup' | 'comparing' | 'results'>('setup');

  const [source, setSource] = useState<ConnectionState>({
    type: 'local', host: 'localhost', port: '5432', dbName: '', user: '', pass: '', testStatus: 'idle'
  });

  const [target, setTarget] = useState<ConnectionState>({
    type: 'aws', host: 'cluster.rds.amazonaws.com', port: '5432', dbName: '', user: '', pass: '', testStatus: 'idle'
  });

  const canCompare = source.testStatus === 'success' && target.testStatus === 'success';

  const handleConnect = () => {
    if (!canCompare) return;
    setView('comparing');
    setTimeout(() => setView('results'), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400">
              <ArrowRightLeft size={24} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">SyncDB <span className="text-slate-500 font-normal">Compare</span></h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="relative group">
              <button 
                onClick={() => setZeroRetention(!zeroRetention)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${
                  zeroRetention 
                    ? 'border-green-500/30 bg-green-500/10 text-green-400' 
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                }`}
              >
                {zeroRetention ? <Shield size={16} /> : <ShieldAlert size={16} />}
                {zeroRetention ? 'Zero-Retention Mode: ON' : 'Zero-Retention Mode: OFF'}
              </button>
              
              {/* Hover Tooltip */}
              <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-slate-800 border border-slate-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 text-xs text-slate-300">
                <p className="mb-1 text-slate-100 font-medium">Zero-Retention Mode</p>
                {zeroRetention 
                  ? "When enabled, your connection strings, .pem keys, and processed data reside completely in RAM and are wiped as soon as the session closes. Nothing is saved." 
                  : "When disabled, your connection settings may be cached locally for convenience in future sessions."}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {view === 'setup' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-4 py-8">
              <h2 className="text-3xl font-bold tracking-tight">Compare Environments</h2>
              <p className="text-slate-400 max-w-2xl mx-auto">
                Connect your source and target databases to identify DDL differences and data drifts. 
                {zeroRetention && " In Zero-Retention Mode, no credentials or data will be saved to disk."}
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <ConnectionCard title="Source Database" data={source} onChange={setSource} />
              <ConnectionCard title="Target Database" data={target} onChange={setTarget} />
            </div>

            <div className="flex flex-col items-center pt-8 gap-3">
              <button 
                onClick={handleConnect}
                disabled={!canCompare}
                className={`group relative px-8 py-4 rounded-xl font-medium shadow-lg flex items-center gap-3 overflow-hidden transition-all ${
                  canCompare 
                    ? 'bg-orange-600 hover:bg-orange-500 shadow-orange-500/20 cursor-pointer' 
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {canCompare && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />}
                <span className="relative z-10 flex items-center gap-2">
                  <Play fill="currentColor" size={18} />
                  Start Comparison
                </span>
              </button>
              {!canCompare && (
                <p className="text-sm text-slate-500">
                  Please test both connections successfully before starting the comparison.
                </p>
              )}
            </div>
          </div>
        )}

        {view === 'comparing' && (
          <div className="h-[60vh] flex flex-col items-center justify-center space-y-6 animate-in fade-in duration-500">
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin w-16 h-16" />
              <Database className="text-orange-400 animate-pulse" size={24} />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-medium">Analyzing Environments</h3>
              <p className="text-slate-400">Extracting DDL schemas securely...</p>
            </div>
          </div>
        )}

        {view === 'results' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Comparison Results</h2>
              <button onClick={() => setView('setup')} className="text-sm text-slate-400 hover:text-orange-400 transition-colors">
                &larr; Back to Setup
              </button>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              {/* DDL Diff Mock */}
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-700/50 pb-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Settings2 size={18} className="text-purple-400" />
                    DDL Differences
                  </h3>
                  <span className="px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 text-xs font-medium">3 Changes</span>
                </div>
                <div className="space-y-2 font-mono text-sm">
                  <div className="p-3 bg-slate-900/50 rounded-lg text-red-400 border border-red-500/20">
                    - ALTER TABLE users DROP COLUMN last_login;
                  </div>
                  <div className="p-3 bg-slate-900/50 rounded-lg text-green-400 border border-green-500/20">
                    + ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;
                  </div>
                  <div className="p-3 bg-slate-900/50 rounded-lg text-green-400 border border-green-500/20">
                    + CREATE INDEX idx_users_email ON users(email);
                  </div>
                </div>
              </div>

              {/* Data Diff Mock */}
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-700/50 pb-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Database size={18} className="text-emerald-400" />
                    Data Differences (users table)
                  </h3>
                  <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-medium">12 Mismatches</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-lg">ID</th>
                        <th className="px-4 py-3">Source</th>
                        <th className="px-4 py-3 rounded-tr-lg">Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      <tr>
                        <td className="px-4 py-3 font-mono">1042</td>
                        <td className="px-4 py-3 text-red-400">status: 'active'</td>
                        <td className="px-4 py-3 text-green-400">status: 'pending'</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">1055</td>
                        <td className="px-4 py-3 text-red-400">Missing</td>
                        <td className="px-4 py-3 text-green-400">Present</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="pt-2 text-center">
                  <button className="text-sm text-orange-400 hover:text-orange-300 transition-colors">View all 12 mismatches</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ConnectionCard({ title, data, onChange }: { title: string, data: ConnectionState, onChange: (d: ConnectionState) => void }) {
  const handleTestConnection = () => {
    onChange({ ...data, testStatus: 'testing' });
    // Mock API call delay
    setTimeout(() => {
      onChange({ ...data, testStatus: 'success' });
    }, 1500);
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 relative group overflow-hidden transition-all hover:bg-slate-800/60">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-amber-500 opacity-50 group-hover:opacity-100 transition-opacity" />
      
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Database size={18} className="text-orange-400" />
          {title}
        </h3>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Connection Type</label>
          <select 
            value={data.type}
            onChange={(e) => onChange({...data, type: e.target.value as ConnectionType, testStatus: 'idle'})}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
          >
            <option value="local">Local Database</option>
            <option value="ssh">SSH Tunnel (General)</option>
            <option value="aws">AWS Aurora via SSH</option>
            <option value="azure">Azure Postgres</option>
          </select>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Host</label>
            <input type="text" value={data.host} onChange={e => onChange({...data, host: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all placeholder:text-slate-600" placeholder="localhost" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Port</label>
            <input type="text" value={data.port} onChange={e => onChange({...data, port: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Database Name</label>
            <input type="text" value={data.dbName} onChange={e => onChange({...data, dbName: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" placeholder="postgres" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">User</label>
            <input type="text" value={data.user} onChange={e => onChange({...data, user: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" placeholder="postgres" />
          </div>
        </div>

        {(data.type === 'ssh' || data.type === 'aws') && (
          <div className="pt-4 mt-4 border-t border-slate-700/50 space-y-4">
            <h4 className="text-sm font-medium text-slate-300">SSH Configuration</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">SSH Host</label>
                <input type="text" value={data.sshHost || ''} onChange={e => onChange({...data, sshHost: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all placeholder:text-slate-600" placeholder="bastion.env.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">SSH User</label>
                <input type="text" value={data.sshUser || ''} onChange={e => onChange({...data, sshUser: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all placeholder:text-slate-600" placeholder="ec2-user" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Identity File (.pem)</label>
              <div className="border border-dashed border-slate-600 rounded-lg p-4 text-center hover:bg-slate-700/30 transition-colors cursor-pointer group">
                <span className="text-sm text-slate-400 group-hover:text-slate-300">Click to upload .pem key</span>
                <input type="file" className="hidden" accept=".pem,.key" onChange={() => onChange({...data, testStatus: 'idle'})} />
              </div>
              <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1"><Shield size={12}/> File only kept in memory.</p>
            </div>
          </div>
        )}
        
        <div className="pt-6 mt-4 border-t border-slate-700/50">
          <button
            onClick={handleTestConnection}
            disabled={data.testStatus === 'testing'}
            className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 transition-colors py-2.5 rounded-lg text-sm font-medium"
          >
            {data.testStatus === 'idle' && 'Test Connection'}
            {data.testStatus === 'testing' && <><Loader2 size={16} className="animate-spin" /> Testing...</>}
            {data.testStatus === 'success' && <><CheckCircle2 size={16} className="text-green-400" /> Connection Successful</>}
            {data.testStatus === 'error' && <><XCircle size={16} className="text-red-400" /> Connection Failed</>}
          </button>
        </div>

      </div>
    </div>
  );
}
