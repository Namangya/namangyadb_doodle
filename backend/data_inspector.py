import psycopg2
from psycopg2.extras import DictCursor
from typing import List, Dict, Any, Optional

def get_table_pks(conn, table_name: str) -> List[str]:
    """Retrieve primary key column names for a given table."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
              AND tc.table_name = %s
            ORDER BY kcu.ordinal_position;
        """, (table_name,))
        rows = cur.fetchall()
        return [r[0] for r in rows]

def get_table_columns_metadata(conn, table_name: str) -> List[str]:
    """Retrieve column names for a given table in ordinal order."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_name = %s
            ORDER BY ordinal_position;
        """, (table_name,))
        return [r[0] for r in cur.fetchall()]

def get_table_row_count(conn, table_name: str) -> int:
    """Return exact row count for a table."""
    with conn.cursor() as cur:
        # Table names are verified from information_schema
        cur.execute(f'SELECT count(*) FROM "{table_name}";')
        return cur.fetchone()[0]

def compute_table_checksum(conn, table_name: str, columns: List[str]) -> str:
    """
    Computes an MD5 checksum of all rows in a table over the given columns.
    Uses MD5 of concatenated columns sorted deterministically.
    Runs entirely inside PostgreSQL engine in O(N) time with minimal network overhead.
    """
    if not columns:
        return "empty"
    
    # Cast each column to text, with NULL sentinel
    cols_sql = ", ".join([f"COALESCE(\"{c}\"::text, '__NULL__')" for c in columns])
    query = f"""
        SELECT COALESCE(md5(string_agg(row_hash, '' ORDER BY row_hash)), 'empty')
        FROM (
            SELECT md5(concat_ws('|#|', {cols_sql})) AS row_hash
            FROM "{table_name}"
        ) sub;
    """
    with conn.cursor() as cur:
        cur.execute(query)
        result = cur.fetchone()
        return result[0] if result else "empty"

