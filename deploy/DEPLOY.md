# Deploying this branch

`p_canvas-deploy` carries the Parameterized Canvas ("P canvas"), the `FileParameter`
operator, and the scGPT pipeline sources. This file is what someone standing in front of
a fresh machine needs; it exists because every item below cost hours the first time it
was missing.

## What is in the branch

| | |
|---|---|
| `frontend/src/app/workspace/component/parameterized-canvas/` | the page itself |
| `frontend/src/app/workspace/service/parameterization/` | reads and writes the config |
| `frontend/src/app/common/formly/expose-property-wrapper/` | the tick box on the property panel |
| `frontend/src/app/common/formly/editable-label-wrapper/` | rename/hide a title in place |
| `common/workflow-operator/.../source/parameter/` | the `FileParameter` operator |
| `sql/updates/30.sql` | schema change |
| `deploy/scgpt/` | the scGPT pipeline's Python sources |
| `deploy/cellqc/` | what the cellqc workflow needs installed |

## What is deliberately NOT in the branch

Model weights and datasets — about 411 MB, over GitHub's file limit and permanent bloat
in a repo that does not need them:

- `download/reference_model/best_model.pt` — the scGPT reference model
- `download/query.h5ad`
- `scGPT_postproc/{addmetadata,leiden}/EVAL_snRNA_no_enriched.h5ad`

Copy these onto the target machine separately and keep the same directory layout under
whatever you point `SCGPT_HOME` at.

The CellQC **workflow** is likewise not here: it is a workflow, not code, and it travels
as an exported JSON that anyone imports through the UI. `deploy/cellqc/` is only what has
to be installed for that JSON to run. The Python virtualenv (2.2 GB) is likewise rebuilt
from `deploy/scgpt/requirements-frozen.txt`, never committed.

## Bringing the stack up

```bash
export UDF_PYTHON_PATH=/path/to/venv312/bin/python
export STORAGE_JDBC_USERNAME=texera STORAGE_JDBC_PASSWORD=password
export USER_JWT_TOKEN="$(cat /path/to/token)"
bash bin/local-dev.sh up
```

All three are required.

**`USER_JWT_TOKEN` must be set on every start.** `bin/local-dev/main.sh` supplies a
default for every other dev variable but has no mention of this one, so it is lost on
each redeploy — and nothing looks wrong at startup. All services report running, login
works, operator metadata is complete. The failure only surfaces when a Python UDF reads
a dataset: `DatasetFileDocument` presigns a download and raises
`ValueError: JWT token is required but not set in environment variables`.

Confirm it reached the engine rather than only your shell:

```bash
ps eww -p $(lsof -nP -iTCP:8085 -sTCP:LISTEN -t) | tr ' ' '\n' | grep USER_JWT_TOKEN
```

**If the container services each time out at 90s, check Docker first.** A stopped daemon
shows up as postgres/minio/lakefs/lakekeeper/litellm all failing to come up, which reads
like a Texera fault. `docker info` will fail on the socket. Start Docker, wait for
`docker info` to answer, and run `up` again.

**After changing backend Scala, restart the whole stack**, not the service you think owns
the change. Adding `FileParameter` and restarting only `texera-web` left five other
services running the previous jar, and the operator silently produced zero rows. sbt
project names are capitalised: `sbt "WorkflowOperator/compile"` — a lowercase name fails
with `Not a valid key` and still exits 0.

## The scGPT Python environment

Python 3.12. The pinned set that works is in `requirements-frozen.txt`; the versions that
matter are `torch==2.3.0`, `torchtext==0.18.0`, `scgpt==0.2.4`. A newer torch cannot load
torchtext's native library, so do not float these.

```bash
python3.12 -m venv venv312
venv312/bin/pip install -r deploy/scgpt/requirements-frozen.txt
```

Two directories have to be importable by the UDF workers. Put a `.pth` file in the venv's
`site-packages` naming both, one per line:

```
/path/to/texera/amber/src/main/python
/path/to/scGPT_refactor
```

