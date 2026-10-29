// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 northbit
// Network endpoints. Values match the public Midnight docs and midnight-examples.
export const NETWORKS = {
  local: {
    networkId: 'undeployed',
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    node: 'http://127.0.0.1:9944',
    nodeWS: 'ws://127.0.0.1:9944',
    faucet: undefined,
    explorer: null,
  },
  preview: {
    networkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    nodeWS: 'wss://rpc.preview.midnight.network',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
    explorer: null,
  },
};

export function getNetwork(name = process.env.MIDNIGHT_NETWORK ?? 'local') {
  const n = NETWORKS[name];
  if (!n) throw new Error(`unknown network ${name}; use one of ${Object.keys(NETWORKS).join(', ')}`);
  return {
    name,
    ...n,
    walletNetworkId: n.networkId,
    proofServer: process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300',
  };
}
