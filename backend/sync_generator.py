from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

def quote_ident(ident: str) -> str:
    """Safely quote a SQL identifier."""
    clean = ident.replace('"', '""')
    return f'"{clean}"'

def format_val(val: Any) -> str:
    """Format a Python value into a SQL literal."""
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''")
    return f"'{s}'"

def generate_ddl_sync_script(
    source_snap: Dict[str, Any],
    target_snap: Dict[str, Any],
    diffs: List[Dict[str, Any]],
    safe_mode: bool = True
) -> str:
    """
    Generates PostgreSQL DDL migration statements to synchronize
    the Target database to match the Source database.
    """
    lines = []

    # 1. Roles / Users (Must come first so grants can reference them)
    role_lines = []
    source_roles = source_snap.get('roles', {})
    for d in diffs:
        if d.get('object_type') == 'role':
            r_name = d.get('name')
            status = d.get('status')
            raw = d.get('raw_data', {})
            r_data = raw.get('role_data') or source_roles.get(r_name, {})
            
            if status == 'missing_target' and r_data:
                opts = []
                opts.append("LOGIN" if r_data.get('can_login') else "NOLOGIN")
                if r_data.get('superuser'): opts.append("SUPERUSER")
                if r_data.get('create_db'): opts.append("CREATEDB")
                if r_data.get('create_role'): opts.append("CREATEROLE")
                if r_data.get('inherit'): opts.append("INHERIT")
                role_lines.append(f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = {format_val(r_name)}) THEN CREATE ROLE {quote_ident(r_name)} WITH {' '.join(opts)}; END IF; END $$;")
            elif status == 'missing_source':
                if safe_mode:
                    role_lines.append(f"-- [TARGET ONLY ROLE] Role '{r_name}' does not exist in Source.")
                    role_lines.append(f"-- DROP ROLE IF EXISTS {quote_ident(r_name)};")
                else:
                    role_lines.append(f"DROP ROLE IF EXISTS {quote_ident(r_name)};")
    if role_lines:
        lines.append("-- ===========================================")
        lines.append("-- 1. ROLES & USERS")
        lines.append("-- ===========================================")
        lines.extend(role_lines)
        lines.append("")

    # 2. Sequences
    seq_lines = []
    for d in diffs:
        if d.get('object_type') == 'sequence':
            name = d.get('name')
            if d.get('status') == 'missing_target':
                seq_lines.append(f"CREATE SEQUENCE IF NOT EXISTS {quote_ident(name)};")
            elif d.get('status') == 'missing_source':
                if safe_mode:
                    seq_lines.append(f"-- [TARGET ONLY SEQUENCE] Extra sequence: {name}")
                    seq_lines.append(f"-- DROP SEQUENCE IF EXISTS {quote_ident(name)};")
                else:
                    seq_lines.append(f"DROP SEQUENCE IF EXISTS {quote_ident(name)};")
    if seq_lines:
        lines.append("-- ===========================================")
        lines.append("-- 2. SEQUENCES")
        lines.append("-- ===========================================")
        lines.extend(seq_lines)
        lines.append("")

    # 3. Missing Tables
    table_lines = []
    source_tables = source_snap.get('tables', {})
    for d in diffs:
        if d.get('object_type') == 'table':
            t_name = d.get('name')
            if d.get('status') == 'missing_target' and t_name in source_tables:
                t_info = source_tables[t_name]
                cols = t_info.get('columns', {})
                pks = t_info.get('primary_keys', [])
                
                col_defs = []
                for c_name, c_data in cols.items():
                    col_str = f"    {quote_ident(c_name)} {c_data['type']}"
                    if c_data.get('default'):
                        col_str += f" DEFAULT {c_data['default']}"
                    if c_data.get('nullable') == 'NO':
                        col_str += " NOT NULL"
                    col_defs.append(col_str)
                    
                if pks:
                    pk_cols_str = ", ".join([quote_ident(pk) for pk in pks])
                    col_defs.append(f"    CONSTRAINT {quote_ident(t_name + '_pkey')} PRIMARY KEY ({pk_cols_str})")
                    
                body = ",\n".join(col_defs)
                table_lines.append(f"CREATE TABLE IF NOT EXISTS {quote_ident(t_name)} (\n{body}\n);")
            elif d.get('status') == 'missing_source':
                if safe_mode:
                    table_lines.append(f"-- [TARGET ONLY TABLE] '{t_name}' does not exist in Source.")
                    table_lines.append(f"-- Uncomment below to drop (WARNING: Permanent data loss):")
                    table_lines.append(f"-- DROP TABLE IF EXISTS {quote_ident(t_name)} CASCADE;")
                else:
                    table_lines.append(f"DROP TABLE IF EXISTS {quote_ident(t_name)} CASCADE;")
    if table_lines:
        lines.append("-- ===========================================")
        lines.append("-- 3. TABLES")
        lines.append("-- ===========================================")
        lines.extend(table_lines)
        lines.append("")

    # 4. Columns & Constraints
    col_lines = []
    for d in diffs:
        if d.get('object_type') == 'column':
            name_parts = d.get('name', '').split('.')
            if len(name_parts) == 2:
                t_name, c_name = name_parts
                status = d.get('status')
                raw = d.get('raw_data', {})
                
                if status == 'missing_target':
                    col_data = raw.get('col_data') or source_tables.get(t_name, {}).get('columns', {}).get(c_name, {})
                    type_str = col_data.get('type', 'text')
                    stmt = f"ALTER TABLE {quote_ident(t_name)} ADD COLUMN IF NOT EXISTS {quote_ident(c_name)} {type_str}"
                    if col_data.get('default'):
                        stmt += f" DEFAULT {col_data['default']}"
                    if col_data.get('nullable') == 'NO':
                        stmt += " NOT NULL"
                    stmt += ";"
                    col_lines.append(stmt)
                    
                elif status == 'missing_source':
                    if safe_mode:
                        col_lines.append(f"-- [TARGET ONLY COLUMN] '{t_name}.{c_name}' does not exist in Source.")
                        col_lines.append(f"-- Uncomment below to drop:")
                        col_lines.append(f"-- ALTER TABLE {quote_ident(t_name)} DROP COLUMN IF EXISTS {quote_ident(c_name)};")
                    else:
                        col_lines.append(f"ALTER TABLE {quote_ident(t_name)} DROP COLUMN IF EXISTS {quote_ident(c_name)};")
                        
                elif status == 'mismatch':
                    kind = raw.get('mismatch_kind')
                    s_col = raw.get('source_col') or source_tables.get(t_name, {}).get('columns', {}).get(c_name, {})
                    if kind == 'type':
                        new_type = s_col.get('type')
                        col_lines.append(f"ALTER TABLE {quote_ident(t_name)} ALTER COLUMN {quote_ident(c_name)} TYPE {new_type} USING {quote_ident(c_name)}::{new_type};")
                    elif kind == 'default':
                        new_def = s_col.get('default')
                        if new_def:
                            col_lines.append(f"ALTER TABLE {quote_ident(t_name)} ALTER COLUMN {quote_ident(c_name)} SET DEFAULT {new_def};")
                        else:
                            col_lines.append(f"ALTER TABLE {quote_ident(t_name)} ALTER COLUMN {quote_ident(c_name)} DROP DEFAULT;")
                    elif kind == 'nullable':
                        if s_col.get('nullable') == 'NO':
                            col_lines.append(f"ALTER TABLE {quote_ident(t_name)} ALTER COLUMN {quote_ident(c_name)} SET NOT NULL;")
                        else:
                            col_lines.append(f"ALTER TABLE {quote_ident(t_name)} ALTER COLUMN {quote_ident(c_name)} DROP NOT NULL;")
    if col_lines:
        lines.append("-- ===========================================")
        lines.append("-- 4. COLUMNS & CONSTRAINTS")
        lines.append("-- ===========================================")
        lines.extend(col_lines)
        lines.append("")

    # 5. Indexes
    idx_lines = []
    # First, emit secondary indexes for newly created tables
    for d in diffs:
        if d.get('object_type') == 'table' and d.get('status') == 'missing_target':
            t_name = d.get('name')
            t_indexes = source_tables.get(t_name, {}).get('indexes', {})
            t_pks = source_tables.get(t_name, {}).get('primary_keys', [])
            for i_name, i_def in t_indexes.items():
                if i_name.endswith('_pkey') or any(i_name == f"{t_name}_{pk}_key" for pk in t_pks):
                    continue
                if i_def:
                    clean_def = i_def.strip()
                    if not clean_def.endswith(';'):
                        clean_def += ';'
                    idx_lines.append(clean_def)

    for d in diffs:
        if d.get('object_type') == 'index':
            name_parts = d.get('name', '').split('.')
            idx_name = name_parts[1] if len(name_parts) == 2 else d.get('name')
            status = d.get('status')
            raw = d.get('raw_data', {})
            
            if status == 'missing_target':
                idx_def = raw.get('def', '')
                if idx_def:
                    if not idx_def.strip().endswith(';'):
                        idx_def = idx_def.strip() + ';'
                    idx_lines.append(idx_def)
            elif status == 'missing_source':
                if safe_mode:
                    idx_lines.append(f"-- [TARGET ONLY INDEX] '{idx_name}' does not exist in Source.")
                    idx_lines.append(f"-- DROP INDEX IF EXISTS {quote_ident(idx_name)};")
                else:
                    idx_lines.append(f"DROP INDEX IF EXISTS {quote_ident(idx_name)};")
            elif status == 'mismatch':
                idx_lines.append(f"DROP INDEX IF EXISTS {quote_ident(idx_name)};")
                s_def = raw.get('source_def', '')
                if s_def:
                    if not s_def.strip().endswith(';'):
                        s_def = s_def.strip() + ';'
                    idx_lines.append(s_def)
    if idx_lines:
        lines.append("-- ===========================================")
        lines.append("-- 5. INDEXES")
        lines.append("-- ===========================================")
        lines.extend(idx_lines)
        lines.append("")

    # 6. Views
    view_lines = []
    source_views = source_snap.get('views', {})
    for d in diffs:
        if d.get('object_type') == 'view':
            v_name = d.get('name')
            status = d.get('status')
            if status in ('missing_target', 'mismatch') and v_name in source_views:
                v_def = source_views[v_name].strip()
                if not v_def.endswith(';'):
                    v_def += ';'
                if status == 'mismatch':
                    view_lines.append(f"DROP VIEW IF EXISTS {quote_ident(v_name)} CASCADE;")
                view_lines.append(f"CREATE OR REPLACE VIEW {quote_ident(v_name)} AS\n{v_def}")
            elif status == 'missing_source':
                if safe_mode:
                    view_lines.append(f"-- [TARGET ONLY VIEW] '{v_name}' does not exist in Source.")
                    view_lines.append(f"-- DROP VIEW IF EXISTS {quote_ident(v_name)};")
                else:
                    view_lines.append(f"DROP VIEW IF EXISTS {quote_ident(v_name)};")
    if view_lines:
        lines.append("-- ===========================================")
        lines.append("-- 6. VIEWS")
        lines.append("-- ===========================================")
        lines.extend(view_lines)
        lines.append("")

    # 7. Materialized Views
    mv_lines = []
    source_mvs = source_snap.get('materialized_views', {})
    for d in diffs:
        if d.get('object_type') == 'materialized_view':
            mv_name = d.get('name')
            status = d.get('status')
            if status in ('missing_target', 'mismatch') and mv_name in source_mvs:
                mv_def = source_mvs[mv_name].strip()
                if not mv_def.endswith(';'):
                    mv_def += ';'
                mv_lines.append(f"DROP MATERIALIZED VIEW IF EXISTS {quote_ident(mv_name)};")
                mv_lines.append(f"CREATE MATERIALIZED VIEW {quote_ident(mv_name)} AS\n{mv_def}")
            elif status == 'missing_source':
                if safe_mode:
                    mv_lines.append(f"-- [TARGET ONLY MATVIEW] '{mv_name}' does not exist in Source.")
                    mv_lines.append(f"-- DROP MATERIALIZED VIEW IF EXISTS {quote_ident(mv_name)};")
                else:
                    mv_lines.append(f"DROP MATERIALIZED VIEW IF EXISTS {quote_ident(mv_name)};")
    if mv_lines:
        lines.append("-- ===========================================")
        lines.append("-- 7. MATERIALIZED VIEWS")
        lines.append("-- ===========================================")
        lines.extend(mv_lines)
        lines.append("")

    # 8. Functions
    fn_lines = []
    source_fns = source_snap.get('functions', {})
    for d in diffs:
        if d.get('object_type') == 'function':
            fn_sig = d.get('name')
            status = d.get('status')
            if status in ('missing_target', 'mismatch') and fn_sig in source_fns:
                fn_def = source_fns[fn_sig].strip()
                if not fn_def.endswith(';'):
                    fn_def += ';'
                fn_lines.append(fn_def)
            elif status == 'missing_source':
                if safe_mode:
                    fn_lines.append(f"-- [TARGET ONLY FUNCTION] '{fn_sig}' does not exist in Source.")
                    fn_lines.append(f"-- DROP FUNCTION IF EXISTS {fn_sig};")
                else:
                    fn_lines.append(f"DROP FUNCTION IF EXISTS {fn_sig};")
    if fn_lines:
        lines.append("-- ===========================================")
        lines.append("-- 8. FUNCTIONS")
        lines.append("-- ===========================================")
        lines.extend(fn_lines)
        lines.append("")

    # 9. Procedures
    proc_lines = []
    source_procs = source_snap.get('procedures', {})
    for d in diffs:
        if d.get('object_type') == 'procedure':
            p_sig = d.get('name')
            status = d.get('status')
            if status in ('missing_target', 'mismatch') and p_sig in source_procs:
                p_def = source_procs[p_sig].strip()
                if not p_def.endswith(';'):
                    p_def += ';'
                proc_lines.append(p_def)
            elif status == 'missing_source':
                if safe_mode:
                    proc_lines.append(f"-- [TARGET ONLY PROCEDURE] '{p_sig}' does not exist in Source.")
                    proc_lines.append(f"-- DROP PROCEDURE IF EXISTS {p_sig};")
                else:
                    proc_lines.append(f"DROP PROCEDURE IF EXISTS {p_sig};")
    if proc_lines:
        lines.append("-- ===========================================")
        lines.append("-- 9. STORED PROCEDURES")
        lines.append("-- ===========================================")
        lines.extend(proc_lines)
        lines.append("")

    # 10. Triggers
    trig_lines = []
    source_trigs = source_snap.get('triggers', {})
    for d in diffs:
        if d.get('object_type') == 'trigger':
            trig_name = d.get('name')
            status = d.get('status')
            if status in ('missing_target', 'mismatch') and trig_name in source_trigs:
                t_obj = source_trigs[trig_name]
                t_def = t_obj.get('def') if isinstance(t_obj, dict) else str(t_obj)
                t_table = t_obj.get('table') if isinstance(t_obj, dict) else None
                if status == 'mismatch' and t_table:
                    trig_lines.append(f"DROP TRIGGER IF EXISTS {quote_ident(trig_name)} ON {quote_ident(t_table)};")
                if not t_def.strip().endswith(';'):
                    t_def = t_def.strip() + ';'
                trig_lines.append(t_def)
            elif status == 'missing_source':
                if safe_mode:
                    trig_lines.append(f"-- [TARGET ONLY TRIGGER] '{trig_name}' does not exist in Source.")
                    trig_lines.append(f"-- DROP TRIGGER IF EXISTS {quote_ident(trig_name)} ON <table_name>;")
                else:
                    trig_lines.append(f"DROP TRIGGER IF EXISTS {quote_ident(trig_name)} ON <table_name>;")
    if trig_lines:
        lines.append("-- ===========================================")
        lines.append("-- 10. TRIGGERS")
        lines.append("-- ===========================================")
        lines.extend(trig_lines)
        lines.append("")

    # 11. Grants & Privileges
    grant_lines = []
    for d in diffs:
        if d.get('object_type') == 'grant':
            g_data = d.get('raw_data', {}).get('grant_data', {})
            status = d.get('status')
            if status == 'missing_target' and g_data:
                g_priv = g_data.get('privilege')
                g_obj = g_data.get('object_name')
                g_user = g_data.get('grantee')
                grant_lines.append(f"GRANT {g_priv} ON {quote_ident(g_obj)} TO {quote_ident(g_user)};")
            elif status == 'missing_source' and g_data:
                g_priv = g_data.get('privilege')
                g_obj = g_data.get('object_name')
                g_user = g_data.get('grantee')
                if safe_mode:
                    grant_lines.append(f"-- [TARGET ONLY PRIVILEGE] {g_priv} ON {g_obj} TO {g_user}")
                    grant_lines.append(f"-- REVOKE {g_priv} ON {quote_ident(g_obj)} FROM {quote_ident(g_user)};")
                else:
                    grant_lines.append(f"REVOKE {g_priv} ON {quote_ident(g_obj)} FROM {quote_ident(g_user)};")
    if grant_lines:
        lines.append("-- ===========================================")
        lines.append("-- 11. GRANTS & PRIVILEGES")
        lines.append("-- ===========================================")
        lines.extend(grant_lines)
        lines.append("")

    return "\n".join(lines)

