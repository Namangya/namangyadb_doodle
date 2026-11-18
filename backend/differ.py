def normalize_type(t: str) -> str:
    """Normalizes Postgres types to avoid spurious false positives."""
    if not t:
        return ""
    t_clean = t.lower().strip()
    if t_clean.startswith('character varying'):
        return t_clean.replace('character varying', 'varchar')
    if t_clean in ('integer', 'int'):
        return 'int4'
    if t_clean == 'bigint':
        return 'int8'
    if t_clean == 'smallint':
        return 'int2'
    if t_clean in ('boolean', 'bool'):
        return 'bool'
    if t_clean.startswith('timestamp without time zone'):
        return t_clean.replace('timestamp without time zone', 'timestamp')
    if t_clean.startswith('timestamp with time zone'):
        return t_clean.replace('timestamp with time zone', 'timestamptz')
    return t_clean

def compute_delta(source_snap, target_snap):
    """
    Compares two schema snapshots and returns a structured list of differences.
    Runs in O(1) time complexity for lookups using dicts/sets.
    """
    diffs = []

    def add_diff(obj_type, obj_name, source_act, target_act, status, raw_data=None):
        diffs.append({
            'object_type': obj_type,
            'name': obj_name,
            'object': f"{obj_type.replace('_', ' ').capitalize()}: {obj_name}",
            'source_actual': source_act,
            'target_actual': target_act,
            'status': status, # 'missing_target', 'missing_source', 'mismatch'
            'raw_data': raw_data or {}
        })

    # 1. Tables & Columns
    source_tables = source_snap.get('tables', {})
    target_tables = target_snap.get('tables', {})

    for t_name, t_data in source_tables.items():
        if t_name not in target_tables:
            add_diff('table', t_name, 'Exists', 'Missing', 'missing_target', {'table_data': t_data})
            continue
        
        # Columns
        t_target_cols = target_tables[t_name].get('columns', {})
        for c_name, c_data in t_data.get('columns', {}).items():
            if c_name not in t_target_cols:
                add_diff('column', f"{t_name}.{c_name}", f"Type: {c_data['type']}", "Missing", "missing_target", {'table': t_name, 'column': c_name, 'col_data': c_data})
            else:
                c_target_data = t_target_cols[c_name]
                s_type_norm = normalize_type(c_data.get('type', ''))
                t_type_norm = normalize_type(c_target_data.get('type', ''))
                
                if s_type_norm != t_type_norm:
                    add_diff('column', f"{t_name}.{c_name}", f"Type: {c_data['type']}", f"Type: {c_target_data['type']}", "mismatch", {'table': t_name, 'column': c_name, 'source_col': c_data, 'target_col': c_target_data, 'mismatch_kind': 'type'})
                elif c_data.get('default') != c_target_data.get('default'):
                    add_diff('column', f"{t_name}.{c_name}", f"Default: {c_data['default']}", f"Default: {c_target_data['default']}", "mismatch", {'table': t_name, 'column': c_name, 'source_col': c_data, 'target_col': c_target_data, 'mismatch_kind': 'default'})
                elif c_data.get('nullable') != c_target_data.get('nullable'):
                    add_diff('column', f"{t_name}.{c_name}", f"Nullable: {c_data['nullable']}", f"Nullable: {c_target_data['nullable']}", "mismatch", {'table': t_name, 'column': c_name, 'source_col': c_data, 'target_col': c_target_data, 'mismatch_kind': 'nullable'})
        
        for c_name in t_target_cols:
            if c_name not in t_data.get('columns', {}):
                add_diff('column', f"{t_name}.{c_name}", "Missing", f"Type: {t_target_cols[c_name]['type']}", "missing_source", {'table': t_name, 'column': c_name, 'col_data': t_target_cols[c_name]})

        # Indexes
        t_target_idxs = target_tables[t_name].get('indexes', {})
        for i_name, i_def in t_data.get('indexes', {}).items():
            if i_name not in t_target_idxs:
                add_diff('index', f"{t_name}.{i_name}", "Exists", "Missing", "missing_target", {'table': t_name, 'index_name': i_name, 'def': i_def})
            elif i_def.strip() != t_target_idxs[i_name].strip():
                add_diff('index', f"{t_name}.{i_name}", "Definition differs", "Definition differs", "mismatch", {'table': t_name, 'index_name': i_name, 'source_def': i_def, 'target_def': t_target_idxs[i_name]})
        for i_name in t_target_idxs:
            if i_name not in t_data.get('indexes', {}):
                add_diff('index', f"{t_name}.{i_name}", "Missing", "Exists", "missing_source", {'table': t_name, 'index_name': i_name, 'def': t_target_idxs[i_name]})

    for t_name, t_data in target_tables.items():
        if t_name not in source_tables:
            add_diff('table', t_name, 'Missing', 'Exists', 'missing_source', {'table_data': t_data})

    # 2. Views, Materialized Views, Functions, Procedures, Sequences, Triggers
    category_map = {
        'views': 'view',
        'materialized_views': 'materialized_view',
        'functions': 'function',
        'procedures': 'procedure',
        'sequences': 'sequence',
        'triggers': 'trigger'
    }

    for cat, singular in category_map.items():
        s_cat = source_snap.get(cat, {})
        t_cat = target_snap.get(cat, {})
        
        for obj_name, obj_def in s_cat.items():
            s_def_str = obj_def.get('def', '') if isinstance(obj_def, dict) else str(obj_def)
            if obj_name not in t_cat:
                add_diff(singular, obj_name, 'Exists', 'Missing', 'missing_target', {'def': obj_def})
            else:
                t_def_val = t_cat[obj_name]
                t_def_str = t_def_val.get('def', '') if isinstance(t_def_val, dict) else str(t_def_val)
                if s_def_str.strip() != t_def_str.strip():
                    add_diff(singular, obj_name, 'Definition differs', 'Definition differs', 'mismatch', {'source_def': obj_def, 'target_def': t_def_val})
        for obj_name in t_cat:
            if obj_name not in s_cat:
                add_diff(singular, obj_name, 'Missing', 'Exists', 'missing_source', {'def': t_cat[obj_name]})

    # 3. Roles / Users
    s_roles = source_snap.get('roles', {})
    t_roles = target_snap.get('roles', {})
    for r_name, r_data in s_roles.items():
        if r_name not in t_roles:
            add_diff('role', r_name, 'Exists', 'Missing', 'missing_target', {'role_data': r_data})
        else:
            t_data = t_roles[r_name]
            diff_attrs = []
            for attr in ['can_login', 'superuser', 'inherit', 'create_role', 'create_db']:
                if r_data.get(attr) != t_data.get(attr):
                    diff_attrs.append(f"{attr}: {r_data.get(attr)}")
            if diff_attrs:
                add_diff('role', r_name, ', '.join(diff_attrs), 'Different attributes', 'mismatch', {'source_role': r_data, 'target_role': t_data})
    for r_name, r_data in t_roles.items():
        if r_name not in s_roles:
            add_diff('role', r_name, 'Missing', 'Exists', 'missing_source', {'role_data': r_data})

    # 4. Grants / Privileges
    s_grants = source_snap.get('grants', {})
    t_grants = target_snap.get('grants', {})
    for g_key, g_data in s_grants.items():
        if g_key not in t_grants:
            add_diff('grant', g_key, 'Granted', 'Missing', 'missing_target', {'grant_data': g_data})
    for g_key, g_data in t_grants.items():
        if g_key not in s_grants:
            add_diff('grant', g_key, 'Missing', 'Granted', 'missing_source', {'grant_data': g_data})

    return diffs