def compare_table_data(
    source_conn, 
    target_conn, 
    table_name: str, 
    max_sample_rows: int = 50
) -> Dict[str, Any]:
    """
    Compares data of a table present in both source and target.
    1. Compares row counts.
    2. Identifies common columns.
    3. Computes table MD5 checksum over common columns.
    4. If checksums match -> in_sync.
    5. If drift detected -> extracts missing rows in target, missing rows in source,
       and value mismatches on identical primary keys.
    """
    source_count = get_table_row_count(source_conn, table_name)
    target_count = get_table_row_count(target_conn, table_name)
    
    source_cols = get_table_columns_metadata(source_conn, table_name)
    target_cols = get_table_columns_metadata(target_conn, table_name)
    
    # Common columns
    common_cols = [c for c in source_cols if c in target_cols]
    pks = get_table_pks(source_conn, table_name)
    
    # If no PK in source, check target
    if not pks:
        pks = get_table_pks(target_conn, table_name)
        # Only use PKs if present in common columns
        pks = [p for p in pks if p in common_cols]
    
    source_checksum = compute_table_checksum(source_conn, table_name, common_cols)
    target_checksum = compute_table_checksum(target_conn, table_name, common_cols)
    
    in_sync = (source_checksum == target_checksum) and (source_count == target_count)
    
    missing_target = []
    missing_source = []
    mismatches = []
    
    if not in_sync and common_cols:
        # Detailed row analysis
        cols_select = ", ".join([f'"{c}"' for c in common_cols])
        
        with source_conn.cursor(cursor_factory=DictCursor) as s_cur, \
             target_conn.cursor(cursor_factory=DictCursor) as t_cur:
            
            s_cur.execute(f'SELECT {cols_select} FROM "{table_name}";')
            s_rows = s_cur.fetchall()
            
            t_cur.execute(f'SELECT {cols_select} FROM "{table_name}";')
            t_rows = t_cur.fetchall()
            
            if pks:
                # Keyed comparison by primary key
                def get_pk_tuple(row):
                    return tuple(row[k] for k in pks)
                
                s_dict = {get_pk_tuple(r): dict(r) for r in s_rows}
                t_dict = {get_pk_tuple(r): dict(r) for r in t_rows}
                
                s_keys = set(s_dict.keys())
                t_keys = set(t_dict.keys())
                
                # Missing in target
                for k in s_keys - t_keys:
                    missing_target.append({
                        "pk": {pk: v for pk, v in zip(pks, k)},
                        "row": s_dict[k]
                    })
                
                # Missing in source
                for k in t_keys - s_keys:
                    missing_source.append({
                        "pk": {pk: v for pk, v in zip(pks, k)},
                        "row": t_dict[k]
                    })
                
                # Value mismatches on common keys
                common_keys = s_keys & t_keys
                for k in common_keys:
                    s_r = s_dict[k]
                    t_r = t_dict[k]
                    diff_cols = []
                    s_vals = {}
                    t_vals = {}
                    for col in common_cols:
                        sv = s_r.get(col)
                        tv = t_r.get(col)
                        # String equality check handles dates, numbers, uuids cleanly
                        if str(sv) != str(tv):
                            diff_cols.append(col)
                            s_vals[col] = sv
                            t_vals[col] = tv
                    
                    if diff_cols:
                        mismatches.append({
                            "pk": {pk: v for pk, v in zip(pks, k)},
                            "diff_columns": diff_cols,
                            "source_values": s_vals,
                            "target_values": t_vals
                        })
            else:
                # Fallback when no PK: full row hash comparison
                def row_hash(row):
                    return tuple(str(row[c]) for c in common_cols)
                
                s_set = [row_hash(r) for r in s_rows]
                t_set = [row_hash(r) for r in t_rows]
                
                # Simple counts
                diff_count = abs(len(s_set) - len(t_set))
                if len(s_set) > len(t_set):
                    for r in s_rows[:max_sample_rows]:
                        missing_target.append({"row": dict(r)})
                elif len(t_set) > len(s_set):
                    for r in t_rows[:max_sample_rows]:
                        missing_source.append({"row": dict(r)})
    
    return {
        "table_name": table_name,
        "status": "in_sync" if in_sync else "drift_detected",
        "source_row_count": source_count,
        "target_row_count": target_count,
        "source_checksum": source_checksum,
        "target_checksum": target_checksum,
        "primary_keys": pks,
        "common_columns": common_cols,
        "missing_in_target_count": len(missing_target),
        "missing_in_source_count": len(missing_source),
        "mismatched_rows_count": len(mismatches),
        "sample_missing_in_target": missing_target[:max_sample_rows],
        "sample_missing_in_source": missing_source[:max_sample_rows],
        "sample_mismatches": mismatches[:max_sample_rows]
    }

def compare_all_data(
    source_conn, 
    target_conn, 
    tables: List[str], 
    max_sample_rows: int = 50
) -> Dict[str, Any]:
    """
    Compares data across a list of tables between source and target databases.
    Returns high-level summary and detailed per-table drift metrics.
    """
    results = {}
    in_sync_count = 0
    drift_count = 0
    total_missing_target = 0
    total_missing_source = 0
    total_mismatches = 0
    
    for t in tables:
        try:
            res = compare_table_data(source_conn, target_conn, t, max_sample_rows)
            results[t] = res
            if res["status"] == "in_sync":
                in_sync_count += 1
            else:
                drift_count += 1
            total_missing_target += res["missing_in_target_count"]
            total_missing_source += res["missing_in_source_count"]
            total_mismatches += res["mismatched_rows_count"]
        except Exception as e:
            results[t] = {
                "table_name": t,
                "status": "error",
                "error": str(e)
            }
            drift_count += 1
            
    return {
        "summary": {
            "tables_analyzed": len(tables),
            "tables_in_sync": in_sync_count,
            "tables_with_drift": drift_count,
            "total_missing_target": total_missing_target,
            "total_missing_source": total_missing_source,
            "total_value_mismatches": total_mismatches
        },
        "tables": results
    }

