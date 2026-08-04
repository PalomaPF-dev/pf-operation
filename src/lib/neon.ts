import { neon } from "@neondatabase/serverless";

/**
 * Neon Postgres 接続（PF操業管理 専用DB）。
 * DATABASE_URL が無いビルド時にクラッシュしないよう遅延生成する。
 */
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が設定されていません");
  return neon(url);
}

/** DATABASE_URL が設定済みか（未設定なら初期セットアップ案内を出すための判定） */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
