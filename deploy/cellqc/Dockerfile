# The cellqc environment as a layer on the computing unit image.
#
# On Kubernetes a computing unit is a pod, so there is no machine to run
# bootstrap_cellqc_env.sh on and no volume to mount an environment through -- the two
# environments have to be in the image. See "On Kubernetes" in ../DEPLOY.md for why each
# of the other routes is closed.
#
#   docker build -f deploy/cellqc/Dockerfile \
#     --build-arg BASE=<your computing unit image> -t <registry>/texera-cu-cellqc:<tag> .
#   docker push <registry>/texera-cu-cellqc:<tag>
#   # then point KUBERNETES_IMAGE_NAME at it
#
# WHAT IS VERIFIED. That deadsnakes carries python3.12.13 for jammy (the version the
# reference run was validated on) and that micromamba downloads and unpacks in the base
# image -- both checked by running the base image. The R and Python installs themselves
# are the same commands bootstrap_cellqc_env.sh runs, which are validated on macOS.
#
# WHAT IS NOT. This image has never been built or run: doing so needs an x86_64 host and a
# registry. Treat the first build as the real test -- the conda solve in particular
# resolves differently on linux-64 than it does on osx-64, and DoubletFinder compiles from
# source here.

ARG BASE=bobbai/texera-workflow-computing-unit:dev
FROM ${BASE}

# Installs land in /opt and are handed to the runtime user at the end. The base image
# switches to texera(1001) with --no-create-home, so nothing may assume a writable $HOME.
USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
      software-properties-common curl bzip2 ca-certificates \
 && add-apt-repository -y ppa:deadsnakes/ppa \
 && apt-get update && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3.12-dev \
 && rm -rf /var/lib/apt/lists/*

COPY deploy/cellqc /opt/cellqc

# A 3.12 interpreter of its own. The image's system python3 is 3.10 (Ubuntu 22.04) and
# scanpy==1.12.1 requires >= 3.12, so cellqc's stack cannot go there. Texera's own two
# requirement files go into the same interpreter, because this is the one the UDF workers
# will run and they need loguru, pyarrow and the rest to start at all.
RUN python3.12 -m venv /opt/udf-py \
 && /opt/udf-py/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
 && /opt/udf-py/bin/pip install --no-cache-dir \
      -r /texera/amber/requirements.txt \
      -r /texera/amber/operator-requirements.txt \
 && /opt/udf-py/bin/pip install --no-cache-dir -r /opt/cellqc/requirements.txt \
 && /opt/udf-py/bin/pip install --no-cache-dir --no-deps \
      "git+https://github.com/lijinbio/cellqc.git@v0.3.3" \
 && /opt/udf-py/bin/pip install --no-cache-dir --no-deps /opt/cellqc

# R. No --platform here: linux-64 is the default and the right one.
# DoubletFinder is a separate command because bioconda forbids network access at install
# time, so it cannot be a dependency in environment-r.yaml.
# Downloaded to a file rather than piped into tar: a pipeline hides curl's exit status,
# so a network failure would unpack nothing and leave the build to fail somewhere less
# obvious.
RUN curl -fsSL https://micro.mamba.pm/api/micromamba/linux-64/latest -o /tmp/micromamba.tar.bz2 \
 && tar -xjf /tmp/micromamba.tar.bz2 -C /usr/local bin/micromamba \
 && rm /tmp/micromamba.tar.bz2 \
 && /usr/local/bin/micromamba create -y -p /opt/cellqc-env -f /opt/cellqc/environment-r.yaml \
 && /opt/cellqc-env/bin/Rscript -e 'options(repos=c(CRAN="https://cloud.r-project.org")); \
      remotes::install_github("chris-mcginnis-ucsf/DoubletFinder", upgrade=FALSE)' \
 && /usr/local/bin/micromamba clean -y --all

# The pod's environment is a hardcoded allowlist that carries neither of these, so the
# image is the only place they can come from. udf.conf reads python.path from
# UDF_PYTHON_PATH; the Parameters operator reads CELLQC_RSCRIPT when its own `rscript`
# field is empty, which is how the distributed workflow ships.
ENV UDF_PYTHON_PATH=/opt/udf-py/bin/python
ENV CELLQC_RSCRIPT=/opt/cellqc-env/bin/Rscript

# Fails the build rather than the first workflow run an hour in.
RUN /opt/cellqc-env/bin/Rscript -e 'suppressPackageStartupMessages({ \
      for (p in c("SoupX","DropletUtils","SingleCellExperiment","SummarizedExperiment", \
                  "zellkonverter","scDblFinder","Seurat","DoubletFinder","celda","jsonlite")) \
        library(p, character.only=TRUE) }); cat("R stack OK\n")' \
 && /opt/udf-py/bin/python -c "import cellqc, cellqc_texera, scanpy, pysam, jinja2, requests; print('Python stack OK')"

RUN chown -R 1001:1001 /opt/cellqc-env /opt/udf-py /opt/cellqc
USER texera
