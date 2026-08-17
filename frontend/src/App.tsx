import { useState } from 'react';
import { Database, Shield, ShieldAlert, ArrowRightLeft, Play, Settings2, Loader2, CheckCircle2, XCircle, TerminalSquare, Clock, Filter } from 'lucide-react';

type ProviderType = 'aws' | 'azure' | 'oracle' | 'supabase' | 'local';
type ConnectionMethod = 'direct' | 'ssh';
type TestStatus = 'idle' | 'testing_ssh' | 'testing_db' | 'success' | 'error';
type ViewState = 'setup' | 'preflight' | 'comparing' | 'results' | 'about' | 'privacy' | 'terms' | 'contact';

interface ConnectionState {
  provider: ProviderType;
  method: ConnectionMethod;
  host: string;
  port: string;
  dbName: string;
  user: string;
  pass: string;
  oracleService?: string;
  sshHost?: string;
  sshUser?: string;
  sshKey?: File | null;
  testStatus: TestStatus;
}

const getEmptyState = (provider: ProviderType = 'aws'): ConnectionState => ({
  provider,
  method: 'direct',
  host: '',
  port: provider === 'oracle' ? '1521' : '5432',
  dbName: '',
  user: '',
  pass: '',
  oracleService: '',
  sshHost: '',
  sshUser: '',
  sshKey: null,
  testStatus: 'idle'
});

interface PreFlightData {
  source_counts: Record<string, number>;
  target_counts: Record<string, number>;
  eta_seconds: number;
  total_objects: number;
}

