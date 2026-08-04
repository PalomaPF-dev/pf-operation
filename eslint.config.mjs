// Next.js 16 の eslint-config-next はフラット設定をそのまま公開しているため、
// FlatCompat を挟まずに読み込む。
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**"] },
  ...coreWebVitals,
  ...typescriptConfig,
];

export default eslintConfig;
