export interface IOSDistributionOptions {
  appStoreConnect: boolean;
  buildNumber?: string;
}

/** Catch known bundled crypto providers that invalidate our Apple-only audit. */
export function assertIOSPlatformEncryption(dependencyTree: string): void {
  const implementations = new Set(["rustls", "ring", "openssl", "openssl-sys", "aws-lc-rs", "aws-lc-sys",
    "boring", "boring-sys", "aes", "aes-gcm", "chacha20", "chacha20poly1305", "rsa"]);
  const found = [...new Set(dependencyTree.split("\n").map(line => line.match(/^(\S+) v\S+/)?.[1])
    .filter((name): name is string => !!name && implementations.has(name)))];
  if (found.length) throw new Error(`Bundled iOS cryptography (${found.join(", ")}); re-audit the encryption declaration before releasing.`);
}

/** Validate before running Xcode or modifying its generated project. */
export function iosDistributionOptions(argv: string[]): IOSDistributionOptions {
  const appStoreConnect = argv.includes("--app-store-connect");
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--build-number") values.push(argv[++i] ?? "");
    else if (argv[i]!.startsWith("--build-number=")) values.push(argv[i]!.slice(15));
  }
  if (values.length > 1) throw new Error("Specify --build-number once.");
  const buildNumber = values[0];
  if (buildNumber !== undefined && !/^[1-9]\d{0,3}(?:\.\d{1,2}){0,2}$/.test(buildNumber))
    throw new Error("--build-number must be a positive build version such as 1 or 1234.56.78.");
  if (appStoreConnect) {
    for (const flag of ["--simulator", "--unsigned", "--debug", "--experimental-high-refresh"]) {
      if (argv.includes(flag)) throw new Error(`--app-store-connect cannot be combined with ${flag}.`);
    }
    if (!buildNumber) throw new Error("App Store Connect builds require an explicit --build-number; increase it for each upload.");
  }
  return { appStoreConnect, buildNumber };
}

/** Keep the host identity and extension versions aligned across regeneration. */
export function configureIOSDistribution(spec: string, version: string, options: IOSDistributionOptions): string {
  if (!/^\d+(?:\.\d+){0,2}$/.test(version)) throw new Error("Invalid iOS marketing version.");
  // Remove extension targets first at the call site, so these anchors belong to the host.
  let matches = 0;
  spec = spec.replace(/(        CFBundleShortVersionString:)[^\n]*\n(        CFBundleVersion:)[^\n]*/g,
    (_match, short: string, build: string) => {
      matches++;
      return `${short} "${version}"\n${build} "${options.buildNumber ?? version}"`;
    });
  if (matches !== 1) throw new Error("Missing or ambiguous iOS host version configuration.");
  spec = spec.replace(/      # Lumiverse privacy manifest\n[\s\S]*?      # End Lumiverse privacy manifest\n/g, "");
  const anchor = "      - path: LaunchScreen.storyboard";
  if (!spec.includes(anchor)) throw new Error("Missing iOS host resource configuration.");
  return spec.replace(anchor, `      # Lumiverse privacy manifest
      - path: ../../PrivacyInfo.xcprivacy
        buildPhase: resources
      # End Lumiverse privacy manifest
${anchor}`);
}

export function iosExportOptions(team: string, options: IOSDistributionOptions): string {
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error("Invalid Apple Team ID.");
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>method</key><string>${options.appStoreConnect ? "app-store-connect" : "debugging"}</string>
<key>destination</key><string>export</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>${team}</string>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>testFlightInternalTestingOnly</key><false/>
</dict></plist>
`;
}
