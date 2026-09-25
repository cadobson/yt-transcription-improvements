# Transcript Helper

Firefox extension that improves YouTube's transcript panel. See `PLAN.md` for the roadmap.

## Load as a temporary add-on (development)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder.
3. Open a YouTube video that has a transcript, expand the description (`...more`), click
   **Show transcript**.
4. Open the web console with `Ctrl+Shift+K` (`Cmd+Opt+K` on macOS) and filter for
   `Transcript Helper`.

After editing files, go back to `about:debugging` and click **Reload** next to the
extension, then reload the YouTube tab.