The second is what makes `from utils import *` resolve inside the pipeline scripts. With
`UDF_PYTHON_PATH` unset, `udf.conf` falls back to an empty path and workers die on
`No module named 'loguru'`.

## The cellqc workflow's environment

The cellqc workflow (`CellQC` — Cell Ranger output in, a QC'd `.h5ad` out) is ten
Python UDFs, but four of cellqc's stages are R and there is no Python equivalent
that produces the same numbers. So it needs **two** environments. Neither is
committed — an R conda prefix and a 2 GB venv do not belong in a git repo. What is
here is the declaration of what to install, plus the workflow's own source:

| | |
|---|---|
| `deploy/cellqc/environment-r.yaml` | the R stack (conda). Its `Rscript` is what `CELLQC_RSCRIPT` points at. |
| `deploy/cellqc/requirements.txt` | the Python side, installed into the **UDF interpreter** |
| `deploy/cellqc/cellqc_texera/` | the runner: it builds the `snakemake` object each upstream stage script expects and runs that script verbatim, so the numbers cannot drift and an upgrade is a `pip install` |
| `deploy/cellqc/bootstrap_cellqc_env.sh` | all of the below in one command |

The recipe below installs onto a machine. That is what `bin/local-dev.sh` gives you --
the computing unit is a process on your host and inherits your shell. **On Kubernetes
there is no such machine**: a computing unit is a pod from a fixed image, so the two
environments have to be inside that image instead. See "On Kubernetes" below, and read
this section first -- the k8s recipe installs the same things, one layer up.

```bash
# 1. R  (add --platform osx-64 on macOS arm64; not needed on Linux)
micromamba create -y -p ~/cellqc-env -f deploy/cellqc/environment-r.yaml
~/cellqc-env/bin/Rscript -e 'options(repos=c(CRAN="https://cloud.r-project.org")); \
  remotes::install_github("chris-mcginnis-ucsf/DoubletFinder", upgrade=FALSE)'

# 2. Python — into $UDF_PYTHON_PATH, not the system python
"$UDF_PYTHON_PATH" -m pip install -r deploy/cellqc/requirements.txt
"$UDF_PYTHON_PATH" -m pip install --no-deps git+https://github.com/lijinbio/cellqc.git@v0.3.3
"$UDF_PYTHON_PATH" -m pip install --no-deps deploy/cellqc   # the cellqc_texera runner

# 3. Point the workflow at the R environment, once, for everyone
export CELLQC_RSCRIPT=/home/<you>/cellqc-env/bin/Rscript
```

**Set `CELLQC_RSCRIPT` where the computing unit will read it.** It is what makes an
imported CellQC workflow runnable as it arrives. The Parameters operator resolves the R
environment in this order: its own `rscript` field, then this variable, then a bare
`Rscript` on PATH. The distributed workflow ships `rscript` empty on purpose -- a path
baked into the JSON pins it to one machine and has to be re-edited after every import,
and the bare `Rscript` on PATH is usually a plain R with none of the Bioconductor stack.
With this set, the only thing a user touches after importing is the file picker for their
own Cell Ranger archive.

Exporting it in the shell works for local-dev only, where the computing unit is a child
process. It does **not** reach a pod: see the next section.

A wrong or missing R environment does not cost an hour: `Load Input`, the first operator,
probes it with a real `library()` call and fails in seconds naming the missing package.

Four things that each cost an afternoon:

**Install the Python side into `$UDF_PYTHON_PATH`.** Anywhere else and nothing
changes that the workflow can see; the operator fails with
`ModuleNotFoundError: No module named 'cellqc'`, which reads as a code bug.

**`bioconductor-celda` and DoubletFinder are both easy to lose.** celda is
DecontX, the alternative ambient method; DoubletFinder is the default doublet
caller, so it decides the delivered cell count. Neither is exercised until an
hour into a run, and the failure is `there is no package called '...'` at that
point rather than at install time. `environment-r.yaml` lists celda; DoubletFinder
cannot be listed at all — it is GitHub-only, and bioconda forbids network access
at install time — so it stays a separate command.

**cellqc comes from git, not PyPI.** PyPI's newest is 0.3.2; 0.3.3 is what
introduced the configurable `geneset` section, and without it a reference that
names its mitochondrial genes bare (Ensembl Mmul_10) silently reports
`pct_counts_mt == 0` for every cell — a QC run that looks fine and filters
nothing.

**Give the computing unit ~8 GB of headroom.** The ambient stage loads the
all-droplets raw matrix to build the soup profile; on the 13,559-cell reference
sample (2.1M raw barcodes) SoupX peaks around 7 GB.

Validated against upstream's own reference numbers: 13,559 → 11,234 → 10,223
cells, SoupX rho 1.00%, DoubletFinder 1,011 doublets (9.00%), final matrix
10,223 × 38,606.

### On Kubernetes: it has to be in the computing unit image

A computing unit is a pod started from one globally configured image
(`kubernetes.conf` `image-name`, overridable with `KUBERNETES_IMAGE_NAME`). Four things
about that pod decide the whole approach, and each one closes a door that looks open:

**There is no machine to install onto.** The pod is new every time. Nothing you install
by hand survives it.

**Nothing can be mounted in.** `KubernetesClient` gives the pod exactly one volume, an
`emptyDir` tmpfs at `/dev/shm`, and only when `shmSize` was requested. There is no
PersistentVolume path, so "install the environment on a shared disk and mount it" is not
available.

**The pod's environment is a fixed allowlist.** `computingUnitEnvironmentVariables` is a
hardcoded Map, and `EnvironmentalVariable` has no entry for `UDF_PYTHON_PATH` and none for
`CELLQC_RSCRIPT`. Exporting either where the managing service runs sets nothing in the
pod. The image's own `ENV` *is* read, though -- `udf.conf` resolves
`python.path = ${?UDF_PYTHON_PATH}` from the container's environment -- so the image can
set both.

**The image's Python is too old for these pins.** The computing unit builds on
`eclipse-temurin:17-jdk-jammy` (Ubuntu 22.04), whose `python3` is 3.10.6, and
`scanpy==1.12.1` requires >= 3.12. Installing `requirements.txt` into the image's system
interpreter cannot work; the layer has to bring its own 3.12.

`deploy/cellqc/Dockerfile` is that layer. Build it, push it, point
`KUBERNETES_IMAGE_NAME` at the result.

The image grows by roughly 4 GB (1.9 GB of R, ~2 GB of the Python stack). That is disk on
each node, not memory, and not per pod -- pods on a node share the image's read-only
layers, and the repo already runs a prepull DaemonSet, so creating a computing unit stays
as fast as it is today. Only the first pull on a node is slower.

Every computing unit then carries cellqc's environment, whether or not it runs cellqc:
`WorkflowComputingUnitCreationParams` has no image field, so the image is one global
choice. Making it per-unit -- a real "environment" to pick when creating a computing unit
-- is a feature, not a configuration.

### Getting the results out

`Download Results` hands each file back as a `binary` cell with a download
button. That path goes through result export, which
`export-execution-result-enabled` can switch off — and when it is off the button
is silently inert, with no error and no server log. It also only works within the
~30 seconds a result stays live after a run.

`Publish Result` is the one that does not depend on either. Set the Parameters
operator's `publish_to_dataset` (a dataset picker, so no typing) and the run
writes its files into that dataset — created if absent, `isDownloadable` set —
and commits a version. Users then download from the Datasets page, whose own
buttons are not gated by the export flag, and the output can be the *input* of
the next workflow without a round trip through anyone's disk.

It needs `USER_JWT_TOKEN` and `FILE_SERVICE_UPLOAD_ONE_FILE_TO_DATASET_ENDPOINT`
on the computing unit. Both are already there: the second is injected by
`ComputingUnitManagingResource` on k8s and by `bin/local-dev/main.sh` locally, and
the first is the variable this file already insists on.

## Verifying

The frontend serves on 4200. A workflow whose author enabled it gets a second view at
`/workflow/<id>/parameters`; the switch sits in the title row of both views.
