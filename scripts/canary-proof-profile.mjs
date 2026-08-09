const profiles = {
  launch: {
    network: "mainnet",
    chainId: 59144,
    manifestPath: "docs/canary-proof.json",
    draftManifestPath: "docs/canary-proof.draft.json",
    label: "Linea mainnet launch",
    evidenceTerms: "mainnet",
    requiredRoles: ["MANUAL", "AUTOMINER_A", "AUTOMINER_B"],
  },
  testnet: {
    network: "sepolia",
    chainId: 59141,
    manifestPath: "docs/testnet-canary-proof.json",
    draftManifestPath: "docs/testnet-canary-proof.draft.json",
    label: "Linea Sepolia testnet",
    evidenceTerms: "sepolia|testnet",
    requiredRoles: ["MANUAL", "AUTOMINER_A", "AUTOMINER_B"],
  },
  "v10-matrix": {
    network: "sepolia",
    chainId: 59141,
    manifestPath: "",
    draftManifestPath: "",
    label: "Linea Sepolia bounded V10 matrix",
    evidenceTerms: "sepolia|testnet",
    manifestRequired: false,
    minEpochs: 6,
    minAutoMinerEpochs: 4,
  },
};

export function resolveCanaryProofProfile(value = "launch") {
  const key = String(value).trim().toLowerCase();
  const profile = profiles[key];
  if (!profile) {
    throw new Error(`--profile must be one of: ${Object.keys(profiles).join(", ")}`);
  }
  return { key, ...profile };
}
