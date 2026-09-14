"""Run cellqc's Snakemake stage scripts outside Snakemake.

Each script under ``cellqc/scripts/`` is written against a ``snakemake`` object
(``snakemake.input['raw']``, ``snakemake@output[[1]]``, ...) and is deliberately
not standalone.  Rather than re-implementing the stages -- which would put a
second copy of every threshold and every plot in a second place -- this builds
the object the scripts already expect and runs them unmodified.  The numbers a
Texera workflow produces are therefore the numbers upstream cellqc produces,
and a cellqc upgrade is a reinstall rather than a re-port.

Two things the scripts assume and this preserves:

  * relative stage paths.  Snakemake runs with the working directory at the
    outdir, so every rule writes ``ambient/{s}.h5``, ``filterbycount/{s}.h5ad``
    and so on relative to it, and ``cellqc/reportdata.py`` reads them back the
    same way.  Stages run with ``cwd`` set to the run directory.
  * ``__file__``.  ``qcreport.py`` locates its Jinja templates as
    ``Path(__file__).parent / 'template'``, so the script is executed from the
    installed package rather than from a copy.
"""

import builtins
import contextlib
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path

__all__ = ['scripts_dir', 'Namedlist', 'Snakemake', 'run_py_script', 'run_r_script', 'pushd',
           'numba_safe_print']



# --- numba vs. Texera's console capture -------------------------------------
# Texera captures a UDF's output by replacing builtins.print with `wrapped_print`,
# a closure defined inside the body of its `replace_print.__enter__`. numba, at
# import time, registers a typing template for the print builtin
# (numba/core/typing/builtins.py: `@infer_global(print)`), and that registration
# asserts the object is reachable by name from its own module:
#
#     mod = sys.modules[val.__module__]
#     if getattr(mod, val.__name__) is not val:   # -> AttributeError
#
# A closure is not an attribute of its module, so `import numba` inside a UDF
# fails with
#   AttributeError: module 'core.util.console_message.replace_print'
#                   has no attribute 'wrapped_print'
# scanpy imports numba (scanpy.experimental.pp), so *every* cellqc stage that
# touches scanpy dies on its first import line. The same replacement is why a
# jitted function that calls print later fails to compile with
# "Untyped global name 'print'".
#
# Forwarding through a module-level function satisfies numba's check without
# giving up the capture: the operator console still receives everything the
# stages print, and any njit compilation inside a stage resolves the same object
# numba registered. Fixing it in Texera means making `wrapped_print` a
# module-level function; until that lands, this keeps the workflow runnable on a
# stock computing unit.
_CAPTURED_PRINT = []


def _print_via_texera(*args, **kwargs):
    """Module-level stand-in for whatever print Texera installed."""
    _CAPTURED_PRINT[-1](*args, **kwargs)


@contextlib.contextmanager
def numba_safe_print():
    """Make `builtins.print` reachable by name, so `import numba` works."""
    current = builtins.print
    if current is _print_via_texera:
        yield  # already installed by an enclosing stage
        return
    _CAPTURED_PRINT.append(current)
    builtins.print = _print_via_texera
    try:
        yield
    finally:
        builtins.print = current
        _CAPTURED_PRINT.pop()


def scripts_dir():
    """``cellqc/scripts/`` inside the installed cellqc package."""
    try:
        import cellqc
    except ImportError as exc:  # pragma: no cover - environment problem, not a bug
        raise RuntimeError(
            'The cellqc package is not importable in this Python environment. '
            'Install it into the interpreter the Python UDFs run under '
            '(UDF_PYTHON_PATH / udf.conf python.path): pip install cellqc'
            ) from exc
    return Path(cellqc.__file__).parent / 'scripts'


class Namedlist(list):
    """Snakemake's input/output object: a sequence that is also a mapping.

    ``snakemake.output[0]`` and ``snakemake.output['h5ad']`` are both used by the
    cellqc scripts, sometimes in the same script, so both have to work.  A named
    entry whose value is a list contributes each of its elements to the
    positional order, as Snakemake's own Namedlist does -- ``filterdoublet``
    passes one metadata file per doublet caller under a single name.
    """

    def __init__(self, entries):
        """`entries` is an ordered list of (name_or_None, value) pairs."""
        flat = []
        self._named = {}
        for name, value in entries:
            if isinstance(value, (list, tuple)):
                flat.extend(value)
            else:
                flat.append(value)
            if name is not None:
                self._named[name] = value
        super().__init__(flat)

    def __getitem__(self, key):
        if isinstance(key, str):
            return self._named[key]
        return super().__getitem__(key)

    def get(self, key, default=None):
        return self._named.get(key, default)

    def keys(self):
        return self._named.keys()

    def items(self):
        return self._named.items()

    def __getattr__(self, name):
        # Guarded against _named itself being absent, which would otherwise
        # recurse forever when the object is unpickled or partly built.
        if name.startswith('_'):
            raise AttributeError(name)
        try:
            return self.__dict__['_named'][name]
        except KeyError:
            raise AttributeError(name)


