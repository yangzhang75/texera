# R side of the cellqc-on-Texera shim.
#
# The cellqc R stages (ambient.R, doubletfinder.R, scdblfinder.R) read S4 slots
# off a `snakemake` object that Snakemake injects.  This rebuilds that object
# from the JSON the Python side wrote and then source()s the stage script
# unmodified, so the R analysis code is upstream's, byte for byte.
#
# Invoked as:  Rscript --vanilla shim.R <payload.json>

suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly=TRUE)
if (length(args) < 1) stop('usage: shim.R <payload.json>')
cfg <- jsonlite::fromJSON(args[[1]], simplifyVector=TRUE)

# jsonlite maps an empty JSON array to list(); `ambient.compare: []` then flows
# into c(method, compare) and turns the method into a list.  Normalising empty
# containers to a zero-length character vector keeps every downstream c()/subset
# atomic, which is what the scripts assume.
normalise <- function(x) {
	if (is.list(x)) {
		if (length(x) == 0L) return(character(0))
		return(lapply(x, normalise))
	}
	x
}
cfg <- lapply(cfg, normalise)

as_list <- function(x) if (is.null(x)) list() else as.list(x)

setClass('Snakemake', representation(
	input='list', output='list', params='list', threads='numeric',
	wildcards='list', log='list', config='list', rule='character'))

snakemake <- new('Snakemake',
	input=as_list(cfg$input),
	output=as_list(cfg$output),
	params=as_list(cfg$params),
	threads=as.numeric(if (is.null(cfg$threads)) 1 else cfg$threads),
	wildcards=as_list(cfg$wildcards),
	log=list(),
	config=list(),
	rule=as.character(tools::file_path_sans_ext(basename(cfg$script)))
	)

options(warn=1)
cat(sprintf('[cellqc-texera] sourcing %s in %s\n', cfg$script, getwd()))
source(cfg$script, echo=FALSE)
