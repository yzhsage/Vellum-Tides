import { createClient } from "@supabase/supabase-js";

function getServerClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase 尚未設定。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function verifySupabaseAccessToken(accessToken: string) {
  const client = getServerClient();
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("登入憑證已失效，請重新登入後再試。");
  return data.user;
}