class Snakemake:
    """The subset of Snakemake's script API the cellqc stages actually touch."""

    def __init__(self, inputs, outputs, params, threads=1, wildcards=None, rule=''):
        self.input = Namedlist(inputs)
        self.output = Namedlist(outputs)
        self.params = Namedlist(params)
        self.threads = int(threads)
        self.wildcards = Namedlist(wildcards or [])
        self.log = Namedlist([])
        self.config = {}
        self.resources = Namedlist([])
        self.rule = rule


@contextlib.contextmanager
def pushd(path):
    prev = os.getcwd()
    os.chdir(str(path))
    try:
        yield
    finally:
        os.chdir(prev)


def _mkdirs(outputs):
    for _, value in outputs:
        for path in (value if isinstance(value, (list, tuple)) else [value]):
            parent = os.path.dirname(str(path))
            if parent:
                os.makedirs(parent, exist_ok=True)


def run_py_script(name, rundir, inputs, outputs, params, threads=1, wildcards=None):
    """Run ``cellqc/scripts/<name>`` with a `snakemake` object in scope.

    The script is executed by path so ``__file__`` points into the installed
    package (``qcreport.py`` resolves its templates from it), with ``__name__``
    set to ``'__main__'`` so the scripts' own ``if __name__ == '__main__'``
    entry point fires.
    """
    script = scripts_dir() / name
    if not script.exists():
        raise FileNotFoundError(f'{script} not found; is the installed cellqc missing package data?')
    sm = Snakemake(inputs, outputs, params, threads, wildcards, rule=name.rsplit('.', 1)[0])
    with numba_safe_print(), pushd(rundir):
        _mkdirs(outputs)
        # Injected via builtins rather than the module globals: Snakemake makes
        # `snakemake` a global of the script's own module, and runpy replaces
        # whatever globals dict we pass, so a builtins entry is what survives.
        import builtins
        builtins.snakemake = sm
        try:
            runpy.run_path(str(script), run_name='__main__')
        finally:
            del builtins.snakemake
    return {name: value for name, value in outputs if name is not None}


def run_r_script(name, rundir, inputs, outputs, params, threads=1, rscript=None, wildcards=None):
    """Run ``cellqc/scripts/<name>`` (an R stage) through the R-side shim.

    The R scripts read S4 slots (``snakemake@input[[1]]``), so the shim builds an
    S4 object from a JSON dump of the same four fields and then ``source()``s the
    stage script unmodified.
    """
    script = scripts_dir() / name
    if not script.exists():
        raise FileNotFoundError(f'{script} not found; is the installed cellqc missing package data?')
    rscript = rscript or os.environ.get('CELLQC_RSCRIPT') or 'Rscript'

    def positional(entries):
        """Flatten to a plain ordered list.

        The R stages index input and output positionally --
        ``snakemake@output[[3]]`` -- and R's ``[[i]]`` is by position even on a
        named list, so emitting names alongside the values would shift every
        index past the first. Names are carried on the Python side only, which is
        where they are used.
        """
        out = []
        for _nm, value in entries:
            out.extend(value if isinstance(value, (list, tuple)) else [value])
        return out

    payload = {
        'input': positional(inputs),
        'output': positional(outputs),
        'params': {nm: v for nm, v in params if nm is not None},
        'threads': int(threads),
        'wildcards': {nm: v for nm, v in (wildcards or []) if nm is not None},
        'script': str(script),
        }
    shim = Path(__file__).with_name('shim.R')
    with numba_safe_print(), pushd(rundir):
        _mkdirs(outputs)
        payload_path = os.path.abspath(f'.cellqc_texera_{Path(name).stem}.json')
        with open(payload_path, 'w') as fh:
            json.dump(payload, fh, indent=1)
        cmd = [str(rscript), '--vanilla', str(shim), payload_path]
        print(f'[cellqc-texera] {" ".join(cmd)}', flush=True)
        proc = subprocess.run(cmd, capture_output=True, text=True)
        sys.stdout.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        if proc.returncode != 0:
            raise RuntimeError(
                f'{name} failed (Rscript exit {proc.returncode}). '
                f'R stderr tail:\n{"".join(proc.stderr.splitlines(True)[-40:])}'
                )
    return {nm: value for nm, value in outputs if nm is not None}
