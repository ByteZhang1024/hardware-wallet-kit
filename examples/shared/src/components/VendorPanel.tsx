import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { TransportEntry } from '../types';
import type { VendorOps } from '../useHardwareWallet';

interface VendorPanelProps {
  title: string;
  transports: TransportEntry[];
  selectedTransport: string;
  onSelectTransport: (type: string) => void;
  onInit: () => void;
  onPair?: () => void;
  actions: VendorOps;
}

function ActionButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-[#e94560] px-4 py-2 rounded-md mr-2 mb-2 active:opacity-70"
    >
      <Text className="text-white text-sm font-semibold">{label}</Text>
    </Pressable>
  );
}

function TransportTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1 rounded-t-md mr-1 ${
        active ? 'bg-[#16213e]' : 'bg-[#0f3460] active:opacity-70'
      }`}
    >
      <Text
        className={`text-sm ${
          active ? 'text-white font-bold' : 'text-gray-400'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <Text className="text-gray-400 text-xs font-bold mt-2 mb-1 uppercase">
      {text}
    </Text>
  );
}

export function VendorPanel({
  title,
  transports,
  selectedTransport,
  onSelectTransport,
  onInit,
  onPair,
  actions,
}: VendorPanelProps) {
  return (
    <View className="mb-6">
      <Text className="text-white text-lg font-bold mb-2">{title}</Text>

      {/* Transport selector */}
      {transports.length > 1 && (
        <View className="flex-row mb-2">
          {transports.map((t) => (
            <TransportTab
              key={t.type}
              label={t.label}
              active={t.type === selectedTransport}
              onPress={() => onSelectTransport(t.type)}
            />
          ))}
        </View>
      )}

      {/* Device */}
      <SectionLabel text="Device" />
      <View className="flex-row flex-wrap">
        {onPair && (
          <ActionButton label="Pair" onPress={onPair} />
        )}
        <ActionButton label="Init" onPress={onInit} />
        <ActionButton label="Search" onPress={actions.search} />
        <ActionButton label="Connect" onPress={actions.connectDevice} />
        <ActionButton label="Disconnect" onPress={actions.disconnectDevice} />
        <ActionButton label="Get Info" onPress={actions.getDeviceInfo} />
      </View>

      {/* EVM */}
      <SectionLabel text="EVM" />
      <View className="flex-row flex-wrap">
        <ActionButton label="Get Address" onPress={actions.evmGetAddress} />
        <ActionButton label="Get PublicKey" onPress={actions.evmGetPublicKey} />
        <ActionButton label="Batch Addresses" onPress={actions.evmBatchGetAddresses} />
        <ActionButton label="Sign Tx" onPress={actions.evmSignTx} />
        <ActionButton label="Sign Message" onPress={actions.evmSignMessage} />
        <ActionButton label="Sign TypedData" onPress={actions.evmSignTypedData} />
      </View>

      {/* BTC */}
      <SectionLabel text="BTC" />
      <View className="flex-row flex-wrap">
        <ActionButton label="Get Address" onPress={actions.btcGetAddress} />
        <ActionButton label="Get PublicKey" onPress={actions.btcGetPublicKey} />
        <ActionButton label="Sign Tx" onPress={actions.btcSignTx} />
        <ActionButton label="Sign Message" onPress={actions.btcSignMessage} />
      </View>

      {/* SOL */}
      <SectionLabel text="SOL" />
      <View className="flex-row flex-wrap">
        <ActionButton label="Get Address" onPress={actions.solGetAddress} />
        <ActionButton label="Sign Tx" onPress={actions.solSignTx} />
      </View>
    </View>
  );
}