def generate_data_sync_script(
    data_diff: Dict[str, Any],
    safe_mode: bool = True
) -> str:
    """
    Generates SQL INSERT, UPDATE, and DELETE statements to synchronize
    row-level data between Source and Target.
    """
    lines = []
    tables = data_diff.get('tables', {})
    if not tables:
        return ""
    
    lines.append("-- ===========================================")
    lines.append("-- DATA SYNCHRONIZATION")
    lines.append("-- ===========================================")
    
    for t_name, t_info in tables.items():
        if t_info.get('status') != 'drift_detected':
            continue
        
        lines.append(f"\n-- Table: {t_name}")
        common_cols = t_info.get('common_columns', [])
        
        # 1. Missing rows in target -> INSERT
        missing_target = t_info.get('sample_missing_in_target', [])
        if missing_target:
            lines.append(f"-- Insert missing rows into {quote_ident(t_name)} ({len(missing_target)} sample rows)")
            for item in missing_target:
                row = item.get('row', {})
                cols_to_insert = [c for c in common_cols if c in row]
                cols_sql = ", ".join([quote_ident(c) for c in cols_to_insert])
                vals_sql = ", ".join([format_val(row[c]) for c in cols_to_insert])
                lines.append(f"INSERT INTO {quote_ident(t_name)} ({cols_sql}) VALUES ({vals_sql});")
                
        # 2. Mismatched rows -> UPDATE
        mismatches = t_info.get('sample_mismatches', [])
        if mismatches:
            lines.append(f"-- Update mismatched rows in {quote_ident(t_name)} ({len(mismatches)} sample rows)")
            for item in mismatches:
                pk_dict = item.get('pk', {})
                s_vals = item.get('source_values', {})
                if not pk_dict or not s_vals:
                    continue
                
                set_clauses = [f"{quote_ident(c)} = {format_val(v)}" for c, v in s_vals.items()]
                where_clauses = [f"{quote_ident(k)} = {format_val(v)}" for k, v in pk_dict.items()]
                
                lines.append(f"UPDATE {quote_ident(t_name)} SET {', '.join(set_clauses)} WHERE {' AND '.join(where_clauses)};")
                
        # 3. Missing rows in source (Target extra rows) -> DELETE
        missing_source = t_info.get('sample_missing_in_source', [])
        if missing_source:
            lines.append(f"-- Extra rows present only in Target {quote_ident(t_name)} ({len(missing_source)} sample rows)")
            for item in missing_source:
                pk_dict = item.get('pk', {})
                if pk_dict:
                    where_clauses = [f"{quote_ident(k)} = {format_val(v)}" for k, v in pk_dict.items()]
                    del_stmt = f"DELETE FROM {quote_ident(t_name)} WHERE {' AND '.join(where_clauses)};"
                    if safe_mode:
                        lines.append(f"-- {del_stmt}")
                    else:
                        lines.append(del_stmt)

    return "\n".join(lines)

