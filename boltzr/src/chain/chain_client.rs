use crate::chain::rpc_client::RpcClient;
use crate::chain::types::{NetworkInfo, RawMempool, RpcParam};
use crate::chain::utils::{parse_transaction, Outpoint, Transaction};
use crate::chain::{BaseClient, Client, Config};
use async_trait::async_trait;
use std::collections::HashSet;
use tracing::{debug, error, info, trace};

const MAX_WORKERS: usize = 16;
const MEMPOOL_FETCH_CHUNK_SIZE: usize = 64;

#[derive(PartialEq, Debug, Clone)]
pub struct ChainClient {
    client: RpcClient,
    client_type: crate::chain::types::Type,
}

impl ChainClient {
    pub fn new(
        client_type: crate::chain::types::Type,
        symbol: String,
        config: Config,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            client_type,
            client: RpcClient::new(symbol, config)?,
        })
    }

    fn is_relevant_tx(
        relevant_inputs: &HashSet<Outpoint>,
        relevant_outputs: &HashSet<Vec<u8>>,
        tx: &Transaction,
    ) -> bool {
        tx.input_outpoints()
            .iter()
            .any(|input| relevant_inputs.contains(input))
            || tx
                .output_script_pubkeys()
                .iter()
                .any(|output| relevant_outputs.contains(output))
    }
}

#[async_trait]
impl BaseClient for ChainClient {
    fn kind(&self) -> String {
        "Chain client".to_string()
    }

    fn symbol(&self) -> String {
        self.client.symbol.clone()
    }

    async fn connect(&mut self) -> anyhow::Result<()> {
        let info = self.network_info().await?;
        info!(
            "Connected to {} chain client: {}",
            self.client.symbol, info.subversion
        );

        Ok(())
    }
}

#[async_trait]
impl Client for ChainClient {
    async fn scan_mempool(
        &self,
        relevant_inputs: &HashSet<Outpoint>,
        relevant_outputs: &HashSet<Vec<u8>>,
    ) -> anyhow::Result<Vec<Transaction>> {
        info!("Scanning mempool of {} chain", self.client.symbol);

        let mempool = self
            .client
            .request::<RawMempool>("getrawmempool", None)
            .await?;
        let mempool_size = mempool.len();

        if mempool_size == 0 {
            debug!("Mempool of {} chain is empty", self.client.symbol);
            return Ok(Vec::default());
        }

        let (tx, mut rx) = tokio::sync::mpsc::channel(1_024);

        let fetcher_threads = std::cmp::min(num_cpus::get() / 2, MAX_WORKERS);
        debug!(
            "Scanning {} mempool transactions of {} chain with {} workers",
            mempool_size, self.client.symbol, fetcher_threads
        );
        for chunk in mempool.chunks(std::cmp::max(mempool_size / fetcher_threads, 1)) {
            let tx_cp = tx.clone();
            let self_cp = self.clone();
            let chunk = chunk.to_vec();

            tokio::spawn(async move {
                let tx_chunks = chunk.chunks(MEMPOOL_FETCH_CHUNK_SIZE);
                for tx_ids in tx_chunks {
                    let txs_hex = match self_cp
                        .client
                        .request_batch::<String>(
                            "getrawtransaction",
                            tx_ids
                                .iter()
                                .map(|tx_id| vec![RpcParam::Str(tx_id.clone())])
                                .collect(),
                        )
                        .await
                    {
                        Ok(txs) => txs,

                        // When the entire request fails, something is terribly wrong
                        Err(err) => {
                            error!(
                                "Could not fetch {} mempool transactions: {}",
                                self_cp.symbol(),
                                err
                            );
                            break;
                        }
                    };

                    for tx_hex in txs_hex {
                        match tx_hex {
                            Ok(tx_hex) => {
                                if let Err(err) = tx_cp.send(tx_hex).await {
                                    error!("Could not send to mempool channel: {}", err);
                                    break;
                                }
                            }

                            // When a single transaction request fails, it's fine.
                            // Can happen if the transaction was evicted from the mempool
                            Err(err) => {
                                trace!(
                                    "Could not fetch single {} mempool transaction: {}",
                                    self_cp.symbol(),
                                    err
                                );
                            }
                        };
                    }
                }
            });
        }
        drop(tx);

        let mut relevant_txs = Vec::new();

        let mut i = 0;
        loop {
            let tx_hex = match rx.recv().await {
                Some(tx_hex) => tx_hex,
                None => break,
            };
            let tx = parse_transaction(&self.client_type, &tx_hex)?;
            if Self::is_relevant_tx(relevant_inputs, relevant_outputs, &tx) {
                relevant_txs.push(tx);
            }

            i += 1;
            if i % 1_000 == 0 {
                trace!(
                    "Scanned {}/{} transactions of {} chain mempool",
                    i,
                    mempool_size,
                    self.client.symbol
                );
            }
        }

        debug!(
            "Scanned {} mempool transactions of {} chain",
            mempool_size, self.client.symbol
        );

        if !relevant_txs.is_empty() {
            info!(
                "Found {} relevant transactions in mempool of {} chain",
                relevant_txs.len(),
                self.client.symbol
            );
        }

        Ok(relevant_txs)
    }

