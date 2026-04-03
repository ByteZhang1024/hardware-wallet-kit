import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useHardwareWallet } from '../useHardwareWallet';
import { VendorPanel } from './VendorPanel';
import { LogView } from './LogView';
import type { TransportProviders } from '../types';

interface AppProps {
  providers: TransportProviders;
}

export function App({ providers }: AppProps) {
  const hw = useHardwareWallet(providers);

  // Track active transport per vendor for UI
  const [trezorTransport, setTrezorTransport] = useState<string>(
    () => providers.trezor.transports[0]?.type ?? '',
  );
  const [ledgerTransport, setLedgerTransport] = useState<string>(
    () => providers.ledger.transports[0]?.type ?? '',
  );

  const handleTrezorTransportSwitch = useCallback(async (type: string) => {
    setTrezorTransport(type);
    await hw.trezor.switchTransport(type);
  }, [hw]);

  const handleLedgerTransportSwitch = useCallback(async (type: string) => {
    setLedgerTransport(type);
    await hw.ledger.switchTransport(type);
  }, [hw]);

  return (
    <View className="flex-1 bg-[#1a1a2e] flex-row" style={{ flexDirection: 'row', height: '100vh' } as any}>
      {/* Left: controls */}
      <ScrollView className="flex-1 p-6" style={{ flex: 1 }}>
        <Text className="text-white text-2xl font-bold mb-6">
          Hardware Wallet Kit
        </Text>

        <VendorPanel
          title="Trezor"
          transports={providers.trezor.transports}
          selectedTransport={trezorTransport}
          onSelectTransport={handleTrezorTransportSwitch}
          onInit={hw.trezor.init}
          onPair={providers.trezor.pair}
          actions={hw.trezor}
        />

        <VendorPanel
          title="Ledger"
          transports={providers.ledger.transports}
          selectedTransport={ledgerTransport}
          onSelectTransport={handleLedgerTransportSwitch}
          onInit={hw.ledger.init}
          onPair={providers.ledger.pair}
          actions={hw.ledger}
        />
      </ScrollView>

      {/* Right: logs */}
      <View className="bg-[#0f0f23]" style={{ width: 420, borderLeftWidth: 1, borderLeftColor: '#333' } as any}>
        <LogView logs={hw.logs} />
      </View>
    </View>
  );
}