def generate_sync_script(
    source_snap: Optional[Dict[str, Any]] = None,
    target_snap: Optional[Dict[str, Any]] = None,
    diffs: Optional[List[Dict[str, Any]]] = None,
    data_diff: Optional[Dict[str, Any]] = None,
    safe_mode: bool = True,
    include_ddl: bool = True,
    include_data: bool = True
) -> Dict[str, Any]:
    """
    Main orchestration entrypoint for generating migration scripts.
    Returns generated SQL string and detailed statistics.
    """
    sections = []
    
    header = [
        "-- ====================================================================",
        "-- DB Compare Migration & Synchronization Script",
        f"-- Generated at: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "-- Direction: Target Database -> Synchronized to Match Source Database",
        f"-- Safe Mode: {'ENABLED (Destructive operations commented)' if safe_mode else 'DISABLED'}",
        "-- Zero-Retention Architecture: In-Memory Engine",
        "-- ====================================================================",
        "",
        "BEGIN;",
        ""
    ]
    sections.append("\n".join(header))
    
    ddl_sql = ""
    if include_ddl and source_snap and target_snap and diffs:
        ddl_sql = generate_ddl_sync_script(source_snap, target_snap, diffs, safe_mode)
        if ddl_sql.strip():
            sections.append(ddl_sql)
            
    data_sql = ""
    if include_data and data_diff:
        data_sql = generate_data_sync_script(data_diff, safe_mode)
        if data_sql.strip():
            sections.append(data_sql)
            
    footer = [
        "",
        "-- ====================================================================",
        "-- Verification and Commit",
        "-- ====================================================================",
        "COMMIT;",
        ""
    ]
    sections.append("\n".join(footer))
    
    full_sql = "\n".join(sections)
    statements_count = len([line for line in full_sql.splitlines() if line.strip() and not line.strip().startswith('--')])
    
    return {
        "sql": full_sql,
        "stats": {
            "safe_mode": safe_mode,
            "statements_count": statements_count,
            "has_ddl": bool(ddl_sql.strip()),
            "has_data": bool(data_sql.strip())
        }
    }
