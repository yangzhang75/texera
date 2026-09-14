#!/usr/bin/env python3
# vim: set noexpandtab tabstop=2 shiftwidth=2 softtabstop=-1 fileencoding=utf-8:

import sys
import scanpy as sc

infile='../addmetadata/EVAL_snRNA_no_enriched.h5ad'
width=5
height=5
bname='EVAL_snRNA_no_enriched'
# group=['majorclass', 'celltype', 'predictions']
groupby='majorclass'

indata=sc.read(infile)
sc.pp.normalize_total(indata)
sc.pp.log1p(indata)

indata.var['mito']=indata.var_names.str.startswith(('mt-', 'MT-'))
sc.pp.calculate_qc_metrics(indata, qc_vars=['mito'], inplace=True)

obskeys=['n_genes_by_counts'
	, 'log1p_n_genes_by_counts'
	, 'total_counts'
	, 'log1p_total_counts'
	, 'pct_counts_in_top_50_genes'
	, 'pct_counts_in_top_100_genes'
	, 'pct_counts_in_top_200_genes'
	, 'pct_counts_in_top_500_genes'
	, 'total_counts_mito'
	, 'log1p_total_counts_mito'
	, 'pct_counts_mito'
	]

keys=[
	'RHO',
	'ARR3',
	'VSX2',
	'PAX6',
	'ONECUT1',
	'RBPMS',
	'RLBP1',
	'GFAP',
	'RPE65',
	]

sc.set_figure_params(dpi_save=500, figsize=(width, height))
for key in obskeys:
	sc.pl.violin(indata, keys=[key], groupby=groupby, use_raw=False, stripplot=False, rotation=90, show=False, xlabel=groupby, save=f'{bname}_{key}.png')

for key in keys:
	sc.pl.violin(indata, keys=[key], groupby=groupby, use_raw=False, stripplot=False, rotation=90, show=False, xlabel=groupby, save=f'{bname}_{key}.png')
