#!/usr/bin/env python3
# vim: set noexpandtab tabstop=2 shiftwidth=2 softtabstop=-1 fileencoding=utf-8:

import sys
import seaborn as sns
import scanpy as sc

infile='../addmetadata/EVAL_snRNA_no_enriched.h5ad'
width=5
height=5
bname='EVAL_snRNA_no_enriched'

x=sc.read_h5ad(infile)

if 'X_umap' not in x.obsm:
	print('Error: X_umap is missing. See scanpy.tl.umap()')
	sys.exit(-1)

sc.set_figure_params(dpi_save=500, figsize=(width, height))

for splitby in x.obs.columns:
	ncolor=len(x.obs[splitby].value_counts())
	if ncolor<100:
		sc.pl.umap(x, color=splitby, frameon=False, show=False, title=None, save=f"{bname}_umap_{splitby}_wolabel.png")
		sc.pl.umap(x, color=splitby, frameon=False, show=False, title=None, save=f"{bname}_umap_{splitby}_ondata.png",
			legend_loc='on data',
			legend_fontsize='xx-small',
			legend_fontweight='normal',
			)
		sc.pl.umap(x, color=splitby, frameon=False, show=False, title=None, save=f"{bname}_umap_{splitby}_fontline.png",
			legend_loc='on data',
			legend_fontsize='xx-small',
			legend_fontweight='normal',
			legend_fontoutline=1,
			)
	else:
		palette=sns.husl_palette(ncolor)
		sc.pl.umap(x, color=splitby, palette=palette, frameon=False, show=False, title=None, save=f"{bname}_umap_{splitby}_wolabel.png")
		sc.pl.umap(x, color=splitby, palette=palette, frameon=False, show=False, title=None, save=f"{bname}_umap_{splitby}_ondata.png") # duplicate
