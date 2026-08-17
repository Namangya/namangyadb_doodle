def compute_delta(source_snap, target_snap):
    """
    Compares two schema snapshots and returns a structured list of differences.
    Runs in O(1) time complexity for lookups using dicts/sets.
    """
    diffs = []

    def add_diff(obj_type, obj_name, source_act, target_act, status):
        diffs.append({
            'object': f"{obj_type.capitalize()}: {obj_name}",
            'source_actual': source_act,
            'target_actual': target_act,
            'status': status # 'missing_target', 'missing_source', 'mismatch'
        })

    # Tables
    for t_name, t_data in source_snap.get('tables', {}).items():
        if t_name not in target_snap.get('tables', {}):
            add_diff('table', t_name, 'Exists', 'Missing', 'missing_target')
            continue
        
        # Columns
        t_target_cols = target_snap['tables'][t_name]['columns']
        for c_name, c_data in t_data['columns'].items():
            if c_name not in t_target_cols:
                add_diff('column', f"{t_name}.{c_name}", f"Type: {c_data['type']}", "Missing", "missing_target")
            else:
                c_target_data = t_target_cols[c_name]
                if c_data['type'] != c_target_data['type']:
                    add_diff('column', f"{t_name}.{c_name}", f"Type: {c_data['type']}", f"Type: {c_target_data['type']}", "mismatch")
                elif c_data['default'] != c_target_data['default']:
                    add_diff('column', f"{t_name}.{c_name}", f"Default: {c_data['default']}", f"Default: {c_target_data['default']}", "mismatch")
                elif c_data['nullable'] != c_target_data['nullable']:
                    add_diff('column', f"{t_name}.{c_name}", f"Nullable: {c_data['nullable']}", f"Nullable: {c_target_data['nullable']}", "mismatch")
        
        for c_name in t_target_cols:
            if c_name not in t_data['columns']:
                add_diff('column', f"{t_name}.{c_name}", "Missing", f"Type: {t_target_cols[c_name]['type']}", "missing_source")

        # Indexes
        t_target_idxs = target_snap['tables'][t_name]['indexes']
        for i_name, i_def in t_data['indexes'].items():
            if i_name not in t_target_idxs:
                add_diff('index', f"{t_name}.{i_name}", "Exists", "Missing", "missing_target")
            elif i_def != t_target_idxs[i_name]:
                add_diff('index', f"{t_name}.{i_name}", "Definition differs", "Definition differs", "mismatch")
        for i_name in t_target_idxs:
            if i_name not in t_data['indexes']:
                add_diff('index', f"{t_name}.{i_name}", "Missing", "Exists", "missing_source")

    for t_name in target_snap.get('tables', {}):
        if t_name not in source_snap.get('tables', {}):
            add_diff('table', t_name, 'Missing', 'Exists', 'missing_source')

    # Views, Functions, Sequences, Triggers
    for cat in ['views', 'functions', 'sequences', 'triggers']:
        s_cat = source_snap.get(cat, {})
        t_cat = target_snap.get(cat, {})
        
        for obj_name, obj_def in s_cat.items():
            if obj_name not in t_cat:
                add_diff(cat[:-1], obj_name, 'Exists', 'Missing', 'missing_target')
            elif obj_def != t_cat[obj_name]:
                add_diff(cat[:-1], obj_name, 'Definition differs', 'Definition differs', 'mismatch')
        for obj_name in t_cat:
            if obj_name not in s_cat:
                add_diff(cat[:-1], obj_name, 'Missing', 'Exists', 'missing_source')

    return diffs
