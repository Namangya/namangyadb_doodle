import { useState } from 'react';
import { 
  Database, Shield, ShieldAlert, ArrowRightLeft, Play, Settings2, Loader2, 
  CheckCircle2, XCircle, TerminalSquare, Clock, Filter, Copy, Check, Download, 
  Table, ChevronDown, ChevronRight, FileText, RefreshCw, Trash2, Undo2
} from 'lucide-react';

type ProviderType = 'aws' | 'azure' | 'oracle' | 'supabase' | 'local';
type ConnectionMethod = 'direct' | 'ssh';
type TestStatus = 'idle' | 'testing_ssh' | 'testing_db' | 'success' | 'error';
type ViewState = 'setup' | 'preflight' | 'comparing' | 'results';

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
  source_counts: Record<string, any>;
  target_counts: Record<string, any>;
  common_tables: string[];
  eta_seconds: number;
  total_objects: number;
}

interface DdlDiff {
  object_type: string;
  name: string;
  object: string;
  source_actual: string;
  target_actual: string;
  status: 'missing_target' | 'missing_source' | 'mismatch';
  raw_data?: Record<string, any>;
}

interface DataDiffSummary {
  tables_analyzed: number;
  tables_in_sync: number;
  tables_with_drift: number;
  total_missing_target: number;
  total_missing_source: number;
  total_value_mismatches: number;
}

interface TableDataDiff {
  table_name: string;
  status: 'in_sync' | 'drift_detected' | 'error';
  source_row_count: number;
  target_row_count: number;
  source_checksum: string;
  target_checksum: string;
  primary_keys: string[];
  common_columns: string[];
  missing_in_target_count: number;
  missing_in_source_count: number;
  mismatched_rows_count: number;
  sample_missing_in_target: any[];
  sample_missing_in_source: any[];
  sample_mismatches: any[];
  error?: string;
}

interface DataDiffResult {
  summary: DataDiffSummary;
  tables: Record<string, TableDataDiff>;
}

const SCHEMA_OBJECTS = [
  { key: 'tables', label: 'Tables & Columns', desc: 'Columns, data types, defaults, nullability, constraints, indexes' },
  { key: 'views', label: 'Standard Views', desc: 'Standard SQL view definitions' },
  { key: 'materialized_views', label: 'Materialized Views', desc: 'Precomputed cached query view definitions' },
  { key: 'functions', label: 'Functions', desc: 'Scalar & table functions (LANGUAGE plpgsql/sql)' },
  { key: 'procedures', label: 'Stored Procedures', desc: 'Transactional stored procedures (CALL ...)' },
  { key: 'sequences', label: 'Sequences', desc: 'Auto-increment and identity sequences' },
  { key: 'triggers', label: 'Triggers', desc: 'Row and statement event triggers' },
  { key: 'roles', label: 'Users & Roles', desc: 'Database users, login attributes & permissions' },
  { key: 'grants', label: 'Grants & Privileges', desc: 'Object privileges (SELECT, INSERT, UPDATE, EXECUTE)' },
];

