"""Verify recorded edit inputs as well as each immutable output and prompt."""
import hashlib
from pathlib import Path


def validate_edit_references(filename, row, manifest, prompts, source):
    expected = prompts.get('requests', {}).get(filename, {}).get('referenceOriginals', [])
    actual = row.get('referenceImages', [])
    if actual != expected:
        raise ValueError('Painting edit inputs differ from its immutable request: ' + filename)
    seen = set()
    for reference in actual:
        name = reference.get('filename', '')
        original = manifest.get(name)
        path = source / name
        if (not name or Path(name).name != name or name == filename or name in seen
                or not original or reference.get('sha256') != original.get('sha256')
                or not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != reference['sha256']):
            raise ValueError('Painting edit input lost its original fingerprint: ' + filename)
        seen.add(name)
