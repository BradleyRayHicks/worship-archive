import { readFile, writeFile } from 'node:fs/promises';

const upstreamUrl = 'https://github.com/ionic-team/capacitor-swift-pm.git';
const forkUrl = 'https://github.com/Arjun2908/capacitor-swift-pm.git';
const manifests = [
  'node_modules/@capacitor/app/Package.swift',
  'node_modules/@capacitor/browser/Package.swift',
  'node_modules/@capacitor/preferences/Package.swift',
];

for (const manifest of manifests) {
  const contents = await readFile(manifest, 'utf8');
  if (!contents.includes(upstreamUrl) && !contents.includes(forkUrl)) {
    throw new Error(`Expected Capacitor Swift package URL was not found in ${manifest}`);
  }

  await writeFile(manifest, contents.replaceAll(upstreamUrl, forkUrl));
}
