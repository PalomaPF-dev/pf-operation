import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      loginId: string;
      role: "admin" | "member";
      factory: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    loginId: string;
    role: "admin" | "member";
    factory: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    loginId?: string;
    role?: "admin" | "member";
    factory?: string | null;
  }
}
