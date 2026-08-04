import type { NextConfig } from "next";

// 通常の SSR ビルド（Vercel）。PFシリーズ共通の構成に合わせる。
const nextConfig: NextConfig = {
  // 共通UIパッケージは TSX をそのまま配布しているためトランスパイルする
  transpilePackages: ["@paloma-pf/ui"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
