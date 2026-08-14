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

## What is deliberately NOT in the branch

Model weights and datasets — about 411 MB, over GitHub's file limit and permanent bloat
in a repo that does not need them:

- `download/reference_model/best_model.pt` — the scGPT reference model
- `download/query.h5ad`
- `scGPT_postproc/{addmetadata,leiden}/EVAL_snRNA_no_enriched.h5ad`

Copy these onto the target machine separately and keep the same directory layout under
whatever you point `SCGPT_HOME` at. The Python virtualenv (2.2 GB) is likewise rebuilt
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

## The Python environment

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

## Verifying

The frontend serves on 4200. A workflow whose author enabled it gets a second view at
`/workflow/<id>/parameters`; the switch sits in the title row of both views.
