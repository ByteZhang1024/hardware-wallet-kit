import React from 'react';
import { View, Text, ScrollView } from 'react-native';

interface LogViewProps {
  logs: string[];
}

export function LogView({ logs }: LogViewProps) {
  return (
    <View className="flex-1 p-3" style={{ flex: 1 }}>
      <Text className="text-gray-400 text-xs font-bold mb-2 uppercase">Log</Text>
      <ScrollView className="flex-1" style={{ flex: 1 }}>
        {logs.map((line, i) => (
          <Text
            key={i}
            className="font-mono text-xs text-[#0f0] mb-1"
          >
            {line}
          </Text>
        ))}
        {logs.length === 0 && (
          <Text className="font-mono text-xs text-[#555]">
            Waiting for output...
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
