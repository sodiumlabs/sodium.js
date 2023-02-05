// Import the crypto getRandomValues shim (**BEFORE** the shims)
import "react-native-get-random-values"

// Import the the ethers shims (**BEFORE** ethers)
import "@ethersproject/shims"

import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { initWallet } from '@0xsodium/provider';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function App() {
  initWallet(80001, {
    localStorage: AsyncStorage,
    transports: {
      windowTransport: {
        enabled: false
      },
      iframeTransport: {
        enabled: false
      }
    }
  });
  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