export default function App() {
  const [zeroRetention, setZeroRetention] = useState(true);
  const [view, setView] = useState<ViewState>('setup');

  const [source, setSource] = useState<ConnectionState>(getEmptyState('aws'));
  const [target, setTarget] = useState<ConnectionState>(getEmptyState('supabase'));
  
  const [isPreflightLoading, setIsPreflightLoading] = useState(false);
  const [preflightData, setPreflightData] = useState<PreFlightData | null>(null);
  const [diffs, setDiffs] = useState<any[]>([]);
  
  const [selectedObjects, setSelectedObjects] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    functions: true,
    sequences: true,
    triggers: true
  });

  const canCompare = source.testStatus === 'success' && target.testStatus === 'success';

  const preparePayload = async (data: ConnectionState) => {
    let pemText = '';
    if (data.sshKey) {
      pemText = await data.sshKey.text();
    }
    return {
      type: data.provider,
      host: data.host,
      port: data.port,
      dbName: data.provider === 'oracle' ? data.oracleService : data.dbName,
      user: data.user,
      pass_: data.pass,
      sshHost: data.method === 'ssh' ? data.sshHost : null,
      sshUser: data.method === 'ssh' ? data.sshUser : null,
      sshKey: data.method === 'ssh' ? pemText : null,
      testMode: 'full'
    };
  };

  const handlePreflight = async () => {
    if (!canCompare) return;
    setIsPreflightLoading(true);
    
    try {
      const sourcePayload = await preparePayload(source);
      const targetPayload = await preparePayload(target);
      
      const res = await fetch('http://localhost:8000/api/compare/pre-flight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourcePayload,
          target: targetPayload
        })
      });
      
      if (!res.ok) throw new Error('Failed to fetch preflight counts');
      const data = await res.json();
      setPreflightData(data);
      setView('preflight');
    } catch (err) {
      alert("Failed to run preflight check: " + err);
    } finally {
      setIsPreflightLoading(false);
    }
  };

  const handleStartComparison = async () => {
    setView('comparing');
    
    try {
      const sourcePayload = await preparePayload(source);
      const targetPayload = await preparePayload(target);
      
      const res = await fetch('http://localhost:8000/api/compare/ddl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourcePayload,
          target: targetPayload,
          scope: selectedObjects
        })
      });
      
      if (!res.ok) throw new Error('Comparison failed');
      const data = await res.json();
      setDiffs(data.diffs);
      setView('results');
    } catch (err) {
      alert("Comparison Error: " + err);
      setView('preflight');
    }
  };
  
  const calculateDynamicEta = () => {
    if (!preflightData) return 0;
    let objects = 0;
    for (const key of Object.keys(selectedObjects)) {
      if (selectedObjects[key]) {
        objects += (preflightData.source_counts[key] || 0) + (preflightData.target_counts[key] || 0);
      }
    }
    return Math.max(1, Math.floor(objects * 0.05));
  };
  
  const dynamicEta = calculateDynamicEta();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-orange-500/30 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 shrink-0">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('setup')}>
            <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400">
              <ArrowRightLeft size={24} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">NamangyaDB <span className="text-slate-500 font-normal">Compare</span></h1>
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

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">
        {view === 'setup' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
            <div className="text-center space-y-4 py-8">
              <h2 className="text-3xl font-bold tracking-tight">Compare Environments</h2>
              <p className="text-slate-400 max-w-2xl mx-auto">
                Connect your source and target databases to identify DDL differences and data drifts. 
                {zeroRetention && " In Zero-Retention Mode, no credentials or data will be saved to disk."}
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              <ConnectionCard title="Source Database" data={source} onChange={setSource} />
              <ConnectionCard title="Target Database" data={target} onChange={setTarget} />
            </div>

            <div className="flex flex-col items-center pt-8 gap-3">
              <button 
                onClick={handlePreflight}
                disabled={!canCompare || isPreflightLoading}
                className={`group relative px-8 py-4 rounded-xl font-medium shadow-lg flex items-center gap-3 overflow-hidden transition-all ${
                  (canCompare && !isPreflightLoading)
                    ? 'bg-orange-600 hover:bg-orange-500 shadow-orange-500/20 cursor-pointer' 
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {(canCompare && !isPreflightLoading) && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />}
                <span className="relative z-10 flex items-center gap-2">
                  {isPreflightLoading ? <Loader2 size={18} className="animate-spin" /> : <Play fill="currentColor" size={18} />}
                  {isPreflightLoading ? 'Initializing Engine...' : 'Next: Configure Scope'}
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
        
        {view === 'preflight' && preflightData && (
          <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 py-8">
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-bold tracking-tight">Comparison Scope</h2>
              <p className="text-slate-400">
                We discovered a total of <span className="text-white font-medium">{preflightData.total_objects}</span> objects across both databases. 
                Select what you want to compare to optimize performance.
              </p>
            </div>
            
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Filter size={120} />
              </div>
              
              <div className="relative z-10 grid sm:grid-cols-2 gap-8">
                
                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2 border-b border-slate-700/50 pb-2">
                    <Database size={16} className="text-orange-400" />
                    Object Types
                  </h3>
                  
                  {['tables', 'views', 'functions', 'sequences', 'triggers'].map(type => (
                    <label key={type} className="flex items-center justify-between p-3 rounded-lg border border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors bg-slate-900/50">
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox" 
                          checked={selectedObjects[type]} 
                          onChange={e => setSelectedObjects({...selectedObjects, [type]: e.target.checked})}
                          className="w-4 h-4 text-orange-500 bg-slate-900 border-slate-700 rounded focus:ring-orange-500 focus:ring-2"
                        />
                        <span className="capitalize text-sm font-medium">{type}</span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {preflightData.source_counts[type]} (S) / {preflightData.target_counts[type]} (T)
                      </span>
                    </label>
                  ))}
                </div>
                
                <div className="flex flex-col justify-center items-center text-center p-6 bg-slate-900/50 border border-slate-700/50 rounded-xl space-y-4">
                   <div className="p-4 bg-orange-500/10 rounded-full text-orange-400">
                     <Clock size={32} />
                   </div>
                   <div>
                     <p className="text-slate-400 text-sm">Estimated Completion Time</p>
                     <p className="text-4xl font-bold tracking-tight mt-1 text-slate-100">
                       ~{dynamicEta} <span className="text-xl text-slate-500 font-normal">sec</span>
                     </p>
                   </div>
                   <p className="text-xs text-slate-500 max-w-[200px] mt-4">
                     Time is based on the volume of structural metadata that needs to be extracted and diffed in memory.
                   </p>
                </div>
                
              </div>
            </div>
            
            <div className="flex justify-center gap-4 pt-4">
              <button 
                onClick={() => setView('setup')}
                className="px-6 py-3 rounded-xl font-medium border border-slate-700 hover:bg-slate-800 transition-colors"
              >
                Back
              </button>
              <button 
                onClick={handleStartComparison}
                className="px-8 py-3 rounded-xl font-medium bg-orange-600 hover:bg-orange-500 transition-colors shadow-lg shadow-orange-500/20 flex items-center gap-2"
              >
                <Play fill="currentColor" size={16} />
                Confirm & Run Comparison
              </button>
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
              <p className="text-slate-400">Extracting and differing metadata securely in memory...</p>
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
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-6 space-y-4 md:col-span-2">
                <div className="flex items-center justify-between border-b border-slate-700/50 pb-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Settings2 size={18} className="text-purple-400" />
                    Structured DDL Differences
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${diffs.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                      {diffs.length} Changes Detected
                    </span>
                    <button className="px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-medium rounded-lg border border-orange-500/30 transition-colors flex items-center gap-1.5">
                      Generate Sync Script
                    </button>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-lg">Object</th>
                        <th className="px-4 py-3">Source (Actual)</th>
                        <th className="px-4 py-3 rounded-tr-lg">Target (Actual)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {diffs.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-slate-500 font-medium">No differences found! Schemas are perfectly aligned.</td>
                        </tr>
                      ) : (
                        diffs.map((diff, i) => (
                          <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-300">{diff.object}</td>
                            <td className={`px-4 py-3 font-mono text-xs ${diff.status === 'missing_source' ? 'text-red-400' : diff.status === 'mismatch' ? 'text-amber-400' : 'text-green-400'}`}>
                              {diff.source_actual}
                            </td>
                            <td className={`px-4 py-3 font-mono text-xs ${diff.status === 'missing_target' ? 'text-red-400' : diff.status === 'mismatch' ? 'text-amber-400' : 'text-slate-300'}`}>
                              {diff.target_actual}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Legal Pages */}
        {['about', 'privacy', 'terms', 'contact'].includes(view) && (
          <div className="max-w-3xl mx-auto space-y-6 bg-slate-800/40 p-8 rounded-2xl border border-slate-700/50 animate-in fade-in slide-in-from-bottom-4">
            <button onClick={() => setView('setup')} className="text-sm text-orange-400 hover:text-orange-300 transition-colors mb-4 block">
              &larr; Back to Tool
            </button>
            
            {view === 'about' && (
              <div className="prose prose-invert prose-orange max-w-none">
                <h2>About NamangyaDB</h2>
                <p>NamangyaDB is an advanced database management and comparison utility engineered for modern cloud architectures. Built by database professionals for database professionals, our mission is to eliminate the friction and uncertainty associated with schema migrations across disparate environments.</p>
                <p>We support all major cloud providers, including AWS, Azure, Oracle Cloud, and Supabase, as well as local instances. Our platform is designed with a core philosophy of extreme security and zero data residency.</p>
              </div>
            )}

            {view === 'privacy' && (
              <div className="prose prose-invert prose-orange max-w-none">
                <h2>Privacy Policy & Data Retention</h2>
                <p>At NamangyaDB, your data security is our highest priority. Unlike traditional SaaS database tools, we operate under a strict <strong>Zero-Retention Policy</strong> by default.</p>
                <h3>1. Zero Data Retention</h3>
                <p>When you utilize our comparison engine, we do not store, log, or persist any of the following to disk:</p>
                <ul>
                  <li>Database connection strings, hostnames, or ports.</li>
                  <li>Database usernames and passwords.</li>
                  <li>SSH Tunnel `.pem` or `.key` identity files.</li>
                  <li>Any schema (DDL) or row-level data extracted during comparison.</li>
                </ul>
                <p>All operations are performed entirely in-memory (RAM) and are completely wiped the moment your session is terminated or the browser is closed. SSH keys are written to ephemeral, OS-level secure temp files strictly for the duration of the tunnel handshake and are immediately unlinked from the filesystem.</p>
                <h3>2. Telemetry</h3>
                <p>We collect basic, anonymized page-visit telemetry (represented by the visit counter) solely for the purpose of understanding platform load. No personally identifiable information (PII) is associated with this data.</p>
              </div>
            )}

            {view === 'terms' && (
              <div className="prose prose-invert prose-orange max-w-none">
                <h2>Terms and Conditions</h2>
                <p>By accessing or using the NamangyaDB comparison tool, you agree to be bound by these Terms and Conditions.</p>
                <h3>1. Use of Service</h3>
                <p>You agree to only connect to databases and infrastructure for which you have explicit authorization. NamangyaDB is provided "as is", without warranty of any kind, express or implied.</p>
                <h3>2. Limitation of Liability</h3>
                <p>In no event shall the developers or owners of NamangyaDB be liable for any claim, damages, data loss, downtime, or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software. It is your responsibility to verify any generated sync scripts before applying them to a production environment.</p>
              </div>
            )}

            {view === 'contact' && (
              <div className="prose prose-invert prose-orange max-w-none">
                <h2>Contact Us</h2>
                <p>Have questions about NamangyaDB, require enterprise support, or want to report an issue? We'd love to hear from you.</p>
                <div className="bg-slate-900/50 p-6 rounded-lg border border-slate-700 mt-6">
                  <p className="m-0 text-slate-300"><strong>Email:</strong> support@namangyadb.com</p>
                  <p className="m-0 text-slate-300 mt-2"><strong>Enterprise Sales:</strong> enterprise@namangyadb.com</p>
                  <p className="m-0 text-slate-300 mt-2"><strong>Security Disclosures:</strong> security@namangyadb.com</p>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/50 shrink-0">
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono bg-slate-800 px-2 py-1 rounded text-slate-400 border border-slate-700 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Visits: 001248
            </span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => setView('about')} className="hover:text-orange-400 transition-colors">About Us</button>
            <button onClick={() => setView('privacy')} className="hover:text-orange-400 transition-colors">Privacy Policy</button>
            <button onClick={() => setView('terms')} className="hover:text-orange-400 transition-colors">Terms</button>
            <button onClick={() => setView('contact')} className="hover:text-orange-400 transition-colors">Contact Us</button>
          </div>
          <div className="text-slate-600">
            &copy; {new Date().getFullYear()} NamangyaDB. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function ConnectionCard({ title, data, onChange }: { title: string, data: ConnectionState, onChange: (d: ConnectionState) => void }) {
  
  const getHostValidationError = () => {
    if (!data.host) return null;
    const h = data.host.toLowerCase();
    const isLocal = h === 'localhost' || h === '127.0.0.1';
    
    if (data.provider === 'aws') {
      if (isLocal) return "AWS endpoints cannot be localhost.";
      if (!h.includes('amazonaws.com')) return "Warning: Not a standard AWS endpoint (*.amazonaws.com)";
    }
    if (data.provider === 'azure') {
      if (isLocal) return "Azure endpoints cannot be localhost.";
      if (!h.includes('azure.com') && !h.includes('windows.net')) return "Warning: Not a standard Azure endpoint";
    }
    if (data.provider === 'supabase') {
      if (isLocal) return "Supabase endpoints cannot be localhost.";
      if (!h.includes('supabase.co') && !h.includes('supabase.in')) return "Warning: Not a standard Supabase endpoint";
    }
    if (data.provider === 'oracle') {
      if (isLocal) return "Oracle Cloud endpoints cannot be localhost.";
      if (!h.includes('oraclecloud.com')) return "Warning: Not a standard Oracle endpoint";
    }
    return null;
  };

  const validationError = getHostValidationError();
  // Is it a hard error (blocks connection) or just a warning?
  const isHardError = validationError?.includes('cannot be localhost');

  const isFilled = () => {
    if (!data.host || !data.port || !data.user || !data.pass) return false;
    if (data.provider === 'oracle' && !data.oracleService) return false;
    if (data.provider !== 'oracle' && !data.dbName) return false;
    if (data.method === 'ssh') {
      if (!data.sshHost || !data.sshUser || !data.sshKey) return false;
    }
    if (isHardError) return false; // Block if hard error
    return true;
  };

  const handleProviderChange = (newProvider: ProviderType) => {
    onChange(getEmptyState(newProvider));
  };

  const handleTestConnection = async (type: 'ssh_only' | 'full') => {
    onChange({ ...data, testStatus: type === 'ssh_only' ? 'testing_ssh' : 'testing_db' });
    try {
      let pemText = '';
      if (data.sshKey) {
        pemText = await data.sshKey.text();
      }
      
      const payload = {
        type: data.provider,
        host: data.host,
        port: data.port,
        dbName: data.provider === 'oracle' ? data.oracleService : data.dbName,
        user: data.user,
        pass_: data.pass,
        sshHost: data.method === 'ssh' ? data.sshHost : null,
        sshUser: data.method === 'ssh' ? data.sshUser : null,
        sshKey: data.method === 'ssh' ? pemText : null,
        testMode: type
      };

      const res = await fetch('http://localhost:8000/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) throw new Error('Connection failed');
      onChange({ ...data, testStatus: type === 'full' ? 'success' : 'idle' });
    } catch (err) {
      onChange({ ...data, testStatus: 'error' });
    }
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 relative group transition-all hover:bg-slate-800/60 shadow-lg h-full flex flex-col">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-amber-500 opacity-50 group-hover:opacity-100 transition-opacity" />
      
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Database size={18} className="text-orange-400" />
          {title}
        </h3>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Cloud Provider</label>
          <select 
            value={data.provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
          >
            <option value="aws">AWS (RDS / Aurora)</option>
            <option value="azure">Azure Database</option>
            <option value="oracle">Oracle Cloud</option>
            <option value="supabase">Supabase</option>
            <option value="local">Local</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Connection Method</label>
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button 
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${data.method === 'direct' ? 'bg-slate-700 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
              onClick={() => onChange({...data, method: 'direct', testStatus: 'idle'})}
            >
              Direct
            </button>
            <button 
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${data.method === 'ssh' ? 'bg-slate-700 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
              onClick={() => onChange({...data, method: 'ssh', testStatus: 'idle'})}
            >
              Via SSH Tunnel
            </button>
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-slate-700/50">
          <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Database size={14} className="text-slate-500"/> DB Credentials
          </h4>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Host / Endpoint</label>
              <input 
                type="text" 
                value={data.host} 
                onChange={e => onChange({...data, host: e.target.value, testStatus: 'idle'})} 
                className={`w-full bg-slate-900 border rounded-lg px-4 py-2.5 text-sm outline-none transition-all placeholder:text-slate-600 ${
                  isHardError ? 'border-red-500/50 focus:ring-red-500/50' : 
                  validationError ? 'border-amber-500/50 focus:ring-amber-500/50' : 
                  'border-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-orange-500'
                }`}
                placeholder="db.example.com" 
              />
              {validationError && (
                <p className={`text-[10px] mt-1.5 flex items-center gap-1 ${isHardError ? 'text-red-400' : 'text-amber-400'}`}>
                  {isHardError ? <XCircle size={12}/> : <ShieldAlert size={12}/>}
                  {validationError}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Port</label>
              <input type="text" value={data.port} onChange={e => onChange({...data, port: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {data.provider === 'oracle' ? (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Service Name</label>
                <input type="text" value={data.oracleService} onChange={e => onChange({...data, oracleService: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" placeholder="ORCL" />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">DB Name</label>
                <input type="text" value={data.dbName} onChange={e => onChange({...data, dbName: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" placeholder="postgres" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">User</label>
              <input type="text" value={data.user} onChange={e => onChange({...data, user: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" placeholder="admin" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
              <input type="password" value={data.pass} onChange={e => onChange({...data, pass: e.target.value, testStatus: 'idle'})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" placeholder="••••••••" />
            </div>
          </div>
        </div>

        {data.method === 'ssh' && (
          <div className="pt-4 border-t border-slate-700/50 space-y-4 animate-in fade-in slide-in-from-top-2">
            <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <TerminalSquare size={14} className="text-slate-500"/> SSH Configuration
            </h4>
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
              <div className="border border-dashed border-slate-600 rounded-lg p-4 text-center hover:bg-slate-700/30 transition-colors cursor-pointer group bg-slate-900" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement).click()}>
                <span className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                  {data.sshKey ? `Selected: ${data.sshKey.name}` : 'Click to upload .pem key'}
                </span>
                <input type="file" className="hidden" accept=".pem,.key" onChange={(e) => {
                  onChange({...data, sshKey: e.target.files?.[0] || null, testStatus: 'idle'});
                }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pt-6 mt-6 border-t border-slate-700/50 space-y-3 shrink-0">
        {data.method === 'ssh' && (
          <button
            onClick={() => handleTestConnection('ssh_only')}
            disabled={!isFilled() || data.testStatus === 'testing_ssh' || data.testStatus === 'testing_db'}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-2.5 rounded-lg text-sm font-medium border border-slate-700"
          >
            {data.testStatus === 'testing_ssh' ? <><Loader2 size={16} className="animate-spin" /> Testing SSH...</> : 'Test SSH Tunnel'}
          </button>
        )}
        
        <button
          onClick={() => handleTestConnection('full')}
          disabled={!isFilled() || data.testStatus === 'testing_ssh' || data.testStatus === 'testing_db'}
          className={`w-full flex items-center justify-center gap-2 transition-colors py-2.5 rounded-lg text-sm font-medium ${
            data.testStatus === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 
            data.testStatus === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
            'bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          {data.testStatus === 'idle' && 'Test Connection'}
          {data.testStatus === 'testing_db' && <><Loader2 size={16} className="animate-spin" /> Testing DB...</>}
          {data.testStatus === 'success' && <><CheckCircle2 size={16} /> Connection Successful</>}
          {data.testStatus === 'error' && <><XCircle size={16} /> Connection Failed</>}
        </button>
      </div>

    </div>
  );
}
