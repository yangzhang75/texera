"""cellqc's effective configuration, without Snakemake.

The defaults live in ``cellqc/rules/config.smk`` as a literal ``default_params``
dict.  A ``.smk`` file cannot be imported (it is not valid to run outside
Snakemake, and importing the cellqc package from it is explicitly forbidden
upstream), so the literal is read out of the shipped file with ``ast`` instead of
being copied here.  Copying it would add a fourth place that has to change when
a default changes -- upstream already tracks three and says so.
"""

import ast
import copy
from pathlib import Path

__all__ = ['default_config', 'merge_config', 'expected_doublet_rate']


def _config_smk():
    import cellqc
    return Path(cellqc.__file__).parent / 'rules' / 'config.smk'


def default_config():
    """cellqc's ``default_params``, read from the installed ``config.smk``.

    The file as a whole is not parseable Python -- it carries Snakemake
    directives such as ``wildcard_constraints:`` -- so the assignment is sliced
    out by balancing braces from ``default_params=`` and then literal-eval'd.
    Anything but a literal dict there is a change upstream would have to make
    deliberately, and it fails loudly here rather than silently defaulting.
    """
    path = _config_smk()
    text = path.read_text()
    marker = 'default_params'
    for start in _assignment_starts(text, marker):
        brace = text.find('{', start)
        if brace == -1:
            continue
        end = _matching_brace(text, brace)
        if end is None:
            continue
        try:
            return ast.literal_eval(text[brace:end + 1])
        except (ValueError, SyntaxError) as exc:
            raise RuntimeError(f'{path}: {marker} is not a literal dict ({exc})') from exc
    raise RuntimeError(f'no {marker} assignment found in {path}')


def _assignment_starts(text, name):
    """Offsets of top-level ``<name> =`` / ``<name>=`` assignments."""
    for i, line in enumerate(text.splitlines(True)):
        stripped = line.lstrip()
        if stripped.startswith(name) and stripped[len(name):].lstrip().startswith('='):
            if line[:len(line) - len(stripped)] == '':  # top level only
                yield sum(len(l) for l in text.splitlines(True)[:i])


def _matching_brace(text, open_at):
    """Index of the ``}`` closing the ``{`` at `open_at`, skipping strings."""
    depth, i, n = 0, open_at, len(text)
    quote = None
    while i < n:
        ch = text[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in '"\'':
            quote = ch
        elif ch == '#':
            i = text.find('\n', i)
            if i == -1:
                return None
            continue
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def merge_config(user=None):
    """Merge a user config under the defaults exactly as ``config.smk`` does.

    One level deep, and deliberately so for ``geneset``: naming a set replaces
    that set's definition outright rather than merging it key by key, because
    inheriting the default ``symbols`` under your own ``patterns`` would apply
    the prefix-free macaque fallback to a reference you had just described.
    """
    config = copy.deepcopy(default_config())
    for key, value in (user or {}).items():
        if isinstance(value, dict) and isinstance(config.get(key), dict):
            merged = dict(config[key])
            merged.update(value)
            config[key] = merged
        else:
            config[key] = value

    # The same three checks config.smk makes, with the same messages, so a bad
    # config fails here rather than halfway through a stage.
    if config['geneset'].get('mt') is None:
        raise ValueError(
            "config section 'geneset' must define 'mt': filterbycount.mito is a threshold on "
            'pct_counts_mt, so the mitochondrial gene set cannot be removed.'
            )
    if config['doublet']['decider'] not in config['doublet']['run']:
        raise ValueError(
            f"doublet.decider={config['doublet']['decider']!r} is not in "
            f"doublet.run={config['doublet']['run']!r}. The caller that removes cells "
            'must be one of the callers that runs.'
            )
    if config['ambient']['method'] in config['ambient']['compare']:
        print(
            f"Warning: ambient.method={config['ambient']['method']!r} also listed in "
            'ambient.compare; dropping the duplicate.', flush=True)
        config['ambient']['compare'] = [
            m for m in config['ambient']['compare'] if m != config['ambient']['method']]
    return config


def expected_doublet_rate(ncell, nreaction, rate, capacity):
    """Re-exported from cellqc so callers do not import two modules for one number."""
    from cellqc import qcutil
    return qcutil.expected_doublet_rate(ncell, nreaction, rate, capacity)