export default function App() {
  const [zeroRetention, setZeroRetention] = useState(true);
  const [view, setView] = useState<ViewState>('setup');

  const [source, setSource] = useState<ConnectionState>(getEmptyState('local'));
  const [target, setTarget] = useState<ConnectionState>(getEmptyState('local'));
  
  const [isPreflightLoading, setIsPreflightLoading] = useState(false);
  const [preflightData, setPreflightData] = useState<PreFlightData | null>(null);
  
  // Scope controls (Complete DDL Schema Types)
  const [selectedObjects, setSelectedObjects] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    materialized_views: true,
    functions: true,
    procedures: true,
    sequences: true,
    triggers: true,
    roles: true,
    grants: true
  });
  const [compareDataEnabled, setCompareDataEnabled] = useState(true);
  const [selectedDataTables, setSelectedDataTables] = useState<string[]>([]);

  // Comparison results
  const [diffs, setDiffs] = useState<DdlDiff[]>([]);
  const [sourceSnap, setSourceSnap] = useState<any>(null);
  const [targetSnap, setTargetSnap] = useState<any>(null);
  const [dataDiff, setDataDiff] = useState<DataDiffResult | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'ddl' | 'data'>('ddl');
  const [ddlFilter, setDdlFilter] = useState<string>('all');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  // Sync & Rollback Script modal
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncScript, setSyncScript] = useState('');
  const [syncStats, setSyncStats] = useState<any>(null);
  const [rollbackScript, setRollbackScript] = useState('');
  const [rollbackStats, setRollbackStats] = useState<any>(null);
  const [activeScriptTab, setActiveScriptTab] = useState<'migration' | 'rollback'>('migration');
  const [syncSafeMode, setSyncSafeMode] = useState(true);
  const [syncIncludeDdl, setSyncIncludeDdl] = useState(true);
  const [syncIncludeData, setSyncIncludeData] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedDdlIdx, setCopiedDdlIdx] = useState<number | null>(null);
  const [copiedTable, setCopiedTable] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [modalCategoryFilter, setModalCategoryFilter] = useState<'all' | 'tables' | 'views' | 'routines' | 'data'>('all');

  const canCompare = source.testStatus === 'success' && target.testStatus === 'success';
  const [isTestingBoth, setIsTestingBoth] = useState(false);

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

  const testOneConnection = async (data: ConnectionState, setData: (d: ConnectionState) => void) => {
    setData({ ...data, testStatus: 'testing_db' });
    try {
      const payload = await preparePayload(data);
      const res = await fetch('http://localhost:8000/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Connection failed');
      }
      setData({ ...data, testStatus: 'success' });
    } catch (err) {
      console.error("Test connection error:", err);
      setData({ ...data, testStatus: 'error' });
    }
  };

  const handleTestBoth = async () => {
    setIsTestingBoth(true);
    try {
      await Promise.all([
        testOneConnection(source, setSource),
        testOneConnection(target, setTarget)
      ]);
    } finally {
      setIsTestingBoth(false);
    }
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
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to fetch preflight counts');
      }
      const data: PreFlightData = await res.json();
      setPreflightData(data);
      setSelectedDataTables(data.common_tables || []);
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
      
      // 1. Run DDL comparison
      const ddlRes = await fetch('http://localhost:8000/api/compare/ddl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourcePayload,
          target: targetPayload,
          scope: selectedObjects
        })
      });
      
      if (!ddlRes.ok) {
        const errData = await ddlRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'DDL Comparison failed');
      }
      const ddlData = await ddlRes.json();
      setDiffs(ddlData.diffs || []);
      setSourceSnap(ddlData.source_snap || null);
      setTargetSnap(ddlData.target_snap || null);

      // 2. Run Data comparison if enabled
      if (compareDataEnabled && selectedDataTables.length > 0) {
        const dataRes = await fetch('http://localhost:8000/api/compare/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: sourcePayload,
            target: targetPayload,
            tables: selectedDataTables,
            max_sample_rows: 50
          })
        });

        if (dataRes.ok) {
          const dataResponse = await dataRes.json();
          setDataDiff(dataResponse.data_diff || null);
        } else {
          console.warn("Data comparison returned error");
          setDataDiff(null);
        }
      } else {
        setDataDiff(null);
      }

      setView('results');
      setActiveResultTab('ddl');
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
    let sec = Math.max(1, Math.floor(objects * 0.05));
    if (compareDataEnabled && selectedDataTables.length > 0) {
      sec += Math.max(1, Math.ceil(selectedDataTables.length * 0.4));
    }
    return sec;
  };
  
  const dynamicEta = calculateDynamicEta();

  const formatSqlVal = (val: any): string => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number') return String(val);
    const s = String(val).replace(/'/g, "''");
    return `'${s}'`;
  };

  const getSingleDdlSql = (diff: DdlDiff, sSnap: any, _tSnap: any): string => {
    // 1. Table
    if (diff.object_type === 'table') {
      if (diff.status === 'missing_target') {
        const tInfo = sSnap?.tables?.[diff.name || ''];
        if (tInfo) {
          const cols = tInfo.columns || {};
          const pks: string[] = tInfo.primary_keys || [];
          
          // Auto-detect any referenced sequences in column defaults (e.g. nextval('order_id_seq'::regclass))
          const seqs: Array<{ seqName: string; colName: string }> = [];
          for (const [cName, cData] of Object.entries(cols)) {
            const defStr = (cData as any)?.default || '';
            const match = defStr.match(/nextval\('(?:\w+\.)?"?([a-zA-Z0-9_]+)"?'(?:::regclass)?\)/i);
            if (match && match[1]) {
              seqs.push({ seqName: match[1], colName: cName });
            }
          }

          const parts: string[] = [];

          // Pre-create sequences so nextval(...) regclass can resolve during CREATE TABLE
          for (const s of seqs) {
            parts.push(`CREATE SEQUENCE IF NOT EXISTS "${s.seqName}";`);
          }

          // Build CREATE TABLE
          const colDefs: string[] = [];
          for (const [cName, cData] of Object.entries(cols)) {
            let colStr = `    "${cName}" ${(cData as any).type}`;
            if ((cData as any).default) colStr += ` DEFAULT ${(cData as any).default}`;
            if ((cData as any).nullable === 'NO') colStr += ` NOT NULL`;
            colDefs.push(colStr);
          }
          if (pks.length > 0) {
            colDefs.push(`    PRIMARY KEY (${pks.map((p: string) => `"${p}"`).join(', ')})`);
          }
          parts.push(`CREATE TABLE IF NOT EXISTS "${diff.name}" (\n${colDefs.join(',\n')}\n);`);

          // Bind sequence ownership
          for (const s of seqs) {
            parts.push(`ALTER SEQUENCE "${s.seqName}" OWNED BY "${diff.name}"."${s.colName}";`);
          }

          // Secondary Indexes: skip primary key indexes, add IF NOT EXISTS
          const idxs = tInfo.indexes || {};
          for (const [idxName, idxDef] of Object.entries(idxs)) {
            if (
              idxName.endsWith('_pkey') || 
              idxName === `${diff.name}_pkey` || 
              pks.some((pk: string) => idxName === `${diff.name}_${pk}_key`)
            ) {
              continue;
            }
            let d = (idxDef as string).trim();
            if (!d.endsWith(';')) d += ';';
            if (!d.toUpperCase().includes('IF NOT EXISTS')) {
              d = d.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+/i, '$1 IF NOT EXISTS ');
            }
            parts.push(d);
          }

          return parts.join('\n\n');
        }
        return `CREATE TABLE IF NOT EXISTS "${diff.name}";`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY TABLE]\nDROP TABLE IF EXISTS "${diff.name}" CASCADE;`;
      }
    }

    // 2. Column
    if (diff.object_type === 'column') {
      const tableName = diff.raw_data?.table || (diff.name?.includes('.') ? diff.name.split('.')[0] : '');
      const colName = diff.raw_data?.column || (diff.name?.includes('.') ? diff.name.split('.')[1] : diff.name || '');
      if (diff.status === 'missing_target') {
        const colData = diff.raw_data?.col_data || {};
        const parts: string[] = [];
        const defStr = colData.default || '';
        const match = defStr.match(/nextval\('(?:\w+\.)?"?([a-zA-Z0-9_]+)"?'(?:::regclass)?\)/i);
        if (match && match[1]) {
          parts.push(`CREATE SEQUENCE IF NOT EXISTS "${match[1]}";`);
        }
        let colStr = `"${colName}" ${colData.type || 'text'}`;
        if (colData.default) colStr += ` DEFAULT ${colData.default}`;
        if (colData.nullable === 'NO') colStr += ` NOT NULL`;
        parts.push(`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS ${colStr};`);
        if (match && match[1]) {
          parts.push(`ALTER SEQUENCE "${match[1]}" OWNED BY "${tableName}"."${colName}";`);
        }
        return parts.join('\n');
      } else if (diff.status === 'mismatch') {
        const kind = diff.raw_data?.mismatch_kind;
        const sCol = diff.raw_data?.source_col || {};
        if (kind === 'type' || !kind) {
          return `ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" TYPE ${sCol.type} USING "${colName}"::${sCol.type};`;
        } else if (kind === 'default') {
          return sCol.default
            ? `ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET DEFAULT ${sCol.default};`
            : `ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" DROP DEFAULT;`;
        } else if (kind === 'nullable') {
          return sCol.nullable === 'NO'
            ? `ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET NOT NULL;`
            : `ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" DROP NOT NULL;`;
        }
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY COLUMN]\nALTER TABLE "${tableName}" DROP COLUMN IF EXISTS "${colName}";`;
      }
    }

    // 3. Index
    if (diff.object_type === 'index') {
      const idxName = diff.raw_data?.index_name || (diff.name?.includes('.') ? diff.name.split('.')[1] : diff.name || '');
      if (idxName.endsWith('_pkey')) {
        return `-- Index "${idxName}" is a PRIMARY KEY index managed automatically by the table's PRIMARY KEY constraint.`;
      }
      if (diff.status === 'missing_target') {
        let def = diff.raw_data?.def || '';
        if (!def.endsWith(';')) def += ';';
        if (!def.toUpperCase().includes('IF NOT EXISTS')) {
          def = def.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+/i, '$1 IF NOT EXISTS ');
        }
        return def || `CREATE INDEX IF NOT EXISTS "${idxName}";`;
      } else if (diff.status === 'mismatch') {
        let sDef = diff.raw_data?.source_def || '';
        if (!sDef.trim().endsWith(';')) sDef = sDef.trim() + ';';
        if (!sDef.toUpperCase().includes('IF NOT EXISTS')) {
          sDef = sDef.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+/i, '$1 IF NOT EXISTS ');
        }
        return `DROP INDEX IF EXISTS "${idxName}";\n${sDef}`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY INDEX]\nDROP INDEX IF EXISTS "${idxName}";`;
      }
    }

    // 4. View
    if (diff.object_type === 'view') {
      const vName = diff.name || '';
      if (diff.status === 'missing_target' || diff.status === 'mismatch') {
        let def = (sSnap?.views?.[vName] || diff.raw_data?.def || '').trim();
        if (!def.endsWith(';')) def += ';';
        return `DROP VIEW IF EXISTS "${vName}" CASCADE;\nCREATE OR REPLACE VIEW "${vName}" AS\n${def}`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY VIEW]\nDROP VIEW IF EXISTS "${vName}";`;
      }
    }

    // 5. Materialized View
    if (diff.object_type === 'materialized_view') {
      const mvName = diff.name || '';
      if (diff.status === 'missing_target' || diff.status === 'mismatch') {
        let def = (sSnap?.materialized_views?.[mvName] || diff.raw_data?.def || '').trim();
        if (!def.endsWith(';')) def += ';';
        return `DROP MATERIALIZED VIEW IF EXISTS "${mvName}";\nCREATE MATERIALIZED VIEW "${mvName}" AS\n${def}`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY MATVIEW]\nDROP MATERIALIZED VIEW IF EXISTS "${mvName}";`;
      }
    }

    // 6. Function
    if (diff.object_type === 'function') {
      const fnName = diff.name || '';
      if (diff.status === 'missing_target' || diff.status === 'mismatch') {
        let def = (sSnap?.functions?.[fnName] || diff.raw_data?.def || '').trim();
        if (!def.endsWith(';')) def += ';';
        return def;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY FUNCTION]\nDROP FUNCTION IF EXISTS ${fnName};`;
      }
    }

    // 7. Procedure
    if (diff.object_type === 'procedure') {
      const procName = diff.name || '';
      if (diff.status === 'missing_target' || diff.status === 'mismatch') {
        let def = (sSnap?.procedures?.[procName] || diff.raw_data?.def || '').trim();
        if (!def.endsWith(';')) def += ';';
        return def;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY PROCEDURE]\nDROP PROCEDURE IF EXISTS ${procName};`;
      }
    }

    // 8. Sequence
    if (diff.object_type === 'sequence') {
      const seqName = diff.name || '';
      if (diff.status === 'missing_target') {
        return `CREATE SEQUENCE IF NOT EXISTS "${seqName}";`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY SEQUENCE]\nDROP SEQUENCE IF EXISTS "${seqName}";`;
      }
    }

    // 9. Trigger
    if (diff.object_type === 'trigger') {
      const trName = diff.name || '';
      const tObj = sSnap?.triggers?.[trName] || diff.raw_data?.def || {};
      let def = (typeof tObj === 'object' ? tObj.def : String(tObj)) || '';
      const tbl = typeof tObj === 'object' ? tObj.table : '';
      if (!def.trim().endsWith(';')) def = def.trim() + ';';
      if (diff.status === 'missing_target') {
        return def;
      } else if (diff.status === 'mismatch') {
        return `DROP TRIGGER IF EXISTS "${trName}" ON "${tbl || 'table_name'}";\n${def}`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY TRIGGER]\nDROP TRIGGER IF EXISTS "${trName}" ON "${tbl || 'table_name'}";`;
      }
    }

    // 10. Role / User
    if (diff.object_type === 'role') {
      const rName = diff.name || '';
      const rData = diff.raw_data?.role_data || sSnap?.roles?.[rName] || {};
      if (diff.status === 'missing_target') {
        const opts: string[] = [];
        opts.push(rData.can_login ? 'LOGIN' : 'NOLOGIN');
        if (rData.superuser) opts.push('SUPERUSER');
        if (rData.create_db) opts.push('CREATEDB');
        if (rData.create_role) opts.push('CREATEROLE');
        if (rData.inherit) opts.push('INHERIT');
        return `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${rName}') THEN CREATE ROLE "${rName}" WITH ${opts.join(' ')}; END IF; END $$;`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY ROLE]\nDROP ROLE IF EXISTS "${rName}";`;
      }
    }

    // 11. Grant
    if (diff.object_type === 'grant') {
      const gData = diff.raw_data?.grant_data || {};
      if (diff.status === 'missing_target') {
        return `GRANT ${gData.privilege} ON "${gData.object_name}" TO "${gData.grantee}";`;
      } else if (diff.status === 'missing_source') {
        return `-- [TARGET ONLY PRIVILEGE]\nREVOKE ${gData.privilege} ON "${gData.object_name}" FROM "${gData.grantee}";`;
      }
    }

    return `-- Difference: ${diff.object_type} ${diff.name || diff.object || ''} (${diff.status});`;
  };

  const getTableDataSyncSql = (tableName: string, tInfo: any): string => {
    const lines: string[] = [];
    lines.push(`-- Synchronization SQL for Table: "${tableName}"`);
    const commonCols: string[] = tInfo.common_columns || [];

    // 1. Missing rows in target -> INSERT
    const missingTarget = tInfo.sample_missing_in_target || [];
    if (missingTarget.length > 0) {
      lines.push(`\n-- Insert missing rows (${missingTarget.length} sample rows)`);
      for (const item of missingTarget) {
        const row = item.row || {};
        const colsToInsert = commonCols.filter(c => c in row);
        const colsSql = colsToInsert.map(c => `"${c}"`).join(', ');
        const valsSql = colsToInsert.map(c => formatSqlVal(row[c])).join(', ');
        lines.push(`INSERT INTO "${tableName}" (${colsSql}) VALUES (${valsSql});`);
      }
    }

    // 2. Mismatched rows -> UPDATE
    const mismatches = tInfo.sample_mismatches || [];
    if (mismatches.length > 0) {
      lines.push(`\n-- Update mismatched rows (${mismatches.length} sample rows)`);
      for (const item of mismatches) {
        const pkDict = item.pk || {};
        const sVals = item.source_values || {};
        if (Object.keys(pkDict).length === 0 || Object.keys(sVals).length === 0) continue;

        const setClauses = Object.entries(sVals).map(([col, val]) => `"${col}" = ${formatSqlVal(val)}`);
        const whereClauses = Object.entries(pkDict).map(([col, val]) => `"${col}" = ${formatSqlVal(val)}`);
        lines.push(`UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')};`);
      }
    }

    // 3. Extra rows in target (missing in source) -> DELETE commented out for safety
    const missingSource = tInfo.sample_missing_in_source || [];
    if (missingSource.length > 0) {
      lines.push(`\n-- Extra rows present only in Target (${missingSource.length} sample rows)`);
      for (const item of missingSource) {
        const pkDict = item.pk || {};
        if (Object.keys(pkDict).length > 0) {
          const whereClauses = Object.entries(pkDict).map(([col, val]) => `"${col}" = ${formatSqlVal(val)}`);
          lines.push(`-- DELETE FROM "${tableName}" WHERE ${whereClauses.join(' AND ')};`);
        }
      }
    }

    return lines.join('\n');
  };

  const handleCopySingleDdl = (diff: DdlDiff, idx: number) => {
    const sql = getSingleDdlSql(diff, sourceSnap, targetSnap);
    navigator.clipboard.writeText(sql);
    setCopiedDdlIdx(idx);
    setTimeout(() => setCopiedDdlIdx(null), 2000);
  };

  const handleCopyTableDataSql = (tableName: string, tInfo: any) => {
    const sql = getTableDataSyncSql(tableName, tInfo);
    navigator.clipboard.writeText(sql);
    setCopiedTable(tableName);
    setTimeout(() => setCopiedTable(null), 2000);
  };

  const handleRefreshComparison = async () => {
    setIsRefreshing(true);
    try {
      const sourcePayload = await preparePayload(source);
      const targetPayload = await preparePayload(target);

      // 1. DDL comparison
      const ddlRes = await fetch('http://localhost:8000/api/compare/ddl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourcePayload,
          target: targetPayload,
          scope: selectedObjects
        })
      });

      if (!ddlRes.ok) {
        const errData = await ddlRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'DDL Comparison failed');
      }
      const ddlData = await ddlRes.json();
      setDiffs(ddlData.diffs || []);
      setSourceSnap(ddlData.source_snap || null);
      setTargetSnap(ddlData.target_snap || null);

      // 2. Data comparison if enabled
      if (compareDataEnabled && selectedDataTables.length > 0) {
        const dataRes = await fetch('http://localhost:8000/api/compare/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: sourcePayload,
            target: targetPayload,
            tables: selectedDataTables,
            max_sample_rows: 50
          })
        });

        if (dataRes.ok) {
          const dataResponse = await dataRes.json();
          setDataDiff(dataResponse.data_diff || null);
        } else {
          setDataDiff(null);
        }
      } else {
        setDataDiff(null);
      }
    } catch (err) {
      alert("Re-Comparison Error: " + err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFetchSyncScript = async (
    safe = syncSafeMode, 
    withDdl = syncIncludeDdl, 
    withData = syncIncludeData,
    category: 'all' | 'tables' | 'views' | 'routines' | 'data' = modalCategoryFilter
  ) => {
    setSyncLoading(true);
    try {
      let effectiveDiffs = diffs;
      let effectiveData = withData ? dataDiff : null;
      let effectiveDdl = withDdl;
      let effectiveDataFlag = withData;

      if (category === 'tables') {
        effectiveDiffs = diffs.filter(d => ['table', 'column', 'index', 'sequence'].includes(d.object_type));
        effectiveData = null;
        effectiveDdl = true;
        effectiveDataFlag = false;
      } else if (category === 'views') {
        effectiveDiffs = diffs.filter(d => ['view', 'materialized_view'].includes(d.object_type));
        effectiveData = null;
        effectiveDdl = true;
        effectiveDataFlag = false;
      } else if (category === 'routines') {
        effectiveDiffs = diffs.filter(d => ['function', 'procedure', 'trigger'].includes(d.object_type));
        effectiveData = null;
        effectiveDdl = true;
        effectiveDataFlag = false;
      } else if (category === 'data') {
        effectiveDiffs = [];
        effectiveData = dataDiff;
        effectiveDdl = false;
        effectiveDataFlag = true;
      }

      const payload = {
        source_snap: sourceSnap,
        target_snap: targetSnap,
        diffs: effectiveDiffs,
        data_diff: effectiveData,
        safe_mode: safe,
        include_ddl: effectiveDdl,
        include_data: effectiveDataFlag
      };

      const [syncRes, rollbackRes] = await Promise.all([
        fetch('http://localhost:8000/api/generate-sync-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }),
        fetch('http://localhost:8000/api/generate-rollback-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      ]);

      if (!syncRes.ok) throw new Error("Failed to generate migration script");
      if (!rollbackRes.ok) throw new Error("Failed to generate rollback script");

      const syncData = await syncRes.json();
      const rollbackData = await rollbackRes.json();

      setSyncScript(syncData.sql);
      setSyncStats(syncData.stats);
      setRollbackScript(rollbackData.sql);
      setRollbackStats(rollbackData.stats);
    } catch (e) {
      alert("Error generating script: " + e);
    } finally {
      setSyncLoading(false);
    }
  };

  const openSyncModal = () => {
    setIsSyncModalOpen(true);
    setActiveScriptTab('migration');
    setModalCategoryFilter('all');
    handleFetchSyncScript(syncSafeMode, syncIncludeDdl, syncIncludeData, 'all');
  };

  const handleCopyScript = () => {
    const textToCopy = activeScriptTab === 'migration' ? syncScript : rollbackScript;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMigrationScript = () => {
    const isMigration = activeScriptTab === 'migration';
    const textToDownload = isMigration ? syncScript : rollbackScript;
    const catSuffix = modalCategoryFilter !== 'all' ? `_${modalCategoryFilter}` : '';
    const prefix = isMigration ? `forward_migration${catSuffix}` : `target_rollback${catSuffix}`;
    const blob = new Blob([textToDownload], { type: 'text/sql;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${prefix}_${new Date().toISOString().slice(0,10)}.sql`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadRollbackScript = () => {
    const catSuffix = modalCategoryFilter !== 'all' ? `_${modalCategoryFilter}` : '';
    const blob = new Blob([rollbackScript], { type: 'text/sql;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `target_pre_migration_backup${catSuffix}_${new Date().toISOString().slice(0,10)}.sql`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredDiffs = diffs.filter(d => {
    if (ddlFilter === 'all') return true;
    return d.object_type === ddlFilter;
  });

  const toggleTableExpand = (tableName: string) => {
    setExpandedTables(prev => ({
      ...prev,
      [tableName]: !prev[tableName]
    }));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-orange-500/30 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 shrink-0">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('setup')}>
            <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400">
              <ArrowRightLeft size={24} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">DB <span className="text-slate-500 font-normal">Compare</span></h1>
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
                  ? "When enabled, your connection strings, .pem keys, and processed data reside completely in RAM and are wiped as soon as the session closes. Nothing is saved to disk." 
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
                Connect your source and target databases to identify DDL differences and data drifts in real-time. 
                {zeroRetention && " In Zero-Retention Mode, no credentials or data will be saved to disk."}
              </p>
            </div>

            {/* Quick Actions Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-800/40 border border-slate-700/50 p-4 rounded-2xl">
              <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                <Database size={15} className="text-orange-400" />
                <span>Configure Source and Target Connections below</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTarget({
                      ...target,
                      provider: source.provider,
                      host: source.host,
                      port: source.port,
                      user: source.user,
                      pass: source.pass,
                      testStatus: 'idle'
                    });
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Copy host and credentials from Source to Target"
                >
                  <Copy size={13} />
                  Copy Source to Target
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const temp = { ...source };
                    setSource({ ...target });
                    setTarget(temp);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Swap Source and Target databases"
                >
                  <ArrowRightLeft size={13} />
                  Swap Databases
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSource(getEmptyState('local'));
                    setTarget(getEmptyState('local'));
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-red-500/10 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Reset both connections"
                >
                  <Trash2 size={13} />
                  Clear All
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              <ConnectionCard title="Source Database (Reference)" data={source} onChange={setSource} />
              <ConnectionCard title="Target Database (To Update)" data={target} onChange={setTarget} />
            </div>

            <div className="flex flex-col items-center pt-8 gap-4">
              <div className="flex flex-wrap items-center justify-center gap-4">
                <button 
                  type="button"
                  onClick={handleTestBoth}
                  disabled={isTestingBoth}
                  className="px-6 py-4 rounded-xl font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isTestingBoth ? <Loader2 size={18} className="animate-spin text-orange-400" /> : <RefreshCw size={18} />}
                  {isTestingBoth ? 'Testing Both Connections...' : 'Test Both Connections'}
                </button>

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
              </div>
              {!canCompare && (
                <p className="text-sm text-slate-500">
                  Please test both connections successfully before starting the comparison.
                </p>
              )}
            </div>
          </div>
        )}
        
        {view === 'preflight' && preflightData && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 py-8">
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-bold tracking-tight">Comparison Scope & Engine Configuration</h2>
              <p className="text-slate-400 max-w-2xl mx-auto">
                Discovered <span className="text-white font-medium">{preflightData.total_objects}</span> structural objects and <span className="text-white font-medium">{preflightData.common_tables?.length || 0}</span> common tables. 
                Select the structural and data layers to compare.
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              
              {/* DDL Scope */}
              <div className="md:col-span-2 bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
                <h3 className="font-medium flex items-center justify-between border-b border-slate-700/50 pb-3">
                  <span className="flex items-center gap-2 text-slate-200">
                    <Database size={16} className="text-orange-400" />
                    DDL Schema Objects
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Source (S) / Target (T)</span>
                </h3>
                
                <div className="grid sm:grid-cols-2 gap-3">
                  {SCHEMA_OBJECTS.map(obj => (
                    <label key={obj.key} className="flex flex-col justify-between p-3 rounded-lg border border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors bg-slate-900/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <input 
                            type="checkbox" 
                            checked={!!selectedObjects[obj.key]} 
                            onChange={e => setSelectedObjects({...selectedObjects, [obj.key]: e.target.checked})}
                            className="w-4 h-4 text-orange-500 bg-slate-900 border-slate-700 rounded focus:ring-orange-500 focus:ring-2"
                          />
                          <span className="text-sm font-medium text-slate-200">{obj.label}</span>
                        </div>
                        <span className="text-xs font-mono text-slate-400">
                          {preflightData.source_counts[obj.key] || 0} (S) / {preflightData.target_counts[obj.key] || 0} (T)
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 mt-1 pl-6.5">{obj.desc}</span>
                    </label>
                  ))}
                </div>

                {/* Data Drift Scope */}
                <div className="pt-4 border-t border-slate-700/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={compareDataEnabled} 
                        onChange={e => setCompareDataEnabled(e.target.checked)}
                        className="w-4 h-4 text-orange-500 bg-slate-900 border-slate-700 rounded focus:ring-orange-500 focus:ring-2"
                      />
                      <span className="font-medium text-sm text-slate-200 flex items-center gap-1.5">
                        <Table size={16} className="text-blue-400" />
                        Enable Data Drift Detection
                      </span>
                    </label>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      In-Memory MD5 Hashing
                    </span>
                  </div>

                  {compareDataEnabled && (
                    <div className="pl-6 space-y-2 text-xs">
                      <p className="text-slate-400">
                        Select common tables to analyze for row count drift, checksum mismatch, and exact record differences:
                      </p>
                      {preflightData.common_tables && preflightData.common_tables.length > 0 ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {preflightData.common_tables.map(tbl => {
                            const isSelected = selectedDataTables.includes(tbl);
                            return (
                              <button
                                key={tbl}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedDataTables(selectedDataTables.filter(t => t !== tbl));
                                  } else {
                                    setSelectedDataTables([...selectedDataTables, tbl]);
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-md border text-xs font-mono transition-colors ${
                                  isSelected 
                                    ? 'bg-orange-500/20 text-orange-400 border-orange-500/40' 
                                    : 'bg-slate-900/60 text-slate-500 border-slate-700 hover:text-slate-300'
                                }`}
                              >
                                {tbl}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-slate-500 italic">No common tables detected between source and target.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              {/* ETA & Summary */}
              <div className="flex flex-col justify-between p-6 bg-slate-800/40 border border-slate-700/50 rounded-2xl text-center">
                 <div className="space-y-4 pt-4">
                   <div className="p-4 bg-orange-500/10 rounded-full text-orange-400 w-16 h-16 mx-auto flex items-center justify-center">
                     <Clock size={32} />
                   </div>
                   <div>
                     <p className="text-slate-400 text-sm">Estimated Run Time</p>
                     <p className="text-4xl font-bold tracking-tight mt-1 text-slate-100">
                       ~{dynamicEta} <span className="text-xl text-slate-500 font-normal">sec</span>
                     </p>
                   </div>
                   <p className="text-xs text-slate-500">
                     Extraction, cryptographic hashing, and differing executed entirely in memory under Zero-Retention policy.
                   </p>
                 </div>

                 <div className="pt-6 border-t border-slate-700/50 space-y-2">
                   <div className="flex justify-between text-xs text-slate-400">
                     <span>DDL Objects:</span>
                     <span className="text-slate-200 font-mono">{preflightData.total_objects}</span>
                   </div>
                   <div className="flex justify-between text-xs text-slate-400">
                     <span>Data Tables:</span>
                     <span className="text-slate-200 font-mono">{compareDataEnabled ? selectedDataTables.length : 0}</span>
                   </div>
                 </div>
              </div>
              
            </div>
            
            <div className="flex justify-center gap-4 pt-4">
              <button 
                onClick={() => setView('setup')}
                className="px-6 py-3 rounded-xl font-medium border border-slate-700 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Back
              </button>
              <button 
                onClick={handleStartComparison}
                className="px-8 py-3 rounded-xl font-medium bg-orange-600 hover:bg-orange-500 transition-colors shadow-lg shadow-orange-500/20 flex items-center gap-2 cursor-pointer"
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
              <p className="text-slate-400">Extracting DDL schemas & hashing row data in-memory...</p>
              <div className="flex items-center justify-center gap-2 text-xs text-slate-500 mt-2">
                <Shield size={12} className="text-green-400" />
                Zero-Retention: No schemas or credentials written to disk
              </div>
            </div>
          </div>
        )}

        {view === 'results' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                  Comparison Results
                  {isRefreshing && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-normal bg-orange-500/10 text-orange-400 border border-orange-500/20">
                      <RefreshCw size={11} className="animate-spin text-orange-400" />
                      Refreshing...
                    </span>
                  )}
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/90 border border-slate-700/80 font-mono text-xs shadow-sm">
                    <span className="text-slate-400 font-sans font-medium">Source:</span>
                    <span className="text-orange-400 font-semibold">{source.host || '127.0.0.1'}:{source.port || '5432'}/{source.provider === 'oracle' ? source.oracleService : (source.dbName || 'source_db')}</span>
                    <span className="text-slate-500 font-sans mx-1">→</span>
                    <span className="text-slate-400 font-sans font-medium">Target:</span>
                    <span className="text-blue-400 font-semibold">{target.host || '127.0.0.1'}:{target.port || '5432'}/{target.provider === 'oracle' ? target.oracleService : (target.dbName || 'target_db')}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleRefreshComparison}
                  disabled={isRefreshing}
                  className="px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-sm font-medium text-slate-300 hover:text-white transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title="Re-run comparison between source and target databases"
                >
                  <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-orange-400' : 'text-slate-400'} />
                  {isRefreshing ? 'Re-comparing...' : 'Re-Compare'}
                </button>
                <button 
                  onClick={openSyncModal}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-orange-500/20 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <FileText size={16} />
                  Generate Sync Script
                </button>
                <button 
                  onClick={() => setView('setup')} 
                  className="px-3.5 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  &larr; Back
                </button>
              </div>
            </div>

            {/* Navigation Tabs (DDL vs Data) */}
            <div className="flex border-b border-slate-800 gap-2">
              <button
                onClick={() => setActiveResultTab('ddl')}
                className={`flex items-center gap-2 px-5 py-3 border-b-2 font-medium text-sm transition-colors cursor-pointer ${
                  activeResultTab === 'ddl'
                    ? 'border-orange-500 text-orange-400 bg-orange-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Settings2 size={16} />
                Structured DDL Differences
                <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${diffs.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                  {diffs.length}
                </span>
              </button>

              <button
                onClick={() => setActiveResultTab('data')}
                className={`flex items-center gap-2 px-5 py-3 border-b-2 font-medium text-sm transition-colors cursor-pointer ${
                  activeResultTab === 'data'
                    ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Table size={16} />
                Data Inconsistencies & Drift
                {dataDiff && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                    dataDiff.summary.tables_with_drift > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-green-500/10 text-green-400'
                  }`}>
                    {dataDiff.summary.tables_with_drift} Drifted
                  </span>
                )}
              </button>
            </div>
            
            {/* TAB 1: DDL DIFFERENCES */}
            {activeResultTab === 'ddl' && (
              <div className="bg-slate-800/40 rounded-2xl border border-slate-700/50 p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700/50 pb-4">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Filter size={14} className="text-slate-400 mr-1" />
                    <span className="text-slate-400 uppercase tracking-wider font-medium mr-1">Filter:</span>
                    {[
                      { key: 'all', label: 'All' },
                      { key: 'table', label: 'Tables' },
                      { key: 'column', label: 'Columns' },
                      { key: 'index', label: 'Indexes' },
                      { key: 'view', label: 'Views' },
                      { key: 'materialized_view', label: 'Mat Views' },
                      { key: 'function', label: 'Functions' },
                      { key: 'procedure', label: 'Procedures' },
                      { key: 'sequence', label: 'Sequences' },
                      { key: 'trigger', label: 'Triggers' },
                      { key: 'role', label: 'Users & Roles' },
                      { key: 'grant', label: 'Grants' }
                    ].map(cat => (
                      <button
                        key={cat.key}
                        onClick={() => setDdlFilter(cat.key)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                          ddlFilter === cat.key 
                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40' 
                            : 'bg-slate-900/60 text-slate-400 border border-slate-700 hover:text-white'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  
                  <span className="text-xs text-slate-400">
                    Showing <strong className="text-white">{filteredDiffs.length}</strong> of {diffs.length} differences
                  </span>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-lg">Object</th>
                        <th className="px-4 py-3">Source (Actual)</th>
                        <th className="px-4 py-3">Target (Actual)</th>
                        <th className="px-4 py-3">Drift Classification</th>
                        <th className="px-4 py-3 rounded-tr-lg text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {filteredDiffs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500 font-medium">
                            {diffs.length === 0 
                              ? 'No DDL differences found! Schemas are perfectly aligned.' 
                              : 'No differences match the selected filter.'}
                          </td>
                        </tr>
                      ) : (
                        filteredDiffs.map((diff, i) => (
                          <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-200">
                              <span className="font-mono text-xs text-orange-400 mr-2 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20 capitalize">
                                {diff.object_type.replace('_', ' ')}
                              </span>
                              {diff.name || diff.object}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-green-400">
                              {diff.source_actual}
                            </td>
                            <td className={`px-4 py-3 font-mono text-xs ${diff.status === 'missing_target' ? 'text-red-400' : diff.status === 'mismatch' ? 'text-amber-400' : 'text-slate-300'}`}>
                              {diff.target_actual}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {diff.status === 'missing_target' && (
                                <span className="px-2 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/30 font-medium">
                                  Missing in Target
                                </span>
                              )}
                              {diff.status === 'missing_source' && (
                                <span className="px-2 py-1 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/30 font-medium">
                                  Extra in Target (Missing in Source)
                                </span>
                              )}
                              {diff.status === 'mismatch' && (
                                <span className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium">
                                  Definition Mismatch
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleCopySingleDdl(diff, i)}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-sm"
                                title="Copy SQL statement to fix this difference"
                              >
                                {copiedDdlIdx === i ? (
                                  <>
                                    <Check size={13} className="text-green-400" />
                                    <span className="text-green-400 font-semibold">Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={13} className="text-slate-400" />
                                    <span>Copy SQL</span>
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2: DATA DRIFT */}
            {activeResultTab === 'data' && (
              <div className="space-y-6">
                {!dataDiff ? (
                  <div className="bg-slate-800/40 rounded-2xl border border-slate-700/50 p-8 text-center space-y-3">
                    <Table size={40} className="text-slate-600 mx-auto" />
                    <p className="text-slate-400 font-medium">Data comparison was not enabled for this run.</p>
                    <button 
                      onClick={() => setView('preflight')}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-orange-400 rounded-lg text-sm border border-slate-700 cursor-pointer"
                    >
                      Configure Scope & Enable Data Comparison
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Summary KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Tables Analyzed</span>
                        <p className="text-2xl font-bold mt-1 text-slate-100">{dataDiff.summary.tables_analyzed}</p>
                      </div>
                      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Tables in Sync</span>
                        <p className="text-2xl font-bold mt-1 text-green-400">{dataDiff.summary.tables_in_sync}</p>
                      </div>
                      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Tables with Drift</span>
                        <p className={`text-2xl font-bold mt-1 ${dataDiff.summary.tables_with_drift > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {dataDiff.summary.tables_with_drift}
                        </p>
                      </div>
                      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                        <span className="text-xs text-slate-400 uppercase tracking-wider">Row Discrepancies</span>
                        <p className="text-2xl font-bold mt-1 text-orange-400">
                          {dataDiff.summary.total_missing_target + dataDiff.summary.total_missing_source + dataDiff.summary.total_value_mismatches}
                        </p>
                      </div>
                    </div>

                    {/* Table-by-table cards */}
                    <div className="space-y-4">
                      {Object.keys(dataDiff.tables).map(tName => {
                        const tInfo = dataDiff.tables[tName];
                        const isExpanded = !!expandedTables[tName];
                        const isInSync = tInfo.status === 'in_sync';

                        return (
                          <div key={tName} className="bg-slate-800/40 border border-slate-700/50 rounded-2xl overflow-hidden">
                            <div 
                              onClick={() => toggleTableExpand(tName)}
                              className="p-5 flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-800/60 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                {isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
                                <div>
                                  <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                                    <Table size={16} className="text-blue-400" />
                                    {tName}
                                  </h4>
                                  <p className="text-xs text-slate-400 mt-0.5">
                                    PK: <span className="font-mono text-slate-300">{tInfo.primary_keys?.join(', ') || 'None'}</span> | Common Columns: <span className="text-slate-300">{tInfo.common_columns?.length || 0}</span>
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-4 text-xs">
                                <div className="text-right">
                                  <span className="text-slate-400">Rows:</span>{' '}
                                  <strong className="text-slate-200 font-mono">{tInfo.source_row_count}</strong> (S) / <strong className="text-slate-200 font-mono">{tInfo.target_row_count}</strong> (T)
                                </div>

                                <div className="hidden sm:block text-right">
                                  <span className="text-slate-400">MD5 Checksum:</span>{' '}
                                  <span className="font-mono text-[11px] text-slate-400">{tInfo.source_checksum?.slice(0, 8)}...</span>
                                </div>

                                <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                                  isInSync 
                                    ? 'bg-green-500/10 text-green-400 border-green-500/30' 
                                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                }`}>
                                  {isInSync ? '100% In Sync' : 'Drift Detected'}
                                </span>

                                {!isInSync && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopyTableDataSql(tName, tInfo);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                                    title={`Copy synchronization SQL for table ${tName}`}
                                  >
                                    {copiedTable === tName ? (
                                      <>
                                        <Check size={13} className="text-green-400" />
                                        <span className="text-green-400 font-semibold">Copied!</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy size={13} />
                                        <span>Copy Table SQL</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                              <div className="border-t border-slate-700/50 p-5 space-y-4 bg-slate-900/40 text-xs">
                                {isInSync ? (
                                  <div className="text-center py-4 text-green-400 flex items-center justify-center gap-2">
                                    <CheckCircle2 size={16} />
                                    Checksums and all rows in &ldquo;{tName}&rdquo; are identical across both databases.
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-800/60 border border-slate-700/80 rounded-xl">
                                      <div>
                                        <span className="text-slate-200 font-semibold text-xs">Table Synchronization SQL</span>
                                        <p className="text-[11px] text-slate-400 mt-0.5">Copy individual INSERT and UPDATE statements for table &ldquo;{tName}&rdquo;</p>
                                      </div>
                                      <button
                                        onClick={() => handleCopyTableDataSql(tName, tInfo)}
                                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                                      >
                                        {copiedTable === tName ? (
                                          <>
                                            <Check size={14} className="text-green-300" />
                                            <span className="font-semibold text-green-300">Copied Table SQL!</span>
                                          </>
                                        ) : (
                                          <>
                                            <Copy size={14} />
                                            <span>Copy Table Sync SQL</span>
                                          </>
                                        )}
                                      </button>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                      <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                                        <span className="text-slate-400">Missing in Target:</span>
                                        <p className="text-base font-bold text-red-400 mt-1">{tInfo.missing_in_target_count}</p>
                                      </div>
                                      <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                                        <span className="text-slate-400">Extra in Target (Missing Source):</span>
                                        <p className="text-base font-bold text-purple-400 mt-1">{tInfo.missing_in_source_count}</p>
                                      </div>
                                      <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                                        <span className="text-slate-400">Value Mismatches:</span>
                                        <p className="text-base font-bold text-amber-400 mt-1">{tInfo.mismatched_rows_count}</p>
                                      </div>
                                    </div>

                                    {/* Mismatched records table */}
                                    {tInfo.sample_mismatches && tInfo.sample_mismatches.length > 0 && (
                                      <div className="space-y-2">
                                        <h5 className="font-medium text-slate-300">Sample Row Mismatches:</h5>
                                        <div className="overflow-x-auto rounded-lg border border-slate-700">
                                          <table className="w-full text-left">
                                            <thead className="bg-slate-800 text-slate-400">
                                              <tr>
                                                <th className="px-3 py-2">Primary Key</th>
                                                <th className="px-3 py-2">Differing Column</th>
                                                <th className="px-3 py-2">Source Value</th>
                                                <th className="px-3 py-2">Target Value</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                              {tInfo.sample_mismatches.map((m: any, idx: number) => (
                                                <tr key={idx} className="hover:bg-slate-800/30">
                                                  <td className="px-3 py-2 font-mono text-slate-200">{JSON.stringify(m.pk)}</td>
                                                  <td className="px-3 py-2 font-mono text-amber-400">{m.diff_columns?.join(', ')}</td>
                                                  <td className="px-3 py-2 font-mono text-green-400">{JSON.stringify(m.source_values)}</td>
                                                  <td className="px-3 py-2 font-mono text-red-400">{JSON.stringify(m.target_values)}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}

                                    {/* Missing in Target sample */}
                                    {tInfo.sample_missing_in_target && tInfo.sample_missing_in_target.length > 0 && (
                                      <div className="space-y-2">
                                        <h5 className="font-medium text-slate-300">Sample Rows Missing in Target:</h5>
                                        <div className="overflow-x-auto rounded-lg border border-slate-700 p-2 bg-slate-900/60 font-mono text-[11px] text-slate-300 max-h-32">
                                          {tInfo.sample_missing_in_target.map((item: any, idx: number) => (
                                            <div key={idx} className="py-0.5 text-red-300">
                                              PK: {JSON.stringify(item.pk)} &rarr; Data: {JSON.stringify(item.row)}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sync Script Modal */}
        {isSyncModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    <FileText size={18} className="text-orange-400" />
                    Generated Synchronization Script
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Review and export migration statements or rollback backup to restore Target state.
                  </p>
                </div>
                <button 
                  onClick={() => setIsSyncModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <XCircle size={18} />
                </button>
              </div>

              {/* Options & Tab Controls */}
              <div className="px-6 py-3 bg-slate-800/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
                {/* Script Switcher */}
                <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-700/60">
                  <button
                    onClick={() => setActiveScriptTab('migration')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeScriptTab === 'migration'
                        ? 'bg-orange-600 text-white shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileText size={13} />
                    Migration Script
                  </button>
                  <button
                    onClick={() => setActiveScriptTab('rollback')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeScriptTab === 'rollback'
                        ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Undo2 size={13} />
                    Rollback Script
                  </button>
                </div>

                {/* Scope / Category Selector */}
                <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-700/60 gap-1">
                  {[
                    { key: 'all', label: 'All Objects' },
                    { key: 'tables', label: 'Tables Only' },
                    { key: 'views', label: 'Views Only' },
                    { key: 'routines', label: 'Routines Only' },
                    { key: 'data', label: 'Data Drift Only' }
                  ].map(cat => (
                    <button
                      key={cat.key}
                      onClick={() => {
                        const newCat = cat.key as 'all' | 'tables' | 'views' | 'routines' | 'data';
                        setModalCategoryFilter(newCat);
                        handleFetchSyncScript(syncSafeMode, syncIncludeDdl, syncIncludeData, newCat);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        modalCategoryFilter === cat.key
                          ? 'bg-slate-700 text-white shadow-sm font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Filters */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={syncSafeMode} 
                      onChange={e => {
                        const val = e.target.checked;
                        setSyncSafeMode(val);
                        handleFetchSyncScript(val, syncIncludeDdl, syncIncludeData, modalCategoryFilter);
                      }}
                      className="w-4 h-4 text-orange-500 rounded bg-slate-900 border-slate-700 cursor-pointer"
                    />
                    <span className="font-medium text-slate-200 flex items-center gap-1">
                      <Shield size={14} className={syncSafeMode ? 'text-green-400' : 'text-slate-500'} />
                      Safe Mode
                    </span>
                  </label>

                  {modalCategoryFilter === 'all' && (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={syncIncludeDdl} 
                          onChange={e => {
                            const val = e.target.checked;
                            setSyncIncludeDdl(val);
                            handleFetchSyncScript(syncSafeMode, val, syncIncludeData, modalCategoryFilter);
                          }}
                          className="w-4 h-4 text-orange-500 rounded bg-slate-900 border-slate-700 cursor-pointer"
                        />
                        <span className="text-slate-300">DDL</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={syncIncludeData} 
                          onChange={e => {
                            const val = e.target.checked;
                            setSyncIncludeData(val);
                            handleFetchSyncScript(syncSafeMode, syncIncludeDdl, val, modalCategoryFilter);
                          }}
                          className="w-4 h-4 text-orange-500 rounded bg-slate-900 border-slate-700 cursor-pointer"
                        />
                        <span className="text-slate-300">Data</span>
                      </label>
                    </>
                  )}
                </div>

                <div className="font-mono text-slate-400 text-[11px]">
                  Statements: <strong className={activeScriptTab === 'migration' ? 'text-orange-400' : 'text-emerald-400'}>
                    {activeScriptTab === 'migration' ? (syncStats?.statements_count ?? 0) : (rollbackStats?.statements_count ?? 0)}
                  </strong>
                </div>
              </div>

              {/* Code viewer */}
              <div className="flex-1 p-5 overflow-y-auto">
                {syncLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center space-y-3">
                    <Loader2 size={26} className="animate-spin text-orange-500" />
                    <p className="text-xs text-slate-400">Synthesizing SQL script...</p>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="px-4 py-2 bg-slate-950 border border-b-0 border-slate-800 rounded-t-xl text-xs text-slate-400 font-mono flex items-center justify-between">
                      <span className="text-slate-300">{activeScriptTab === 'migration' ? 'forward_migration.sql' : 'target_rollback_backup.sql'} ({(activeScriptTab === 'migration' ? syncScript : rollbackScript).split('\n').length} lines)</span>
                      <span className="text-[11px] text-slate-500">{activeScriptTab === 'migration' ? 'Target → Source Parity' : 'Target → Restore Original State'}</span>
                    </div>
                    <pre className="p-4 bg-slate-950 rounded-b-xl border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed select-all max-h-[52vh]">
                      {activeScriptTab === 'migration' ? syncScript : rollbackScript}
                    </pre>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/50">
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Shield size={14} className="text-green-400" />
                  Atomic transaction (<code className="text-slate-400">BEGIN; ... COMMIT;</code>)
                </p>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCopyScript}
                    disabled={syncLoading || !(activeScriptTab === 'migration' ? syncScript : rollbackScript)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy SQL'}
                  </button>

                  <button
                    onClick={handleDownloadRollbackScript}
                    disabled={syncLoading || !rollbackScript}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Download safety rollback backup script for Target"
                  >
                    <Undo2 size={14} />
                    Download Rollback (.sql)
                  </button>

                  <button
                    onClick={handleDownloadMigrationScript}
                    disabled={syncLoading || !syncScript}
                    className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-xl shadow-lg shadow-orange-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Download forward migration script"
                  >
                    <Download size={14} />
                    Download Migration (.sql)
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/50 shrink-0">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-mono bg-slate-800 px-2.5 py-1 rounded-md text-slate-300 border border-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Session: Active (RAM Only)
            </span>
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
  const isHardError = validationError?.includes('cannot be localhost');

  const isFilled = () => {
    if (!data.host || !data.port || !data.user || !data.pass) return false;
    if (data.provider === 'oracle' && !data.oracleService) return false;
    if (data.provider !== 'oracle' && !data.dbName) return false;
    if (data.method === 'ssh') {
      if (!data.sshHost || !data.sshUser || !data.sshKey) return false;
    }
    if (isHardError) return false;
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
      
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Connection failed');
      }
      onChange({ ...data, testStatus: type === 'full' ? 'success' : 'idle' });
    } catch (err) {
      console.error("Test connection error:", err);
      onChange({ ...data, testStatus: 'error' });
    }
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 relative group transition-all hover:bg-slate-800/60 shadow-lg h-full flex flex-col">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-amber-500 opacity-50 group-hover:opacity-100 transition-opacity" />
      
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium flex items-center gap-2 text-white">
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
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all cursor-pointer"
          >
            <option value="local">Local PostgreSQL</option>
            <option value="aws">AWS (RDS / Aurora)</option>
            <option value="azure">Azure Database</option>
            <option value="oracle">Oracle Cloud</option>
            <option value="supabase">Supabase</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Connection Method</label>
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button 
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors cursor-pointer ${data.method === 'direct' ? 'bg-slate-700 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
              onClick={() => onChange({...data, method: 'direct', testStatus: 'idle'})}
            >
              Direct
            </button>
            <button 
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors cursor-pointer ${data.method === 'ssh' ? 'bg-slate-700 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
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
                placeholder="127.0.0.1 or db.example.com" 
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
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-2.5 rounded-lg text-sm font-medium border border-slate-700 cursor-pointer"
          >
            {data.testStatus === 'testing_ssh' ? <><Loader2 size={16} className="animate-spin" /> Testing SSH...</> : 'Test SSH Tunnel'}
          </button>
        )}
        
        <button
          onClick={() => handleTestConnection('full')}
          disabled={!isFilled() || data.testStatus === 'testing_ssh' || data.testStatus === 'testing_db'}
          className={`w-full flex items-center justify-center gap-2 transition-colors py-2.5 rounded-lg text-sm font-medium cursor-pointer ${
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
