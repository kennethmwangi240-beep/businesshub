# BusinessHub Android app

This is a **native WebView shell** that loads your live BusinessHub site (same server as the website).

## Requirements
- Android Studio Hedgehog or newer
- JDK 17
- Your deployed URL (e.g. https://businesshub-zjx8.onrender.com)

## Setup
1. Open the `android-app` folder in Android Studio.
2. Edit `app/src/main/java/com/businesshub/app/MainActivity.kt` — set `APP_URL` to your Render URL.
3. Sync Gradle → Run on emulator or phone.

## Alternative (no Android Studio)
On Android Chrome: open your BusinessHub URL → menu → **Install app** / **Add to Home screen**.
That uses the PWA (same data, same login).

## Note
Worker login, owner POS, and admin all work inside this WebView — same as the browser.


## App icon
Use `app-icon-source.png` (MyBusinessHub) as the launcher icon in Android Studio (Image Asset).
