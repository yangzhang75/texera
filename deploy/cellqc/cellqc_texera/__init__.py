"""Run the cellqc QC pipeline stage by stage from Texera Python UDFs.

cellqc (https://github.com/lijinbio/cellqc) is a Snakemake workflow whose stages
are R and Python scripts written against Snakemake's ``snakemake`` object.  This
package supplies that object and the per-stage I/O declarations, so a Texera
Python UDF can run one cellqc stage per operator while the analysis code stays
upstream's, unmodified.

Typical use inside a UDF::

    from cellqc_texera import stages, merge_config
    config = merge_config({'filterbycount': {'mito': 10}})
    stages.ambient(rundir, sample, config, crdir, rscript=rscript)
"""

from .config import default_config, expected_doublet_rate, merge_config
from .shim import Namedlist, Snakemake, pushd, run_py_script, run_r_script, scripts_dir
from . import stages

__all__ = [
    'default_config', 'merge_config', 'expected_doublet_rate',
    'Namedlist', 'Snakemake', 'pushd', 'run_py_script', 'run_r_script', 'scripts_dir',
    'stages',
    ]
