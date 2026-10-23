"""Compact, bounded storage for daily STRATA audit snapshots."""
import gzip
import json
from pathlib import Path

def store_history_snapshot(history_dir, session_date, snapshot, keep=252):
    """Write a compressed snapshot atomically and retain the latest `keep` sessions."""
    history_dir = Path(history_dir)
    history_dir.mkdir(parents=True, exist_ok=True)
    target = history_dir / f'{session_date}.json.gz'
    payload = json.dumps(snapshot, separators=(',', ':'), ensure_ascii=False, default=str).encode('utf-8')
    tmp = target.with_suffix(target.suffix + '.tmp')
    tmp.write_bytes(gzip.compress(payload, mtime=0))
    tmp.replace(target)
    for legacy in history_dir.glob('????-??-??.json'):
        legacy.unlink(missing_ok=True)
    files = sorted(history_dir.glob('????-??-??.json.gz'))
    if keep >= 0:
        for old in files[:-keep] if keep else files:
            old.unlink(missing_ok=True)
    return target
