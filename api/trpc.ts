import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

/**
 * Vercel Serverless Function entrypoint.
 *
 * The React application is served as Vite static output, while this function
 * preserves the existing `/api/trpc` endpoint used by the receipt OCR flow.
 */
const app = express();

/**
 * The production ledger uses Supabase tokens supplied to the OCR procedure.
 * Avoid loading the legacy platform-cookie SDK in the Vercel Function.
 */
async function createVercelContext({ req, res }: Pick<TrpcContext, "req" | "res">): Promise<TrpcContext> {
  return { req, res, user: null };
}

app.use(express.json({ limit: "7mb" }));
app.use(
  createExpressMiddleware({
    router: appRouter,
    createContext: createVercelContext,
  }),
);

export default app;
