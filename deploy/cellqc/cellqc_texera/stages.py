"""One function per cellqc stage, with the I/O each rule declares.

These mirror ``cellqc/rules/*.smk`` -- same relative output paths in the same
order, same ``params`` -- because the stage scripts index their outputs
positionally (``filterbycount`` writes its cell-count table to
``snakemake.output[5]``).  Everything is relative to `rundir`, which is the
equivalent of the Snakemake outdir, so the stage layout on disk is the layout
cellqc's own report code reads back.
"""

import os
from pathlib import Path

from .shim import run_py_script, run_r_script

__all__ = [
    'BAM_NAME', 'has_bam', 'ambient', 'barcoderank', 'nuclear_fraction', 'filterbycount',
    'doubletfinder', 'scdblfinder', 'filterdoublet', 'postproc', 'qcreport', 'samples_frame',
    ]

BAM_NAME = 'possorted_genome_bam.bam'


def has_bam(crdir):
    """Whether the nuclear-fraction stage applies, as ``config.smk`` decides it."""
    bam = os.path.join(crdir, BAM_NAME)
    return os.path.exists(bam) and os.path.exists(bam + '.bai')


def _filtered_h5(crdir):
    return os.path.join(crdir, 'filtered_feature_bc_matrix.h5')


def _raw_h5(crdir):
    return os.path.join(crdir, 'raw_feature_bc_matrix.h5')


def ambient(rundir, sample, config, crdir, rscript=None):
    """rules/ambient.smk -- SoupX (default) or DecontX; writes the corrected counts."""
    return run_r_script(
        'ambient.R', rundir,
        inputs=[('cellranger', os.path.abspath(crdir))],
        outputs=[
            ('h5', f'ambient/{sample}.h5'),
            ('contamination', f'ambient/{sample}_contamination.txt'),
            ('pdf', f'ambient/{sample}_ambient.pdf'),
            ('png', f'ambient/{sample}_ambient.png'),
            ],
        params=[
            ('sampleid', sample),
            ('method', config['ambient']['method']),
            ('compare', list(config['ambient']['compare'])),
            ('seed', config['seed']),
            ],
        rscript=rscript,
        )


def barcoderank(rundir, sample, crdir):
    """rules/barcoderank.smk -- the knee plot. Diagnostic; nothing downstream reads it."""
    return run_py_script(
        'barcoderank.py', rundir,
        inputs=[('raw', os.path.abspath(_raw_h5(crdir))),
                ('filtered', os.path.abspath(_filtered_h5(crdir)))],
        outputs=[
            ('pdf', f'barcoderank/{sample}_barcoderank.pdf'),
            ('png', f'barcoderank/{sample}_barcoderank.png'),
            ('knee', f'barcoderank/{sample}_knee.txt'),
            ],
        params=[('sampleid', sample)],
        )


def nuclear_fraction(rundir, sample, config, crdir, threads=1):
    """rules/nuclear_fraction.smk -- intronic fraction per cell, from the Cell Ranger BAM.

    Runs only for a sample with an indexed BAM, which is how upstream decides it:
    there is no skip flag, the DAG simply does not ask for it otherwise.  Threads
    default to 1 here rather than to the config's 12, because the stage's
    multiprocessing pool is spawned inside a Texera UDF worker process.
    """
    return run_py_script(
        'nuclear_fraction.py', rundir,
        inputs=[('cellranger', os.path.abspath(crdir)),
                ('filtered', os.path.abspath(_filtered_h5(crdir)))],
        outputs=[
            ('table', f'nuclear_fraction/{sample}.txt.gz'),
            ('pdf', f'nuclear_fraction/{sample}_nf_umi.pdf'),
            ('png', f'nuclear_fraction/{sample}_nf_umi.png'),
            ],
        params=[
            ('sampleid', sample),
            ('mito_geneset', config['geneset']['mt']),
            ('cbtag', config['nuclear_fraction']['cbtag']),
            ('retag', config['nuclear_fraction']['retag']),
            ('exontag', config['nuclear_fraction']['exontag']),
            ('introntag', config['nuclear_fraction']['introntag']),
            ],
        threads=threads,
        )


def filterbycount(rundir, sample, config, crdir):
    """rules/filterbycount.smk -- UMI / gene / mito filtering on the corrected counts.

    Output order is load-bearing: the script takes the violins from indices 1 and
    3 and the cell-count table from index 5.
    """
    return run_py_script(
        'filterbycount.py', rundir,
        inputs=[('corrected', f'ambient/{sample}.h5'),
                ('raw', os.path.abspath(_filtered_h5(crdir)))],
        outputs=[
            ('h5ad', f'filterbycount/{sample}.h5ad'),
            ('violin_before_pdf', f'filterbycount/{sample}_violin_before.pdf'),
            ('violin_before_png', f'filterbycount/{sample}_violin_before.png'),
            ('violin_after_pdf', f'filterbycount/{sample}_violin_after.pdf'),
            ('violin_after_png', f'filterbycount/{sample}_violin_after.png'),
            ('filter_ncell', f'filterbycount/{sample}_filter_ncell.txt'),
            ],
        params=[
            ('mincount', config['filterbycount']['mincount']),
            ('minfeature', config['filterbycount']['minfeature']),
            ('mito', config['filterbycount']['mito']),
            ('geneset', config['geneset']),
            ('sampleid', sample),
            ('seed', config['seed']),
            ],
        )


