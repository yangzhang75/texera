#!/usr/bin/env bash
# Install everything the cellqc Texera workflow needs on a computing unit.
#
# Two environments, because cellqc is two languages:
#
#   1. An R environment (conda) carrying SoupX, DropletUtils, zellkonverter,
#      scDblFinder, Seurat and DoubletFinder. This is upstream's own
#      envs/cellqc.yaml stack; the workflow shells out to its Rscript. Its path
#      goes into the workflow's `rscript` parameter.
#   2. The Python interpreter the Texera PythonUDF workers already run under
#      (udf.conf `python.path`, or $UDF_PYTHON_PATH), which gets cellqc itself
#      plus pysam and the cellqc-texera runner. It must be that interpreter and
#      not the system python: a UDF import error otherwise looks like a code bug.
#
# DoubletFinder is a GitHub build. It is not on conda and cannot be -- bioconda
# forbids network access at install time -- so it is a separate step, exactly as
# upstream's README documents.
#
# Usage:
#   bash bootstrap_cellqc_env.sh [--prefix DIR] [--python PATH] [--src DIR] [--platform SUBDIR]
#
# On macOS arm64 pass --platform osx-64: bioconda's bioconductor-* packages have
# full osx-64 coverage but only partial osx-arm64, and the x86_64 build runs
# under Rosetta. On Linux the default (linux-64) is correct.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PREFIX="${HOME}/cellqc-env"
PYTHON="${UDF_PYTHON_PATH:-}"
SRC=""
PLATFORM=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--prefix) PREFIX="$2"; shift 2 ;;
		--python) PYTHON="$2"; shift 2 ;;
		--src) SRC="$2"; shift 2 ;;   # a cellqc checkout with this texera/ dir inside it
		--platform) PLATFORM="$2"; shift 2 ;;
		-h|--help) sed -n '2,30p' "$0"; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$PYTHON" ]]; then
	cat >&2 <<'MSG'
error: --python is required (or set UDF_PYTHON_PATH).

It must be the interpreter the Texera PythonUDF workers run, which is
`python.path` in common/config/src/main/resources/udf.conf, overridable with the
UDF_PYTHON_PATH environment variable on the computing unit. Installing into any
other interpreter changes nothing that the workflow can see.
MSG
	exit 2
fi
[[ -x "$PYTHON" ]] || { echo "error: $PYTHON is not executable" >&2; exit 2; }

MAMBA="$(command -v micromamba || command -v mamba || command -v conda || true)"
if [[ -z "$MAMBA" ]]; then
	cat >&2 <<'MSG'
error: no micromamba/mamba/conda on PATH.

The R side is conda-only: pip cannot install R packages, and building Seurat and
the Bioconductor stack from source takes far longer than fetching binaries.
Install micromamba (a single static binary, no root required):

  curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xvj bin/micromamba
MSG
	exit 2
fi

echo "=== 1/4  R environment: $PREFIX (via $MAMBA) ==="
PLATFORM_ARGS=()
[[ -n "$PLATFORM" ]] && PLATFORM_ARGS=(--platform "$PLATFORM")
# Upstream's envs/cellqc.yaml, minus the parts the Texera workflow does not use:
# snakemake (the operators are the scheduler), tectonic (no PDF slide deck), and
# the Python analysis stack (that lives in the UDF interpreter below).
"$MAMBA" create -y -p "$PREFIX" "${PLATFORM_ARGS[@]}" \
	-c conda-forge -c bioconda \
	'r-base>=4.4' 'r-seurat>=5' 'r-seuratobject>=5' r-matrix 'r-soupx>=1.6.2' \
	r-ggplot2 r-remotes r-rocr r-fields r-kernsmooth r-jsonlite \
	bioconductor-dropletutils bioconductor-singlecellexperiment \
	bioconductor-summarizedexperiment bioconductor-zellkonverter \
	bioconductor-scdblfinder bioconductor-celda

echo "=== 2/4  DoubletFinder (GitHub; not packaged for conda) ==="
"$PREFIX/bin/Rscript" -e \
	'options(repos=c(CRAN="https://cloud.r-project.org")); remotes::install_github("chris-mcginnis-ucsf/DoubletFinder", upgrade=FALSE)'

echo "=== 3/4  Python side, into $PYTHON ==="
# pysam is what nuclear_fraction reads the Cell Ranger BAM with; jinja2 renders
# the HTML report. cellqc is installed --no-deps on purpose: its declared
# dependency on snakemake is for the CLI, which the workflow does not use, and
# pulling it in would churn the UDF interpreter's environment for nothing.
"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install pysam jinja2 pyyaml click
if [[ -z "$SRC" ]]; then
	# PyPI's newest cellqc is 0.3.2; 0.3.3 is what introduced the configurable
	# `geneset` section, without which a reference that names its mitochondrial
	# genes bare (Ensembl Mmul_10) silently gets pct_counts_mt == 0 for every
	# cell. So the source comes from git, not pip.
	SRC="$(mktemp -d)/cellqc"
	echo "cloning cellqc into $SRC"
	git clone --depth 1 https://github.com/lijinbio/cellqc.git "$SRC"
	cp -R "$HERE/cellqc_texera" "$HERE/pyproject.toml" "$SRC/" 2>/dev/null || true
	CELLQC_TEXERA_SRC="$SRC"
else
	CELLQC_TEXERA_SRC="$SRC/texera"
fi
"$PYTHON" -m pip install --no-deps "$SRC"
"$PYTHON" -m pip install --no-deps "$CELLQC_TEXERA_SRC"

echo "=== 4/4  Verify ==="
"$PREFIX/bin/Rscript" -e 'suppressPackageStartupMessages({
	for (p in c("SoupX","DropletUtils","SingleCellExperiment","SummarizedExperiment",
		"zellkonverter","scDblFinder","Seurat","DoubletFinder","jsonlite"))
		library(p, character.only=TRUE)
	}); cat("R stack OK:", R.version.string, "\n")'
"$PYTHON" - <<'PY'
import importlib.metadata as md
import cellqc, cellqc_texera, pysam, jinja2
print('cellqc', md.version('cellqc'), '| cellqc-texera', md.version('cellqc-texera'))
print('stage scripts:', cellqc_texera.scripts_dir())
print('pysam', pysam.__version__, '| jinja2', jinja2.__version__)
PY

cat <<MSG

Done. Export this on the computing unit, and every imported CellQC workflow
runs as it arrives -- no one has to edit the \`rscript\` parameter:

    export CELLQC_RSCRIPT=$PREFIX/bin/Rscript

(The parameter is still there for pinning a single workflow to a different R.)

Memory note: the ambient stage loads the all-droplets raw matrix to build the
soup profile. On the 13,559-cell reference sample (2.1M raw barcodes) SoupX
peaks around 7 GB, so give the computing unit headroom above that.
MSG
