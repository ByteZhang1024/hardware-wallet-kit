# Hardware Wallet Kit

OneKey's unified hardware wallet SDK adapter for Ledger and Trezor devices.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [@bytezhang/ledger-adapter](./packages/ledger-adapter) | Ledger hardware wallet adapter | 🚧 In Development |
| [@bytezhang/trezor-adapter](./packages/trezor-adapter) | Trezor hardware wallet adapter | 📋 Planned |

## Quick Start

```bash
# Install dependencies
yarn install

# Build all packages
yarn build

# Development mode (watch)
yarn dev
```

## Tech Stack

- **Package Manager**: Yarn Workspaces
- **Bundler**: [tsup](https://github.com/egoist/tsup) (ESM + CJS + d.ts)
- **Version Management**: [Changesets](https://github.com/changesets/changesets)
- **TypeScript**: Strict mode enabled

## Project Structure

```
hardware-wallet-kit/
├── packages/
│   ├── ledger-adapter/     # Ledger SDK wrapper
│   └── trezor-adapter/     # Trezor SDK wrapper (planned)
├── examples/               # Demo applications
│   ├── web/               # Web test page
│   └── expo-demo/         # React Native demo
├── docs/
│   └── ledger/            # Ledger implementation docs
└── package.json           # Root workspace config
```

## Development

### Adding a changeset

```bash
yarn changeset
```

### Publishing

```bash
yarn release
```

## License

MIT
