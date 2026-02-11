<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1VmceW5cBjQ-TczU0_UgEOjrcfaT4XygS

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Android app (install on phone)

The project is configured with Capacitor and contains a native Android project in `android/`.

### Prerequisites

- Node.js
- Android Studio (with Android SDK)
- Java 17+

### Build and open Android project

1. Install dependencies:
   `npm install`
2. Build web assets and sync them to Android:
   `npm run android:sync`
3. Open Android Studio:
   `npm run android:open`

### Build APK

In Android Studio:

- `Build` -> `Build Bundle(s) / APK(s)` -> `Build APK(s)`

Or from terminal:

```bash
npm run android:sync
cd android
./gradlew assembleDebug
```

Debug APK will be available at:

`android/app/build/outputs/apk/debug/app-debug.apk`

### Important

- Every time you change frontend code, run `npm run android:sync` before building APK again.
- Camera permission is already enabled in `AndroidManifest.xml`.
