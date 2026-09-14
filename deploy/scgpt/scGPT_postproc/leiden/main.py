#!/usr/bin/env python3
# vim: set noexpandtab tabstop=2 shiftwidth=2 softtabstop=-1 fileencoding=utf-8:

import sys
import scanpy as sc
import seaborn as sns

infile='../addmetadata/EVAL_snRNA_no_enriched.h5ad'
seed=12345
resolution=0.4
bname='EVAL_snRNA_no_enriched'
outfile='EVAL_snRNA_no_enriched.h5ad'

indata=sc.read_h5ad(infile)

if any(k not in indata.obsm for k in ['X_scVI', 'X_umap']):
	print(f'Error: X_scVI and/or X_umap is not found. See `scrnascvih5ad.sh`')
	sys.exit(-1)

sc.pp.neighbors(indata, use_rep='X_scVI', random_state=seed)
sc.tl.leiden(indata, resolution=resolution, random_state=seed, key_added='leiden')
indata.obs['leiden']=indata.obs['leiden'].astype('str')

sc.set_figure_params(dpi_save=500, figsize=(5, 5))
keys=['leiden', 'majorclass', 'celltype', 'predictions']
for key in keys:
	ncolor=len(indata.obs[key].value_counts())
	if ncolor<100:
		sc.pl.umap(indata, color=key, frameon=False, show=False, save=f'{bname}_umap_{key}_wolabel.png')
		sc.pl.umap(indata, color=key, frameon=False, show=False, save=f'{bname}_umap_{key}_ondata.png'
			, legend_loc='on data', legend_fontsize='xx-small', legend_fontweight='normal'
			)
	else:
		sc.set_figure_params(dpi_save=150, figsize=(5, 5))
		palette=sns.husl_palette(ncolor)
		sc.pl.umap(indata, color=key, palette=palette, frameon=False, show=False, save=f'{bname}_umap_{key}_wolabel.png')
		sc.pl.umap(indata, color=key, palette=palette, frameon=False, show=False, save=f'{bname}_umap_{key}_ondata.png') ## duplicate for a consistent two images

sc.write(filename=outfile, adata=indata)