def doubletfinder(rundir, sample, config, nreaction=None, threads=None, rscript=None):
    """rules/doubletfinder.smk -- scores every cell; only the decider removes any."""
    doublet = config['doublet']
    return run_r_script(
        'doubletfinder.R', rundir,
        inputs=[('h5ad', f'filterbycount/{sample}.h5ad')],
        outputs=[
            ('metadata', f'doubletfinder/{sample}_metadata.txt.gz'),
            ('ratio', f'doubletfinder/{sample}_doublet_ratio.txt'),
            ('pANN_pdf', f'doubletfinder/{sample}_pANN.pdf'),
            ('pANN_png', f'doubletfinder/{sample}_pANN.png'),
            ('umap_pdf', f'doubletfinder/{sample}_umap.pdf'),
            ('umap_png', f'doubletfinder/{sample}_umap.png'),
            ],
        params=[
            ('sampleid', sample),
            ('findpK', bool(doublet['findpK'])),
            ('pK', doublet['pK']),
            ('nreaction', int(nreaction if nreaction is not None else doublet['nreaction'])),
            ('rate', doublet['rate']),
            ('capacity', doublet['capacity']),
            ('seed', config['seed']),
            ],
        threads=int(threads if threads is not None else doublet['numthreads']),
        rscript=rscript,
        )


def scdblfinder(rundir, sample, config, nreaction=None, rscript=None):
    """rules/scdblfinder.smk -- same expected doublet rate as DoubletFinder, by design."""
    doublet = config['doublet']
    return run_r_script(
        'scdblfinder.R', rundir,
        inputs=[('h5ad', f'filterbycount/{sample}.h5ad')],
        outputs=[
            ('metadata', f'scdblfinder/{sample}_metadata.txt.gz'),
            ('ratio', f'scdblfinder/{sample}_doublet_ratio.txt'),
            ('score_pdf', f'scdblfinder/{sample}_score.pdf'),
            ('score_png', f'scdblfinder/{sample}_score.png'),
            ],
        params=[
            ('sampleid', sample),
            ('nreaction', int(nreaction if nreaction is not None else doublet['nreaction'])),
            ('rate', doublet['rate']),
            ('capacity', doublet['capacity']),
            ('seed', config['seed']),
            ],
        rscript=rscript,
        )


def filterdoublet(rundir, sample, config):
    """rules/filterdoublet.smk -- applies the decider's calls, records concordance.

    The caller name is recovered from the metadata file's parent directory by the
    script itself, so those paths stay ``<caller>/{sample}_metadata.txt.gz``.
    """
    callers = list(config['doublet']['run'])
    return run_py_script(
        'filterdoublet.py', rundir,
        inputs=[
            ('h5ad', f'filterbycount/{sample}.h5ad'),
            ('metadata', [f'{caller}/{sample}_metadata.txt.gz' for caller in callers]),
            ],
        outputs=[
            ('h5ad', f'filterdoublet/{sample}.h5ad'),
            ('summary', f'result/{sample}_doublet_summary.txt'),
            ('concordance', f'result/{sample}_doublet_concordance.txt'),
            ],
        params=[
            ('sampleid', sample),
            ('callers', callers),
            ('decider', config['doublet']['decider']),
            ],
        )


def postproc(rundir, sample, with_nuclear_fraction=False):
    """rules/postproc.smk -- the final matrix a user takes away, in ``result/``."""
    inputs = [('h5ad', f'filterdoublet/{sample}.h5ad')]
    if with_nuclear_fraction:
        inputs.append(('nf', f'nuclear_fraction/{sample}.txt.gz'))
    return run_py_script(
        'postproc.py', rundir,
        inputs=inputs,
        outputs=[
            ('h5ad', f'result/{sample}.h5ad'),
            ('obs', f'result/{sample}_obs.txt.gz'),
            ('var', f'result/{sample}_var.txt.gz'),
            ],
        params=[('sampleid', sample)],
        )


def samples_frame(sample, crdir):
    """The one-row ``samples`` table the report stages expect.

    ``reportdata.cellranger_metrics`` joins ``sampledir`` with the per-sample
    ``cellranger`` column, so the pair has to be split the way a sample file
    would split it.
    """
    import pandas as pd
    crdir = os.path.abspath(crdir)
    frame = pd.DataFrame(
        [{'sample': sample, 'cellranger': os.path.basename(crdir), 'nreaction': 1}]
        ).set_index('sample', drop=False)
    return frame, str(Path(crdir).parent)


def qcreport(rundir, sample, config, crdir, nf_samples=(), callers=None):
    """rules/qcreport.smk -- the self-contained HTML report and ``result/metrics.csv``.

    Reads only what the earlier stages wrote, through ``cellqc/reportdata.py``,
    which is why the HTML and the metrics CSV cannot disagree with each other or
    with the run.
    """
    samples, sampledir = samples_frame(sample, crdir)
    return run_py_script(
        'qcreport.py', rundir,
        inputs=[],
        outputs=[('html', 'result/report.html'), ('metrics', 'result/metrics.csv')],
        params=[
            ('samples', samples),
            ('sampledir', sampledir),
            ('config', config),
            ('nf_samples', list(nf_samples)),
            ('callers', list(callers if callers is not None else config['doublet']['run'])),
            ],
        )
