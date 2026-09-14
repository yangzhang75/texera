# %%
from utils import *

# Parameters
dataset_directory='../download/query.h5ad'
do_norm=True
filter_gene_by_counts=0
filter_cell_by_counts=0
n_hvg=5000
hvg_flavor='seurat_v3'
cell_type_col=None
batch_id_col=None
load_model='../download/reference_model/'
save_dir = 'outdir_step1'

# 
hyperparameter_defaults = load_config(preprocess=True, load_model_dir=load_model)

task_info = hyperparameter_defaults['task_info']
preprocess_config = hyperparameter_defaults['preprocess']
model_params = hyperparameter_defaults['model_parameters']

# update config
task_info['raw_dataset_directory'] = dataset_directory
task_info['raw_dataset_name'] = 'eyeGPT'
preprocess_config['do_norm'] = do_norm
preprocess_config['filter_gene_by_counts'] = filter_gene_by_counts
preprocess_config['filter_cell_by_counts'] = filter_cell_by_counts
preprocess_config['n_hvg'] = n_hvg
preprocess_config['hvg_flavor'] = hvg_flavor
preprocess_config['dataset_cell_type_col'] = None if cell_type_col is None else cell_type_col
preprocess_config['dataset_batch_id_col'] = None if batch_id_col is None else batch_id_col
model_params['do_train'] = False
model_params['load_model'] = load_model

# read data and create save directory
logger = scg.logger
save_dir = Path(save_dir)
save_dir.mkdir(parents=True, exist_ok=True)
task_info['save_dir'] = str(save_dir)
logger.info(f"Running pre-process program is saved to -> {save_dir}")

# pre-process dataframe
file_dir = task_info['raw_dataset_directory']
logger.info(f'Start reading data from {file_dir}')
adata = sc.read_h5ad(file_dir)
_gene_name = preprocess_config['_FIXED_GENE_COL']  # Gene column name must be <gene_name>
input_data_cell_type_col = preprocess_config['dataset_cell_type_col']
input_data_batch_id_col = preprocess_config['dataset_batch_id_col']
_cell_type_col = _cell_type_id = _batch_id = None

if input_data_cell_type_col is None and input_data_batch_id_col is None:
    logger.info(f' *** Cell type and batch id columns are Not specified')
    logger.info(f'Preprocess dataset as testing dataset for inference task ...')
    preprocess_config['_FIXED_BATCH_ID_COL'] = None
    preprocess_config['_FIXED_CELL_TYPE_COL'] = None
    preprocess_config['_FIXED_CELL_TYPE_ID_COL'] = None
elif input_data_cell_type_col is None and input_data_batch_id_col is not None:
    logger.info(f'*** Detected batch ID column only')
    logger.info(f'Preprocess dataset as testing dataset for inference task ...')
    _cell_type_col = _cell_type_id = None
    preprocess_config['_FIXED_CELL_TYPE_COL'] = None
    preprocess_config['_FIXED_CELL_TYPE_ID_COL'] = None
    _batch_id = preprocess_config['_FIXED_BATCH_ID_COL']
    adata.obs[_batch_id] = adata.obs[input_data_batch_id_col].astype("category").cat.codes.values
elif input_data_cell_type_col is not None and input_data_batch_id_col is None:
    logger.info(f'*** Detected Cell type column only')
    logger.info(f'Preprocess dataset as testing dataset for fine-tune/evaluation task ...')
    _cell_type_col = preprocess_config['_FIXED_CELL_TYPE_COL']
    _cell_type_id = preprocess_config['_FIXED_CELL_TYPE_ID_COL']
    adata.obs[_cell_type_col] = adata.obs[input_data_cell_type_col].astype("category")
    ########
    # if id2type is offered then we map the cell type to the reference dataset ID
    # otherwise, use the sequential numbers to create a new id2type mapping
    if len(task_info['id2type_json']) > 0:
        id2type_json_path = Path(load_model, task_info['id2type_json'].split('/')[-1]) if load_model else task_info['id2type_json']
        with open(id2type_json_path, 'r') as f:
            id2type = json.load(f)
        type2id = {cell_type_name: int(cell_type_id) for cell_type_id, cell_type_name in id2type.items()}
        adata.obs[_cell_type_id] = adata.obs[_cell_type_col].map(type2id)
    else:
        adata.obs[_cell_type_id] = adata.obs[_cell_type_col].astype("category").cat.codes.values
        id2type = dict(enumerate(adata.obs[_cell_type_col].astype("category").cat.categories))
        task_info['id2type_json'] = save_json(id2type, save_dir)
