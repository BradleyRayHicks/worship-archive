# Worship Archive

Worship Archive is a React and Capacitor application with an iOS project in
`ios/App`.

## Requirements

- macOS
- Node.js 22 or newer
- npm
- Xcode with an iOS Simulator runtime
- An Apple development team only when running on a physical device or creating
  an archive

The application currently targets iOS 15 or newer.

## Install and build

From the repository root:

```sh
npm ci
npm run ios:sync
```

`ios:sync` creates the production React bundle and copies it into the native
iOS project.

## Run in Xcode

Open the native project:

```sh
npm run ios:open
```

In Xcode:

1. Select the `App` scheme.
2. Choose an iOS Simulator and press Run.
3. For a physical device, open **Signing & Capabilities** and select an Apple
   development team that can sign `com.worshiparchive.app`.

If your Apple team does not control that bundle identifier, use a bundle
identifier registered to your team. Coordinate that change before publishing
because it changes the app's identity.

## Command-line Simulator build

After `npm run ios:sync`, a signing-free Simulator build can be checked with:

```sh
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Web development

Run the local React development server:

```sh
npm start
```

The app uses the hosted Supabase project configured in `src/App.tsx`. Spotify
authentication on localhost expects `http://127.0.0.1:3000` as its redirect.

## Generated files

Do not commit `node_modules`, `build`, `ios/App/App/public`, Xcode `DerivedData`,
or `xcuserdata`. Run `npm run ios:sync` whenever the web application changes so
the generated native web bundle is refreshed locally.
