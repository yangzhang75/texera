"""One-line summaries of each stage, read back from what the stage wrote.

Every cellqc stage that feeds the report also writes a small stats file, and
``cellqc/reportdata.py`` reads those rather than recomputing anything.  The same
files are the honest source for an operator's status line in Texera: the number
shown in the workflow is then the number in the report, not a second estimate of
it.
"""

import gzip
import os

__all__ = ['stage_message']


def _tsv(rundir, relpath):
    import pandas as pd
    path = os.path.join(rundir, relpath)
    if not os.path.exists(path):
        return None
    frame = pd.read_csv(path, sep='\t', header=0)
    return frame if len(frame) else None


def _first(frame, column, default=None):
    if frame is None or column not in frame.columns:
        return default
    return frame[column].iloc[0]


def _gz_rows(path):
    if not os.path.exists(path):
        return None
    with gzip.open(path, 'rt') as handle:
        return max(0, sum(1 for _ in handle) - 1)


def stage_message(stage, rundir, sample, config=None):
    """A short, factual status line for `stage`.  Never raises: a summary that
    cannot be read reports that, rather than failing a stage that succeeded."""
    try:
        return _message(stage, rundir, sample, config or {})
    except Exception as exc:  # pragma: no cover - a summary must not fail a stage
        return f'{stage} finished ({type(exc).__name__} while summarising: {exc})'


def _message(stage, rundir, sample, config):
    if stage == 'ambient':
        table = _tsv(rundir, f'ambient/{sample}_contamination.txt')
        if table is None:
            return 'no ambient correction applied (method=none)'
        import pandas as pd
        applied = table[table['applied'].astype(str).str.upper().isin(['TRUE', 'T'])]
        row = (applied if len(applied) else table).iloc[0]
        # counts_removed_frac is NaN for a comparison-only method: it estimated
        # contamination but never touched the counts.
        removed = row.get('counts_removed_frac')
        parts = [
            f"{row['method']}: mean contamination {float(row['contamination_mean']):.4f}",
            f'{100 * float(removed):.2f}% of counts removed' if pd.notna(removed) else 'counts unchanged',
            f"{int(row['ncell'])} cells",
            ]
        others = table[~table.index.isin(applied.index)] if len(applied) else table.iloc[0:0]
        if len(others):
            parts.append('compared: ' + ', '.join(
                f"{r['method']} {float(r['contamination_mean']):.4f}" for _, r in others.iterrows()))
        return '; '.join(parts)

    if stage == 'barcoderank':
        table = _tsv(rundir, f'barcoderank/{sample}_knee.txt')
        return (
            f"{int(_first(table, 'n_called_cells', 0))} cells called by Cell Ranger of "
            f"{int(_first(table, 'n_raw_barcodes', 0))} barcodes; knee "
            f"{_first(table, 'knee_total')}, inflection {_first(table, 'inflection_total')} "
            f"(diagnostic only -- cellqc does not re-call cells)"
            )

    if stage == 'filterbycount':
        table = _tsv(rundir, f'filterbycount/{sample}_filter_ncell.txt')
        if table is None:
            return 'filterbycount finished'
        row = table.iloc[0]
        return (
            f"{int(row['ncell_before'])} -> {int(row['ncell_after'])} cells "
            f"({int(row['ncell_removed'])} removed: {int(row['fail_mincount'])} by "
            f"mincount>={row['mincount']}, {int(row['fail_minfeature'])} by "
            f"minfeature>={row['minfeature']}, {int(row['fail_mito'])} by "
            f"mito<={row['mito']}%; criteria overlap). "
            f"mt genes {int(row.get('n_mt_genes', 0))} matched by {row.get('mt_matched_by')}"
            )

    if stage in ('doubletfinder', 'scdblfinder'):
        table = _tsv(rundir, f'{stage}/{sample}_doublet_ratio.txt')
        if table is None:
            return f'{stage} finished'
        row = table.iloc[0]
        return (
            f"{int(row['ndoublet'])}/{int(row['ncell_before'])} cells called doublet "
            f"({100 * int(row['ndoublet']) / int(row['ncell_before']):.2f}%); expected rate "
            f"{float(row['doubletratio']):.4f}, nExp {int(row['nExp'])}; homotypic doublets not modelled"
            )

    if stage == 'filterdoublet':
        summary = _tsv(rundir, f'result/{sample}_doublet_summary.txt')
        conc = _tsv(rundir, f'result/{sample}_doublet_concordance.txt')
        if summary is None:
            return 'filterdoublet finished'
        decider = str(_first(summary, 'decider', ''))
        row = summary.iloc[0]
        text = (
            f"{int(row['ncell_before'])} -> {int(row['ncell_after'])} cells; removed by "
            f"{decider}. " + '; '.join(
                f"{r['caller']} {int(r['ndoublet'])} ({100 * float(r['frac_doublet']):.2f}%)"
                for _, r in summary.iterrows())
            )
        if conc is not None:
            text += '. ' + '; '.join(
                f"{r['caller_a']} vs {r['caller_b']} Cohen kappa={float(r['kappa']):.3f}"
                for _, r in conc.iterrows()) + ' (consistency, not accuracy)'
        return text

    if stage == 'nuclear_fraction':
        import numpy as np
        import pandas as pd
        path = os.path.join(rundir, f'nuclear_fraction/{sample}.txt.gz')
        if not os.path.exists(path):
            return 'skipped: no indexed Cell Ranger BAM for this sample'
        frame = pd.read_csv(path, sep='\t', header=0)
        nf = pd.to_numeric(frame['nuclear_fraction'], errors='coerce')
        return (
            f'{len(frame)} barcodes; median nuclear fraction '
            f'{np.nanmedian(nf):.4f} (q25 {np.nanquantile(nf, 0.25):.4f}, '
            f'q75 {np.nanquantile(nf, 0.75):.4f}), {int(nf.isna().sum())} without usable reads. '
            'Reported, never filtered on'
            )

    if stage == 'postproc':
        ncell = _gz_rows(os.path.join(rundir, f'result/{sample}_obs.txt.gz'))
        ngene = _gz_rows(os.path.join(rundir, f'result/{sample}_var.txt.gz'))
        h5ad = os.path.join(rundir, f'result/{sample}.h5ad')
        size = os.path.getsize(h5ad) / 1e6 if os.path.exists(h5ad) else 0
        return (
            f'final matrix result/{sample}.h5ad: {ncell} cells x {ngene} genes '
            f'({size:.0f} MB), barcodes prefixed with the sample ID'
            )

    if stage == 'qcreport':
        import pandas as pd
        metrics = os.path.join(rundir, 'result/metrics.csv')
        html = os.path.join(rundir, 'result/report.html')
        parts = []
        if os.path.exists(metrics):
            frame = pd.read_csv(metrics)
            parts.append(f'metrics.csv {frame.shape[0]} sample(s) x {frame.shape[1]} metrics')
        if os.path.exists(html):
            parts.append(f'report.html {os.path.getsize(html) / 1e6:.2f} MB (figures inlined)')
        return '; '.join(parts) or 'qcreport finished'

    return f'{stage} finished'
