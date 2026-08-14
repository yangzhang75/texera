# vim: set noexpandtab tabstop=2 shiftwidth=2 softtabstop=-1 fileencoding=utf-8:

import scanpy as sc
import anndata as ad
import pandas as pd

infile='../../download/query.h5ad'
metafile='../../scGPT_refactor/outdir_step2/predictions.csv'
outfile='EVAL_snRNA_no_enriched.h5ad'

def h5ad2addmetadata(indata, metadata):
	common=indata.obs.index.intersection(metadata.index)
	if len(common)<len(indata.obs.index):
		print(f"Warning: some cells are discarded due to not in metadata {len(common)} < {len(indata.obs.index)}.")
	if len(common)==0:
		print("Warning: empty cell barcode in metadata.")
		return indata

	indata=indata[common].copy()
	metadata=metadata.loc[common]
	header=metadata.columns.tolist()
	for h in header:
		indata.obs[h]=metadata[h].tolist()
	return indata

# 0. Read .h5ad
indata=sc.read_h5ad(infile)

# 2. Add nulcear fraction
metadata=pd.read_csv(metafile, header=0, index_col=0)
indata=h5ad2addmetadata(indata, metadata)

sc.write(filename=outfile, adata=indata)
