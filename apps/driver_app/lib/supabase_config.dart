// The anon/publishable key is designed to ship inside client apps (unlike
// the secret key, which never appears here or in any client code) - see
// supabase/functions/_shared/auth.ts for where the secret key actually
// lives (server-side only, in edge functions).
class SupabaseConfig {
  static const String url = 'https://jugaubxwmlszkfqlnzul.supabase.co';
  static const String anonKey =
      'sb_publishable_M1up5O_HXxRl4sndK8nESQ__2yMOfnD';
}
