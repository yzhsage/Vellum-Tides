import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, router } from "./_core/trpc";
import { extractInvoiceFromImage } from "./invoiceOcr";
import { verifySupabaseAccessToken } from "./supabase";

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  invoice: router({
    ocr: publicProcedure
      .input(z.object({
        accessToken: z.string().min(20),
        imageDataUrl: z.string().startsWith("data:image/").max(6_500_000),
      }))
      .mutation(async ({ input }) => {
        await verifySupabaseAccessToken(input.accessToken);
        return extractInvoiceFromImage(input.imageDataUrl);
      }),
  }),

});

export type AppRouter = typeof appRouter;
