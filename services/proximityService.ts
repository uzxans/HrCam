import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface ProximityEvent {
  near: boolean;
  distance: number;
  maxDistance: number;
}

interface ProximityPlugin {
  start(): Promise<{ available: boolean; maxDistance?: number }>;
  stop(): Promise<void>;
  addListener(
    eventName: 'proximityChange',
    listenerFunc: (event: ProximityEvent) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  removeAllListeners(): Promise<void>;
}

const Proximity = registerPlugin<ProximityPlugin>('Proximity');

export const isProximityPlatformSupported = (): boolean => Capacitor.getPlatform() === 'android';

export const startProximityMonitoring = async (
  onChange: (event: ProximityEvent) => void
): Promise<PluginListenerHandle | null> => {
  if (!isProximityPlatformSupported()) return null;

  let listener: PluginListenerHandle | null = null;
  try {
    listener = await Proximity.addListener('proximityChange', onChange);
    await Proximity.start();
    return listener;
  } catch (e) {
    if (listener) {
      await listener.remove().catch(() => {});
    }
    return null;
  }
};

export const stopProximityMonitoring = async (): Promise<void> => {
  if (!isProximityPlatformSupported()) return;
  try {
    await Proximity.stop();
    await Proximity.removeAllListeners();
  } catch (e) {
    // Ignore native cleanup errors.
  }
};
