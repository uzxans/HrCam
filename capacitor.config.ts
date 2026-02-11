import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.systemreg.hrcam',
  appName: 'HrCam',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