else:
    logger.info(f'Preprocess dataset as testing dataset ...')
    _cell_type_col = preprocess_config['_FIXED_CELL_TYPE_COL']
    _cell_type_id = preprocess_config['_FIXED_CELL_TYPE_ID_COL']
    _batch_id = preprocess_config['_FIXED_BATCH_ID_COL']

    adata.obs[_cell_type_col] = adata.obs[input_data_cell_type_col].astype("category")
    adata.obs[_batch_id] = adata.obs[input_data_batch_id_col].astype("category").cat.codes.values

    ########
    # if id2type is offered then we map the cell type to the reference dataset ID
    # otherwise, use the sequential numbers to create a new id2type mapping
    if len(task_info['id2type_json']) > 0:
        id2type_json_path = Path(load_model, task_info['id2type_json'].split('/')[-1]) if load_model else task_info['id2type_json']
        with open(id2type_json_path, 'r') as f:
            id2type = json.load(f)
        type2id = {cell_type_name: int(cell_type_id) for cell_type_id, cell_type_name in id2type.items()}
        adata.obs[_cell_type_id] = adata.obs[_cell_type_col].map(type2id)
    else:
        adata.obs[_cell_type_id] = adata.obs[_cell_type_col].astype("category").cat.codes.values
        id2type = dict(enumerate(adata.obs[_cell_type_col].astype("category").cat.categories))
        task_info['id2type_json'] = save_json(id2type, save_dir)

adata.var.index = adata.var.index.astype(str)
adata.var.index.name = None
adata.var[_gene_name] = adata.var.index.tolist()

# Load and save pre-trained model settings
load_model = hyperparameter_defaults['model_parameters']['load_model']
model_dir = Path(load_model)
vocab_file = model_dir / "vocab.json"
shutil.copy(vocab_file, save_dir / "vocab.json")
pad_token = hyperparameter_defaults['task_configs']['pad_token']
special_tokens = [
    pad_token,
    hyperparameter_defaults['task_configs']['cls_token'],
    hyperparameter_defaults['task_configs']['eoc_token']
]
vocab = get_vocab(vocab_file, special_tokens)
adata.var["id_in_vocab"] = [
    1 if gene in vocab else -1 for gene in adata.var[_gene_name]
]
gene_ids_in_vocab = np.array(adata.var["id_in_vocab"])
logger.info(
    f"match {np.sum(gene_ids_in_vocab >= 0)}/{len(gene_ids_in_vocab)} genes "
    f"in vocabulary of size {len(vocab)}."
)
adata = adata[:, adata.var["id_in_vocab"] >= 0]

# single-cell preprocessing
preprocessor = Preprocessor(
    logger,
    use_key="X",  # layer name for count matrix
    filter_gene_by_counts=preprocess_config['filter_gene_by_counts'],  # step 1
    filter_cell_by_counts=preprocess_config['filter_cell_by_counts'],  # step 2
    normalize_total=preprocess_config['normalize_total'],  # 3. whether to normalize the raw data and to what sum
    log1p=preprocess_config['do_norm'],  # 4. whether to log1p the normalized data
    subset_hvg=preprocess_config['n_hvg'],  # 5. whether to subset the raw data to highly variable genes
    hvg_flavor=preprocess_config['hvg_flavor'],
)
logger.info(f"Original data shape: {adata.shape}")
preprocessor(adata, batch_key=_batch_id)
logger.info(f"Preprocessed data shape: {adata.shape}")
logger.info(f'Saving processed adata to {save_dir} ...')
input_dataset_directory = save_h5ad(adata, save_dir)
task_info['input_dataset_directory'] = input_dataset_directory
with open(f"{save_dir}/train_args.yml", 'w') as out_configs:
    yaml.dump(hyperparameter_defaults, out_configs, sort_keys=False)
logger.info('=' * 20)
logger.info(f'Saved training-ready config file to current directory ...')
logger.info('Pre-processing finished. Cleaning cache ... Terminating ...')
logger.info('=' * 20)