    async fn network_info(&self) -> anyhow::Result<NetworkInfo> {
        self.client.request("getnetworkinfo", None).await
    }
}

#[cfg(test)]
pub mod test {
    use crate::chain::chain_client::ChainClient;
    use crate::chain::types::{RawMempool, RpcParam, Type};
    use crate::chain::utils::{parse_transaction, Transaction};
    use crate::chain::{BaseClient, Client, Config};
    use serial_test::serial;
    use std::collections::HashSet;
    use std::sync::OnceLock;

    const PORT: u16 = 18_443;
    const COOKIE_PATH: &str = "../docker/regtest/data/core/cookies/.bitcoin-cookie";

    pub fn get_client() -> ChainClient {
        static CLIENT: OnceLock<ChainClient> = OnceLock::new();
        CLIENT
            .get_or_init(|| {
                ChainClient::new(
                    Type::Bitcoin,
                    "BTC".to_string(),
                    Config {
                        host: "127.0.0.1".to_string(),
                        port: PORT,
                        cookie: Some(COOKIE_PATH.to_string()),
                        user: None,
                        password: None,
                    },
                )
                .unwrap()
            })
            .clone()
    }

    async fn generate_block(client: &ChainClient) {
        client
            .client
            .request::<serde_json::Value>(
                "generatetoaddress",
                Some(vec![
                    RpcParam::Int(1),
                    RpcParam::Str(
                        client
                            .client
                            .request::<String>("getnewaddress", None)
                            .await
                            .unwrap(),
                    ),
                ]),
            )
            .await
            .unwrap();
    }

    async fn send_transaction(client: &ChainClient) -> Transaction {
        let tx_id = client
            .client
            .request::<String>(
                "sendtoaddress",
                Some(vec![
                    RpcParam::Str(
                        client
                            .client
                            .request::<String>("getnewaddress", None)
                            .await
                            .unwrap(),
                    ),
                    RpcParam::Float(0.21),
                ]),
            )
            .await
            .unwrap();

        parse_transaction(
            &Type::Bitcoin,
            &client
                .client
                .request::<String>("getrawtransaction", Some(vec![RpcParam::Str(tx_id)]))
                .await
                .unwrap(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn test_connect() {
        let mut client = get_client();

        client.connect().await.unwrap();

        assert_ne!(
            client.network_info().await.unwrap().subversion,
            "".to_string()
        );
    }

    #[tokio::test]
    #[serial(BTC)]
    async fn scan_mempool_empty() {
        let client = get_client();

        generate_block(&client).await;

        let mempool = client
            .client
            .request::<RawMempool>("getrawmempool", None)
            .await
            .unwrap();
        assert!(mempool.is_empty());

        let transactions = client
            .scan_mempool(&HashSet::new(), &HashSet::new())
            .await
            .unwrap();
        assert_eq!(transactions.len(), 0);
    }

    #[tokio::test]
    #[serial(BTC)]
    async fn scan_mempool_relevant_input() {
        let client = get_client();
        let tx = send_transaction(&client).await;

        let mut inputs = HashSet::new();
        inputs.insert(tx.input_outpoints()[0].clone());

        let transactions = client.scan_mempool(&inputs, &HashSet::new()).await.unwrap();
        assert_eq!(transactions.len(), 1);
        assert_eq!(transactions[0], tx);

        generate_block(&client).await;
    }

    #[tokio::test]
    #[serial(BTC)]
    async fn scan_mempool_relevant_output() {
        let client = get_client();
        let tx = send_transaction(&client).await;

        let mut outputs = HashSet::new();
        outputs.insert(tx.output_script_pubkeys()[0].clone());

        let transactions = client
            .scan_mempool(&HashSet::new(), &outputs)
            .await
            .unwrap();
        assert_eq!(transactions.len(), 1);
        assert_eq!(transactions[0], tx);

        generate_block(&client).await;
    }
}