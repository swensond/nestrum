# 0012 — Admin extension boundaries

Accepted — Phase 14. Resource metadata carries safe widget/action names while executable contributions remain in explicitly assembled application code. Custom action handlers run server-side only after live session/admin access, ordinary resource action authorization, intersected read/action scopes, and object decisions; handler QuerySets retain the target key and independently enforce custom action operation grants.

Custom Svelte widgets register in a browser-safe build entry shared by SSR and client bundles, then seal before serving. A Fetch shell cannot safely transfer Svelte component functions into an already compiled client bundle; metadata-driven runtime imports would create a separate code-loading and trust boundary. This choice requires rebuilding the shell for widget changes but preserves generic resource pages, ordinary bundling, and explicit conflict detection. Reusable components can also receive a registry directly.

App/resource/DI seams remain their existing explicit APIs; [CLI and database contribution designs](../extension-seams.md) establish ownership/conflict rules without shipping a general plugin loader. See [Phase 14](../phases/phase-14-admin-extensions.md) and [extension usage](../admin-extensions.md).
