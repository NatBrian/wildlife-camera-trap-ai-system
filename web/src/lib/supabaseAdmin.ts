import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    // We don't throw here to avoid breaking build time if envs are missing,
    // but it will fail at runtime if used.
    console.warn("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

// Note: This client has admin privileges. NEVER use it on the client side.
export const supabaseAdmin = createClient(supabaseUrl || "", supabaseServiceRoleKey || "", {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});
