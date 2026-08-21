import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

/**
 * Vercel 會依檔案路徑處理 `/api/trpc` 與 `/api/trpc/<程序>`。
 * 這個共用入口同時由兩個函式路徑匯入，使 tRPC 的程序子路徑不會落入
 * 找不到頁面的靜態回應。
 */
const app = express();

async function createVercelContext({ req, res }: Pick<TrpcContext, "req" | "res">): Promise<TrpcContext> {
  return { req, res, user: null };
}

app.use(express.json({ limit: "4mb" }));
app.use(
  createExpressMiddleware({
    router: appRouter,
    createContext: createVercelContext,
  }),
);

export default app;
